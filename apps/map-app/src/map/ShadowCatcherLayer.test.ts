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
  triangulateRing,
  type ShadowCasterSet,
} from './ShadowCatcherLayer';

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
      getCenter: () => new LngLat(23.76, 61.5),
      getBounds: () => ({ getWest: () => 23.755, getEast: () => 23.765,
        getSouth: () => 61.495, getNorth: () => 61.505 }),
      getSource: () => ({}),
      getLayer: (id: string) => (id === 'global-buildings' || id === 'caster-layer' ? {} : undefined),
      getLayoutProperty: vi.fn(() => 'visible'),
      isMoving: () => false,
      querySourceFeatures: vi.fn(() => [buildingFeature]),
      queryTerrainElevation: vi.fn(() => 10),
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
