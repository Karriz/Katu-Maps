import { afterEach, describe, expect, it, vi } from 'vitest';
import { LngLat } from 'maplibre-gl';
import * as THREE from 'three';
import { FacadeModelLayer } from './FacadeModelLayer';
import { RoofModelLayer } from './RoofModelLayer';
import { generateFacadeGeometry } from './FacadeGeometry';
import { flightBuildingView, mergeBuildingGeometries, sortBuildingCandidates } from './BuildingModelWork';

function finish<T>(job: Generator<void, T>): T {
  for (;;) { const result = job.next(); if (result.done) return result.value; }
}
afterEach(() => vi.restoreAllMocks());

it('sorts incrementally and preserves ties', () => {
  const values = Array.from({ length: 200 }, (_, id) => ({ id, area: id % 3 }));
  const job = sortBuildingCandidates(values, (a, b) => b.area - a.area);
  expect(job.next().done).toBe(false);
  expect(finish(job)).toEqual([...values].sort((a, b) => b.area - a.area));
});
it('merges attributes and indices exceeding 16-bit range incrementally', () => {
  const geometries = Array.from({ length: 2 }, () => {
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(120_000).fill(0.5), 3));
    }
    geometry.setIndex([0, 1, 39_999]);
    return geometry;
  });
  const job = mergeBuildingGeometries(geometries);
  expect(job.next().done).toBe(false);
  const merged = finish(job);
  expect(merged.getIndex()!.array).toBeInstanceOf(Uint32Array);
  expect([...merged.getIndex()!.array]).toEqual([0, 1, 39_999, 40_000, 40_001, 79_999]);
  for (const name of ['position', 'normal', 'color']) {
    expect(merged.getAttribute(name).count).toBe(80_000);
    expect(merged.getAttribute(name).getX(79_999)).toBe(0.5);
  }
});
it('bounds windows for every facade style and detail level', () => {
  for (const maxWindows of [128, 256, 512]) for (let featureId = 0; featureId < 4; featureId++) {
    const data = generateFacadeGeometry({ ring: [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]],
      wallHeight: 45, featureId, maxWindows })!;
    expect(data.positions.length / 12).toBeGreaterThan(0);
    expect(data.positions.length / 12).toBeLessThanOrEqual(maxWindows);
  }
});

