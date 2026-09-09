import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LngLat } from 'maplibre-gl';
import { TreeModelLayer, shouldRenderTreesForViewport, treeViewportSignature } from './TreeModelLayer';

describe('treeViewportSignature', () => {
  it('ignores minor map drift while preserving meaningful zoom and terrain changes', () => {
    const baseline = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.62,
      28.4,
      'terrain',
      true,
      3,
    );
    const drift = treeViewportSignature(
      { west: 23.76092, south: 61.49812, east: 23.76513, north: 61.50125 },
      14.64,
      28.7,
      'terrain',
      true,
      3,
    );
    expect(drift).toBe(baseline);
  });

  it('changes when zoom or terrain mode crosses a meaningful threshold', () => {
    const lowZoom = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.2,
      28.4,
      'terrain',
      true,
      3,
    );
    const higherZoom = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.8,
      28.4,
      'terrain',
      true,
      3,
    );
    const terrainChanged = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.2,
      28.4,
      'terrain',
      false,
      3,
    );

    expect(higherZoom).not.toBe(lowZoom);
    expect(terrainChanged).not.toBe(lowZoom);
  });

  it('disables trees once the viewport exceeds a few kilometres', () => {
    expect(shouldRenderTreesForViewport({
      west: 23.7609,
      south: 61.4981,
      east: 23.7685,
      north: 61.5025,
    }, 12.5)).toBe(true);

    expect(shouldRenderTreesForViewport({
      west: 23.7609,
      south: 61.4981,
      east: 23.8600,
      north: 61.6200,
    }, 12.5)).toBe(false);
  });
});

