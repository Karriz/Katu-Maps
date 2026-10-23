import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LngLat } from 'maplibre-gl';
import {
  ShadowCatcherLayer,
  appendBuildingCaster,
  groundCellSize,
  groundGridSignature,
  groundGridWindow,
  shadowReachMeters,
  shadowTextureSizes,
  terrainShadowHalfSpanMeters,
  triangulateRing,
  type ShadowCasterSet,
} from './ShadowCatcherLayer';

describe('terrainShadowHalfSpanMeters', () => {
  it('focuses the shadow map at close zoom', () => {
    expect(terrainShadowHalfSpanMeters(16, 45)).toBe(700);
    expect(terrainShadowHalfSpanMeters(17.5, 45)).toBe(350);
    expect(terrainShadowHalfSpanMeters(18, 45)).toBe(300);
  });

  it('keeps more coverage for pitched close views', () => {
    expect(terrainShadowHalfSpanMeters(18, 65)).toBe(425);
    expect(terrainShadowHalfSpanMeters(18, 65)).toBeGreaterThan(terrainShadowHalfSpanMeters(18, 45));
  });
});

describe('shadowTextureSizes', () => {
  it('increases both shadow and terrain-height detail at close zoom', () => {
    expect(shadowTextureSizes(14, 1200, 8192)).toEqual({ shadow: 1536, height: 768 });
    expect(shadowTextureSizes(16, 1200, 8192)).toEqual({ shadow: 2560, height: 1024 });
    expect(shadowTextureSizes(17, 1200, 8192)).toEqual({ shadow: 4096, height: 1536 });
  });

  it('keeps smaller device and GPU texture budgets', () => {
    expect(shadowTextureSizes(17, 600, 8192)).toEqual({ shadow: 2048, height: 1024 });
    expect(shadowTextureSizes(17, 1200, 2048)).toEqual({ shadow: 2048, height: 1536 });
  });
});

describe('shadowReachMeters', () => {
  it('stretches at low sun up to the elevation clamp', () => {
    const clampReach = 45 / Math.tan(8 * Math.PI / 180);
    expect(shadowReachMeters(89.9)).toBeCloseTo(clampReach, 6);
    expect(shadowReachMeters(88)).toBeCloseTo(clampReach, 6);
    expect(shadowReachMeters(88)).toBeGreaterThan(shadowReachMeters(80));
  });

  it('shrinks toward the caster height at noon sun', () => {
    const highSun = shadowReachMeters(35);
    const lowSun = shadowReachMeters(80);
    expect(highSun).toBeLessThan(50);
    expect(lowSun).toBeGreaterThan(highSun);
  });

  it('never reaches below the minimum margin', () => {
    expect(shadowReachMeters(0)).toBeGreaterThanOrEqual(30);
  });
});

describe('groundCellSize', () => {
  it('steps down to street-level sampling at high zoom', () => {
    expect(groundCellSize(13)).toBe(56);
    expect(groundCellSize(14)).toBe(36);
    expect(groundCellSize(16)).toBe(28);
    expect(groundCellSize(17)).toBe(22);
  });
});

describe('groundGridWindow', () => {
  it('snaps the window onto world-anchored cells', () => {
    const first = groundGridWindow({ minX: -100, minZ: -100, maxX: 100, maxZ: 100 }, 16);
    const drifted = groundGridWindow({ minX: -102, minZ: -102, maxX: 98, maxZ: 98 }, 16);
    expect(first).toEqual(drifted);
    expect(first.minCellX).toBe(-7);
    expect(first.cellsX).toBe(14);
  });

  it('doubles the cell size when the span exceeds the vertex budget', () => {
    const window = groundGridWindow({ minX: -10_000, minZ: -10_000, maxX: 10_000, maxZ: 10_000 }, 12);
    expect(window.cellsX).toBeLessThanOrEqual(160);
    expect(window.cellsZ).toBeLessThanOrEqual(160);
    expect(window.cell).toBeGreaterThan(12);
  });

  it('keeps a stable signature while the view drifts inside one window', () => {
    const first = groundGridWindow({ minX: -100, minZ: -100, maxX: 100, maxZ: 100 }, 16);
    const drifted = groundGridWindow({ minX: -102, minZ: -102, maxX: 98, maxZ: 98 }, 16);
    expect(groundGridSignature(drifted, 15, 0)).toBe(groundGridSignature(first, 15, 0));
    expect(groundGridSignature(first, 15, 1)).not.toBe(groundGridSignature(first, 15, 0));
  });
});