for (const kind of ['roof', 'facade'] as const) describe(`${kind} scheduling`, () => {
  function fixture(count = 1) {
    const layer = kind === 'roof' ? new RoofModelLayer('buildings') : new FacadeModelLayer('buildings');
    const state = { moving: false, shift: 0, zoom: 17, loaded: true, bearing: 0 };
    const features = Array.from({ length: count }, (_, id) => {
      const x = (id % 20) * 0.0006, y = Math.floor(id / 20) * 0.0006;
      return { id, properties: { render_height: 45, render_min_height: 0 },
        geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.00044, y],
          [x + 0.00044, y + 0.00044], [x, y + 0.00044], [x, y]]] } };
    });
    const map = {
      getBearing: () => state.bearing, getZoom: () => state.zoom, getCenter: () => new LngLat(state.shift, 0),
      getBounds: () => ({ getWest: () => -0.02 + state.shift, getEast: () => 0.02 + state.shift,
        getSouth: () => -0.02, getNorth: () => 0.02 }),
      isMoving: () => state.moving, getSource: () => ({}), isSourceLoaded: () => state.loaded,
      querySourceFeatures: vi.fn(() => features), queryTerrainElevation: () => 0, triggerRepaint: vi.fn(),
    };
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    Object.assign(layer, { map, sceneOrigin: map.getCenter(), [`${kind}Mesh`]: mesh });
    const update = () => kind === 'roof' ? (layer as RoofModelLayer).updateRoofs()
      : (layer as FacadeModelLayer).updateFacades();
    const complete = () => {
      for (let i = 0; i < 10_000; i++) if (update()) return;
      throw new Error('Job did not complete');
    };
    return { layer, map, mesh, state, update, complete };
  }
  it('retains the mesh during gestures and reuses it across small pans', () => {
    const f = fixture(); f.complete();
    const old = f.mesh.geometry;
    f.state.moving = true; f.state.shift = 0.001;
    expect(f.update()).toBe(false);
    f.state.moving = false;
    expect(f.update()).toBe(false);
    expect(f.map.querySourceFeatures).toHaveBeenCalledOnce();
    expect(f.mesh.geometry).toBe(old);
    f.state.shift = 0.01; f.complete();
    expect(f.map.querySourceFeatures).toHaveBeenCalledTimes(2);
    expect(f.mesh.geometry).not.toBe(old);
  });
  it('refreshes on tile changes, zoom level changes and re-enabling', () => {
    const f = fixture(); f.complete();
    f.layer.invalidateSource(); f.complete();
    f.state.zoom++; f.complete();
    f.layer.setEnabled(false); f.layer.setEnabled(true); f.complete();
    expect(f.map.querySourceFeatures).toHaveBeenCalledTimes(4);
  });
  it('keeps old geometry until the complete job commits', () => {
    const f = fixture(); f.complete();
    const old = f.mesh.geometry, dispose = vi.spyOn(old, 'dispose');
    f.layer.invalidateSource();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => ++clock);
    expect(f.update()).toBe(false);
    expect(f.mesh.geometry).toBe(old);
    expect(dispose).not.toHaveBeenCalled();
    f.complete();
    expect(dispose).toHaveBeenCalledOnce();
    expect(f.mesh.geometry).not.toBe(old);
  });
  it('finishes flight jobs despite continuous movement and arriving tiles', () => {
    const f = fixture(20);
    f.complete();
    const old = f.mesh.geometry;
    f.layer.setFlightMode(true);
    f.state.moving = true;
    f.state.loaded = false;
    f.state.zoom = 14;
    // Flight must not depend on ground intersections at screen corners.
    vi.spyOn(f.map, 'getBounds').mockImplementation(() => { throw new Error('horizon'); });
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock += 0.25);
    expect(f.update()).toBe(false);
    expect(f.mesh.geometry).toBe(old);
    const job = (f.layer as any)[`${kind}Job`];
    expect(job).toBeDefined();
    let completed = false;
    for (let frame = 0; frame < 10_000 && !completed; frame++) {
      f.state.shift += 0.0000001;
      f.state.bearing += 0.01;
      f.layer.invalidateSource();
      f.layer.requestFlightRefresh();
      expect((f.layer as any)[`${kind}Job`]).toBe(job);
      completed = f.update();
    }
    expect(completed).toBe(true);
    expect(f.mesh.geometry).not.toBe(old);
    expect(f.mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(f.map.querySourceFeatures).toHaveBeenCalledTimes(2);
    // Tile arrivals during the completed job still require a new sample.
    f.complete();
    expect(f.map.querySourceFeatures).toHaveBeenCalledTimes(3);
    f.layer.setFlightMode(false);
    expect(f.update()).toBe(false); // Ordinary gestures still pause work.
  });

  it('does not rescan every flight frame after completing a scheduled refresh', () => {
    const f = fixture();
    f.layer.setFlightMode(true);
    f.complete();
    for (let frame = 0; frame < 20; frame++) { f.state.shift += 0.000001; f.update(); }
    expect(f.map.querySourceFeatures).toHaveBeenCalledOnce();
    f.layer.requestFlightRefresh();
    f.complete();
    expect(f.map.querySourceFeatures).toHaveBeenCalledTimes(2);
  });
  if (kind === 'facade') it('caps a dense scene at 240,000 vertices', () => {
    const f = fixture(400); f.complete();
    const count = f.mesh.geometry.getAttribute('position').count;
    expect(count).toBeGreaterThan(230_000);
    expect(count).toBeLessThanOrEqual(240_000);
  });
});

it('bounds flight building coverage ahead even when horizon bounds are unusable', () => {
  let bearing = 0;
  const map = { getCenter: () => new LngLat(23.76, 61.5), getBearing: () => bearing, getZoom: () => 14 };
  const north = flightBuildingView(map as any);
  expect(north.north - 61.5).toBeCloseTo((61.5 - north.south) * 3, 7);
  expect(north.east - 23.76).toBeCloseTo(23.76 - north.west, 7);
  bearing = 90;
  const east = flightBuildingView(map as any);
  expect(east.east - 23.76).toBeCloseTo((23.76 - east.west) * 3, 7);
  expect(east.north - 61.5).toBeCloseTo(61.5 - east.south, 7);
});