describe('TreeModelLayer', () => {
  afterEach(() => vi.restoreAllMocks());

  function fixture() {
    const layer = new TreeModelLayer({ sourceId: 'trees', waterLayers: [], vegetationLayers: [], mappedTreeLayer: 'points' });
    const state = layer as any;
    let longitude = 23.76;
    const map = {
      getZoom: () => 15,
      getPitch: () => 30,
      getCenter: () => new LngLat(longitude, 61.5),
      getBounds: () => ({ getWest: () => longitude - 0.005, getEast: () => longitude + 0.005,
        getSouth: () => 61.495, getNorth: () => 61.505 }),
      getSource: () => ({}),
      querySourceFeatures: vi.fn(() => [{ geometry: { type: 'Point', coordinates: [longitude, 61.5] }, properties: {} }]),
      queryTerrainElevation: vi.fn(() => 10),
      triggerRepaint: vi.fn(),
    };
    state.map = map;
    state.renderer = { resetState: vi.fn(), render: vi.fn(), dispose: vi.fn() };
    for (const name of ['trunkMesh', 'broadleafMesh', 'coniferMesh', 'palmMesh', 'shrubMesh', 'shadowMesh']) {
      state[name] = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 5000);
      state[name].count = 0;
    }
    const render = () => layer.render({} as any, {
      defaultProjectionData: { mainMatrix: new THREE.Matrix4().elements },
    } as any);
    const finish = () => {
      for (let i = 0; state.treeJob && i < 1000; i += 1) render();
      expect(state.treeJob).toBeUndefined();
    };
    return { layer, state, map, render, finish, pan: () => { longitude += 0.002; } };
  }

  it('keeps the previous buffers and origin until a sliced job commits', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now++);
    const { layer, state, map, render, finish, pan } = fixture();
    const complete = vi.fn();
    layer.updateTrees(complete);
    expect(map.querySourceFeatures).not.toHaveBeenCalled();
    render();
    expect(complete).not.toHaveBeenCalled();
    finish();
    expect(complete).toHaveBeenCalledOnce();
    expect(state.displayedTrees.size).toBe(1);
    const previousMesh = state.trunkMesh;
    const previousOrigin = state.sceneOrigin;
    pan();
    layer.updateTrees();
    render();
    expect(state.trunkMesh).toBe(previousMesh);
    expect(state.sceneOrigin).toBe(previousOrigin);
    finish();
    expect(state.trunkMesh).not.toBe(previousMesh);
    expect(state.sceneOrigin.lng).toBeCloseTo(23.762);
    const newTree = [...state.displayedTrees.values()].find((tree: any) => tree.tree.longitude === 23.762) as any;
    expect(newTree.growthStart).toBeGreaterThan(1000);
    layer.onRemove();
  });

  it('discards stale work on camera changes and terrain invalidation, then allows retry', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now++);
    const { layer, state, render, finish, pan } = fixture();
    const stale = vi.fn();
    layer.updateTrees(stale);
    render();
    pan();
    render();
    expect(state.treeJob).toBeUndefined();
    expect(stale).not.toHaveBeenCalled();
    layer.updateTrees(stale);
    render();
    layer.invalidateTerrain();
    expect(state.treeJob).toBeUndefined();
    const complete = vi.fn();
    layer.updateTrees(complete);
    finish();
    expect(complete).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
    layer.updateTrees(stale);
    layer.onRemove();
    expect(state.treeJob).toBeUndefined();
  });

  it('does not rewrite mature matrices or colors during another tree’s growth', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { layer, state, render, finish, pan } = fixture();
    layer.updateTrees();
    finish();
    now += 700;
    render();
    pan();
    layer.updateTrees();
    finish();
    const matrix = vi.spyOn(state.trunkMesh, 'setMatrixAt');
    const color = vi.spyOn(state.trunkMesh, 'setColorAt');
    now += 100;
    render();
    expect(matrix).toHaveBeenCalledTimes(1);
    expect(matrix.mock.calls[0][0]).toBe(1);
    expect(color).not.toHaveBeenCalled();
    matrix.mockClear();
    layer.setDayNightLighting(null);
    expect(matrix).not.toHaveBeenCalled();
    expect(color).not.toHaveBeenCalled();
    layer.onRemove();
  });

  it('keeps procedural placement deterministic and excludes water after slicing', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { layer, state, map, finish } = fixture();
    state.sources = { sourceId: 'trees', waterLayers: ['water'], vegetationLayers: ['forest'] };
    const polygon = (west: number, east: number) => ({
      properties: { class: 'wood' },
      geometry: { type: 'Polygon', coordinates: [[[west, 61.496], [east, 61.496],
        [east, 61.504], [west, 61.504], [west, 61.496]]] },
    });
    (map.querySourceFeatures as any).mockImplementation((_id: string, options: { sourceLayer: string }) => (
      [options.sourceLayer === 'water' ? polygon(23.76, 23.764) : polygon(23.756, 23.764)]
    ));
    layer.updateTrees();
    finish();
    const trees = [...state.displayedTrees.values()].map((entry: any) => entry.tree);
    expect(trees.length).toBeGreaterThan(10);
    expect(trees.every((tree: any) => tree.longitude < 23.76)).toBe(true);
    state.clearDisplayedTrees();
    layer.updateTrees();
    finish();
    expect([...state.displayedTrees.values()].map((entry: any) => entry.tree)).toEqual(trees);
    layer.onRemove();
  });

  it('shares the frame budget with growth instead of rewriting a new forest in one frame', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { layer, state, map, finish, render } = fixture();
    map.querySourceFeatures.mockReturnValue(Array.from({ length: 800 }, (_, index) => ({
      geometry: { type: 'Point', coordinates: [23.756 + (index % 40) * 0.0002, 61.498 + Math.floor(index / 40) * 0.0002] },
      properties: {},
    })));
    layer.updateTrees();
    finish();
    expect(state.trunkMesh.count).toBe(800);
    const writes = vi.spyOn(state.trunkMesh, 'setMatrixAt');
    let now = 1100;
    clock.mockImplementation(() => now++);
    render();
    expect(state.growthJob).toBeDefined();
    expect(writes.mock.calls.length).toBeLessThan(800);
    now = 2000;
    layer.setTheme(true);
    expect(state.growthAnimationActive).toBe(true);
    for (let frame = 0; state.growthAnimationActive && frame < 5000; frame += 1) render();
    expect(state.growthAnimationActive).toBe(false);
    expect(writes).toHaveBeenCalled();
    layer.onRemove();
  });

  it('stops rendering stale trees once the overview cutoff is exceeded', () => {
    const layer = new TreeModelLayer({
      sourceId: 'openfreemap',
      waterLayers: ['water'],
      vegetationLayers: ['landcover'],
    });
    const map = {
      getZoom: () => 12.5,
      getBounds: () => ({
        getWest: () => 23.7609,
        getSouth: () => 61.4981,
        getEast: () => 23.8600,
        getNorth: () => 61.6200,
      }),
      triggerRepaint: vi.fn(),
    } as any;
    const renderer = {
      resetState: vi.fn(),
      render: vi.fn(),
    } as any;

    (layer as any).map = map;
    (layer as any).renderer = renderer;
    (layer as any).displayedTrees = new Map([['stale', {
      tree: {
        longitude: 23.78,
        latitude: 61.51,
        height: 12,
        leafType: 'broadleaved',
        vegetationType: 'broadleaf',
        rotation: 0,
        widthScale: 1,
        colorVariation: 0,
      },
      elevation: 0,
      mercatorX: 0,
      mercatorY: 0,
      east: 0,
      north: 0,
      up: 0,
      growthStart: 0,
    }]]);

    layer.render({} as any, {
      defaultProjectionData: {
        mainMatrix: new Float32Array(16),
      },
    } as any);

    expect(renderer.render).not.toHaveBeenCalled();
    expect((layer as any).displayedTrees.size).toBe(0);
    layer.render({} as any, {} as any);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });
});