describe('triangulateRing', () => {
  it('triangulates a square into two triangles', () => {
    const triangles = triangulateRing([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(triangles).not.toBeNull();
    expect(triangles).toHaveLength(6);
  });

  it('triangulates a concave L-shape without losing area', () => {
    const ring: Array<[number, number]> = [
      [0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20],
    ];
    const triangles = triangulateRing(ring);
    expect(triangles).not.toBeNull();
    const points = ring;
    let area = 0;
    for (let index = 0; index < triangles!.length; index += 3) {
      const [ax, ay] = points[triangles![index]];
      const [bx, by] = points[triangles![index + 1]];
      const [cx, cy] = points[triangles![index + 2]];
      area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    }
    expect(area).toBeCloseTo(300, 6);
  });

  it('handles reversed winding and closing vertices', () => {
    const clockwise: Array<[number, number]> = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    expect(triangulateRing(clockwise)).toHaveLength(6);
    const degenerate = triangulateRing([[0, 0], [5, 5]]);
    expect(degenerate).toBeNull();
  });
});

describe('appendBuildingCaster', () => {
  it('emits a closed prism with caps and walls', () => {
    const ring: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const triangles = triangulateRing(ring)!;
    const positions: number[] = [];
    const indices: number[] = [];
    const vertices = appendBuildingCaster(positions, indices, ring, triangles, 2, 12);
    expect(vertices).toBe(8);
    expect(indices).toHaveLength(36);
    const yValues = new Set<number>();
    for (let index = 1; index < positions.length; index += 3) yValues.add(positions[index]);
    expect(yValues).toEqual(new Set([2, 12]));
  });
});

describe('ShadowCatcherLayer', () => {
  afterEach(() => vi.restoreAllMocks());

  function fixture() {
    const layer = new ShadowCatcherLayer('source');
    const state = layer as any;
    const buildingFeature = {
      id: 1,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [23.76, 61.5], [23.761, 61.5], [23.761, 61.5001], [23.76, 61.5001], [23.76, 61.5],
        ]],
      },
      properties: { render_height: 20, render_min_height: 0 },
    };
    const map = {
      getZoom: () => 15,
      getPitch: () => 30,
      getCanvas: () => ({ clientWidth: 1200 }),
      getCenter: () => new LngLat(23.76, 61.5),
      getBounds: () => ({ getWest: () => 23.755, getEast: () => 23.765,
        getSouth: () => 61.495, getNorth: () => 61.505 }),
      getSource: () => ({}),
      getTerrain: () => ({ source: 'terrain' }),
      getLayer: (id: string) => (id === 'global-buildings' || id === 'caster-layer' ? {} : undefined),
      getLayoutProperty: vi.fn(() => 'visible'),
      isMoving: () => false,
      querySourceFeatures: vi.fn(() => [buildingFeature]),
      queryTerrainElevation: vi.fn((_point: LngLat) => 10),
      triggerRepaint: vi.fn(),
    };
    state.map = map;
    const glStub = {
      getParameter: () => null,
      bindFramebuffer: () => undefined,
    };
    state.renderer = {
      resetState: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
      getContext: () => glStub,
    };
    state.groundMaterial = new THREE.ShadowMaterial();
    state.groundMesh = new THREE.Mesh(new THREE.BufferGeometry(), state.groundMaterial);
    state.groundMesh.visible = false;
    state.buildingMesh = new THREE.Mesh(new THREE.BufferGeometry(), state.casterMaterial);
    state.buildingMesh.visible = false;
    state.sunlight = new THREE.DirectionalLight();
    state.scene.add(state.groundMesh, state.buildingMesh);
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now++);
    const render = () => layer.render({} as any, {
      defaultProjectionData: { mainMatrix: new THREE.Matrix4().elements },
    } as any);
    const finish = (maxRenders = 2000) => {
      let settled = 0;
      for (let index = 0; index < maxRenders && settled < 3; index += 1) {
        render();
        settled = state.groundJob || state.buildingJob ? 0 : settled + 1;
      }
      expect(state.groundJob).toBeUndefined();
      expect(state.buildingJob).toBeUndefined();
    };
    return { layer, state, map, render, finish };
  }

  it('builds the draped ground mesh and building casters under frame budgets', () => {
    const { layer, state, finish } = fixture();
    const activeHandler = vi.fn();
    layer.setActiveChangeHandler(activeHandler);
    finish();
    expect(state.active).toBe(true);
    expect(activeHandler).toHaveBeenCalledWith(true);
    expect(state.groundMesh.visible).toBe(true);
    const positions = state.groundMesh.geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThan(100);
    expect(state.groundMesh.geometry.getIndex()!.count % 6).toBe(0);
    expect(state.buildingMesh.visible).toBe(true);
    const buildingPositions = state.buildingMesh.geometry.getAttribute('position');
    expect(buildingPositions.count).toBe(8);
    const yValues = new Set<number>();
    for (let index = 1; index < buildingPositions.count * 3; index += 3) {
      yValues.add(buildingPositions.array[index]);
    }
    // Ground elevation 10 minus origin elevation 0: base at 10, top at 30.
    expect(yValues).toEqual(new Set([10, 30]));
    layer.onRemove();
    expect(activeHandler).toHaveBeenCalledWith(false);
  });

  it('keeps terrain tile textures cached until a zoom gesture settles', () => {
    const { layer, state, map, finish } = fixture();
    finish();
    map.getZoom = () => 16.9;
    let moving = true;
    map.isMoving = () => moving;
    state.tileDrape = {
      heightSize: 1024,
      resizeHeightMap: vi.fn(),
      updateHeightMap: vi.fn(),
      dispose: vi.fn(),
    };
    state.renderer.shadowMap = { type: THREE.BasicShadowMap };
    state.renderer.properties = { get: () => ({ __webglTexture: {} }) };
    state.sunlight.shadow.map = { depthTexture: {}, setSize: vi.fn() };
    state.tileReady = true;
    state.tileDirty = true;
    const revision = layer.terrainTileRevision;
    const gl = { getParameter: () => null, bindFramebuffer: vi.fn() };
    const options = { renderTerrainHeightMap: vi.fn() };

    layer.prerender(gl as any, options as any);
    expect(layer.terrainTileRevision).toBe(revision);
    expect(state.tileReady).toBe(true);
    expect(state.tileRevisionPending).toBe(true);

    map.getZoom = () => 17;
    layer.prerender(gl as any, options as any);
    expect(layer.terrainTileRevision).toBe(revision);
    expect(state.shadowMapSize).toBe(2560);
    expect(state.tileDrape.heightSize).toBe(1024);

    moving = false;
    layer.prerender(gl as any, options as any);
    expect(layer.terrainTileRevision).toBe(revision + 1);
    expect(state.shadowMapSize).toBe(4096);
    expect(state.tileRevisionPending).toBe(false);
    layer.onRemove();
  });

  it('builds coarse building casters first and finishes through source updates', () => {
    const { layer, state, map } = fixture();
    const finishBuildingJob = () => {
      for (let step = 0; step < 1000 && state.buildingJob; step += 1) state.stepBuildingJob();
      expect(state.buildingJob).toBeUndefined();
    };
    state.startBuildingJob(map);
    expect(state.buildingJob.quality).toBe('coarse');
    finishBuildingJob();
    expect(state.buildingMesh.visible).toBe(true);
    state.startBuildingJob(map);
    const fineJob = state.buildingJob;
    expect(fineJob.quality).toBe('fine');
    layer.invalidateSource();
    state.startBuildingJob(map);
    expect(state.buildingJob).toBe(fineJob);
    finishBuildingJob();
    state.startBuildingJob(map);
    expect(state.buildingJob.quality).toBe('fine');
    finishBuildingJob();
    expect(state.performanceStats.buildingCommits).toBe(3);
    layer.onRemove();
  });

  it('mirrors caster meshes but skips blob decals and hidden layers', () => {
    const { layer, state, map, render, finish } = fixture();
    const casterScene = new THREE.Scene();
    const casterMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 2),
      new THREE.MeshLambertMaterial(),
    );
    const instanced = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 4, 6),
      new THREE.MeshLambertMaterial(),
      8,
    );
    instanced.count = 3;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ depthWrite: false, transparent: true }),
    );
    casterScene.add(casterMesh, instanced, decal);
    const set: ShadowCasterSet = {
      layerId: 'caster-layer',
      root: () => casterScene,
      origin: () => ({ longitude: 23.761, latitude: 61.5005, elevation: 12 }),
    };
    layer.registerCasters('test', set);
    finish();

    const entry = state.casters.get('test');
    expect(entry.proxies.size).toBe(2);
    const instancedProxy = entry.proxies.get(instanced) as THREE.InstancedMesh;
    expect(instancedProxy.count).toBe(3);
    expect(instancedProxy.instanceMatrix).toBe(instanced.instanceMatrix);
    expect(instancedProxy.castShadow).toBe(true);

    // Hidden MapLibre layer suspends the whole caster set.
    map.getLayoutProperty.mockReturnValue('none');
    render();
    expect(instancedProxy.visible).toBe(false);
    map.getLayoutProperty.mockReturnValue('visible');

    // Removing a mesh removes its proxy on the next sync.
    casterScene.remove(instanced);
    render();
    expect(entry.proxies.size).toBe(1);
    layer.onRemove();
  });

  it('does not build building casters while the 3D buildings layer is hidden', () => {
    const { layer, state, map, finish } = fixture();
    map.getLayer = () => undefined;
    finish();
    expect(state.buildingMesh.visible).toBe(false);
    expect(state.buildingMesh.geometry.getAttribute('position')).toBeUndefined();
    expect(state.groundMesh.visible).toBe(true);
    layer.onRemove();
  });

  it('clears the catcher and restores the decal fallback below the zoom gate', () => {
    const { layer, state, map, render, finish } = fixture();
    const activeHandler = vi.fn();
    layer.setActiveChangeHandler(activeHandler);
    finish();
    expect(state.active).toBe(true);
    map.getZoom = () => 12;
    render();
    expect(state.active).toBe(false);
    expect(state.groundMesh.visible).toBe(false);
    expect(state.buildingMesh.visible).toBe(false);
    expect(activeHandler).toHaveBeenLastCalledWith(false);
    layer.onRemove();
  });

  it('shows a coarse catcher before the detailed terrain pass completes', () => {
    const { layer, state, render, finish } = fixture();
    for (let frame = 0; frame < 1000 && state.performanceStats.groundCommits === 0; frame += 1) {
      render();
    }
    expect(state.performanceStats.groundCommits).toBe(1);
    expect(state.active).toBe(true);
    const coarseGeometry = state.groundMesh.geometry;
    render();
    expect(state.groundJob?.quality).toBe('fine');
    finish();
    expect(state.groundMesh.geometry).not.toBe(coarseGeometry);
    expect(state.performanceStats.groundCommits).toBeGreaterThanOrEqual(2);
    layer.onRemove();
  });

  it('lifts the catcher over a ridge between grid vertices', () => {
    const { layer, state, map, finish } = fixture();
    const window = state.currentGroundWindow(map);
    const frame = state.localFrame();
    const ridgeCellX = 10;
    const ridgeCellZ = 10;
    const ridge = frame.toLngLat(
      (window.minCellX + ridgeCellX + 0.5) * window.cell,
      (window.minCellZ + ridgeCellZ + 0.5) * window.cell,
    );
    map.queryTerrainElevation = vi.fn((point: LngLat) =>
      Math.abs(point.lng - ridge.lng) < 1e-8 && Math.abs(point.lat - ridge.lat) < 1e-8
        ? 12 : 0);
    finish();
    const positions = state.groundMesh.geometry.getAttribute('position');
    const topLeft = ridgeCellZ * (window.cellsX + 1) + ridgeCellX;
    const bottomLeft = topLeft + window.cellsX + 1;
    for (const vertex of [topLeft, topLeft + 1, bottomLeft, bottomLeft + 1]) {
      expect(positions.getY(vertex)).toBeGreaterThan(12);
    }
    layer.onRemove();
  });

  it('restores the completed catcher after crossing the minimum zoom', () => {
    const { layer, state, map, render, finish } = fixture();
    finish();
    const geometry = state.groundMesh.geometry;
    map.getZoom = () => 12;
    render();
    expect(state.active).toBe(false);
    map.getZoom = () => 15;
    render();
    expect(state.active).toBe(true);
    expect(state.groundMesh.visible).toBe(true);
    expect(state.buildingMesh.visible).toBe(true);
    expect(state.groundMesh.geometry).toBe(geometry);
    layer.onRemove();
  });

  it('restores decal shadows while rebuilding beyond the completed ground', () => {
    const { layer, state, map, render, finish } = fixture();
    const activeHandler = vi.fn();
    layer.setActiveChangeHandler(activeHandler);
    finish();
    map.getCenter = () => new LngLat(23.86, 61.5);
    map.getBounds = () => ({ getWest: () => 23.855, getEast: () => 23.865,
      getSouth: () => 61.495, getNorth: () => 61.505 });
    const commitsBeforePan = state.performanceStats.groundCommits;
    render();
    expect(state.active).toBe(false);
    expect(state.groundJob?.quality).toBe('coarse');
    expect(activeHandler).toHaveBeenLastCalledWith(false);
    for (let frame = 0; frame < 1000
      && state.performanceStats.groundCommits === commitsBeforePan; frame += 1) render();
    expect(state.active).toBe(true);
    expect(activeHandler).toHaveBeenLastCalledWith(true);
    finish();
    layer.onRemove();
  });

  it('recenters before a high-zoom pan leaves the bounded ground window', () => {
    const { layer, state, map, render, finish } = fixture();
    finish();
    const center = new LngLat(23.79, 61.5); // About 1.6 km, under the old 2 km threshold.
    map.getCenter = () => center;
    map.getBounds = () => ({ getWest: () => 23.788, getEast: () => 23.792,
      getSouth: () => 61.498, getNorth: () => 61.502 });
    render();
    expect(state.sceneOrigin.lng).toBe(center.lng);
    finish();
    expect(state.groundBounds.minX).toBeLessThan(0);
    expect(state.groundBounds.maxX).toBeGreaterThan(0);
    expect(state.active).toBe(true);
    layer.onRemove();
  });

  it('keeps ground shadows during a pan and starts replacement work while moving', () => {
    const { layer, state, map, render, finish } = fixture();
    finish();
    const completed = state.groundMesh.geometry;
    map.isMoving = () => true;
    map.getCenter = () => new LngLat(23.762, 61.5);
    map.getBounds = () => ({ getWest: () => 23.757, getEast: () => 23.767,
      getSouth: () => 61.495, getNorth: () => 61.505 });
    render();
    expect(state.active).toBe(true);
    expect(state.groundMesh.geometry).toBe(completed);
    expect(state.groundJob).toBeUndefined();

    map.getCenter = () => new LngLat(23.772, 61.5);
    map.getBounds = () => ({ getWest: () => 23.767, getEast: () => 23.777,
      getSouth: () => 61.495, getNorth: () => 61.505 });
    render();
    expect(state.groundJob).toBeDefined();
    finish();
    expect(state.active).toBe(true);
    expect(state.groundMesh.geometry).not.toBe(completed);
    layer.onRemove();
  });

  it('focuses the shadow camera more tightly than the ground pan buffer', () => {
    const { layer, state, render, finish } = fixture();
    finish();
    render();
    const groundHalfSpan = (state.groundBounds.maxX - state.groundBounds.minX) * 0.5;
    expect(state.sunlight.shadow.camera.right).toBeLessThan(groundHalfSpan);
    layer.onRemove();
  });

  it('finishes an in-flight ground job despite a newer terrain revision', () => {
    const { layer, state, render, finish } = fixture();
    finish();
    const before = state.performanceStats.groundCommits;
    layer.invalidateTerrain();
    render();
    const job = state.groundJob;
    expect(job).toBeDefined();
    layer.invalidateTerrain();
    render();
    expect(state.groundJob).toBe(job);
    finish();
    expect(state.performanceStats.groundCommits).toBeGreaterThanOrEqual(before + 2);
    layer.onRemove();
  });

  it('rebuilds a flat catcher when terrain is switched off', () => {
    const { layer, state, map, finish } = fixture();
    finish();
    const terrainGeometry = state.groundMesh.geometry;
    map.getTerrain = () => null as any;
    finish();
    expect(state.groundMesh.geometry).not.toBe(terrainGeometry);
    const positions = state.groundMesh.geometry.getAttribute('position');
    expect(positions.getY(0)).toBeCloseTo(0.3);
    layer.onRemove();
  });

  it('resamples the ground after terrain invalidation', () => {
    const { layer, state, map, render, finish } = fixture();
    finish();
    const committed = state.groundMesh.geometry;
    map.queryTerrainElevation = vi.fn(() => 24);
    layer.invalidateTerrain();
    render();
    expect(state.groundJob).toBeDefined();
    finish();
    expect(state.groundMesh.geometry).not.toBe(committed);
    layer.onRemove();
  });
});
