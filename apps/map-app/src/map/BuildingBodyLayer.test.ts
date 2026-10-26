import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import { BuildingBodyLayer, appendBuildingBody, buildingBodyLocalPoint, closeBuildingZoom, rotationStableBuildingView } from './BuildingBodyLayer';

describe('building lifecycle and lighting', () => {
  function fixture() {
    const layer = new BuildingBodyLayer('buildings');
    const state = { loaded: true, empty: false, longitude: 0 };
    const canvas = { width: 1440, height: 900 };
    const map = {
      getCanvas: () => canvas,
      getZoom: () => 17,
      getCenter: () => new maplibregl.LngLat(state.longitude, 0),
      getBounds: () => new maplibregl.LngLatBounds(
        [state.longitude - 0.01, -0.01], [state.longitude + 0.01, 0.01]),
      getSource: () => ({}),
      querySourceFeatures: () => state.empty ? [] : [{ id: 1, properties: {}, geometry: {
        type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
      } }],
      isSourceLoaded: () => state.loaded,
      queryTerrainElevation: () => 0,
      triggerRepaint: vi.fn(),
    };
    const build = () => {
      const job = (layer as any).build(map, rotationStableBuildingView(map as never), 0);
      while (!job.next().done) { /* Finish the incremental build. */ }
    };
    build();
    const renderer = {
      shadowMap: { enabled: true },
      dispose: vi.fn(), resetState: vi.fn(), render: vi.fn(), setViewport: vi.fn(),
      getContext: () => ({ FRAMEBUFFER_BINDING: 0, FRAMEBUFFER: 1,
        getParameter: () => null, bindFramebuffer: vi.fn() }),
    };
    Object.assign(layer, { map, active: true, renderer });
    const render = () => layer.render({} as never, {
      defaultProjectionData: { mainMatrix: new THREE.Matrix4().toArray() },
    } as never);
    return { layer, state, build, renderer, render, canvas };
  }

  it('updates the shadow restore viewport when the map drawing buffer resizes', () => {
    const f = fixture();
    f.render();
    expect(f.renderer.setViewport).toHaveBeenLastCalledWith(0, 0, 1440, 900);
    f.canvas.width = 412;
    f.canvas.height = 915;
    f.render();
    expect(f.renderer.setViewport).toHaveBeenLastCalledWith(0, 0, 412, 915);
    f.layer.onRemove();
  });

  it('retires geometry and shadow casters after panning into a loaded empty area', () => {
    const f = fixture();
    expect(f.layer.getDebugState().vertices).toBeGreaterThan(0);
    f.state.longitude = 1;
    f.state.empty = true;
    f.build();
    expect(f.layer.getDebugState()).toMatchObject({ active: false, vertices: 0 });
    expect(f.layer.shadowCasterScene()).toBeUndefined();
    f.layer.onRemove();
  });

  it('clears cached buildings when the loaded source becomes empty in the same view', () => {
    const f = fixture();
    f.state.empty = true;
    f.build();
    expect(f.layer.getDebugState()).toMatchObject({ active: false, vertices: 0, cachedParts: 0 });
    f.layer.onRemove();
  });

  it('retains the previous scene during an empty streaming snapshot, then clears it once loaded', () => {
    const f = fixture();
    const previous = f.layer.getDebugState();
    f.state.longitude = 1;
    f.state.empty = true;
    f.state.loaded = false;
    f.build();
    expect(f.layer.getDebugState()).toMatchObject({
      active: true, vertices: previous.vertices, readyView: previous.readyView,
    });
    expect(f.layer.shadowCasterScene()).toBeDefined();
    f.state.loaded = true;
    f.build();
    expect(f.layer.getDebugState()).toMatchObject({ active: false, vertices: 0 });
    f.layer.onRemove();
  });

  it('uses the shared caster pass when available and resumes self-shadows when it retires', () => {
    const f = fixture();
    let shared = true;
    f.layer.setShadowSource(() => shared ? {
      texture: {} as WebGLTexture, matrix: new THREE.Matrix4(), origin: f.layer.shadowCasterOrigin(),
    } : undefined);
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(1);
    expect(f.renderer.shadowMap.enabled).toBe(false);
    expect(f.layer.getDebugState().sharedShadowMapReady).toBe(true);
    shared = false;
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(3);
    expect(f.renderer.shadowMap.enabled).toBe(true);
    expect(f.layer.getDebugState().sharedShadowMapReady).toBe(false);
    f.layer.onRemove();
  });

  it('samples the completed local depth map with the slope-aware receiver', () => {
    const f = fixture();
    const target = new THREE.WebGLRenderTarget(32, 32);
    target.depthTexture = new THREE.DepthTexture(32, 32);
    const texture = {} as WebGLTexture;
    Object.assign(f.renderer, { properties: { get: () => ({ __webglTexture: texture }) } });
    f.renderer.render.mockImplementationOnce(() => {
      (f.layer as any).sunlight.shadow.map = target;
    });
    f.render();
    const state = f.layer as any;
    expect(state.selfShadowMap()).toMatchObject({ texture, origin: f.layer.shadowCasterOrigin() });
    expect(state.selfShadowMap().matrix).toBe(state.sunlight.shadow.matrix);
    expect(state.modelShadows.isEnabled()).toBe(true);
    expect(state.mesh.receiveShadow).toBe(false);
    expect(state.material.shadowSide).toBe(THREE.DoubleSide);
    expect(f.layer.getDebugState().sharedShadowMapReady).toBe(false);
    f.layer.onRemove();
  });

  it('skips unresolved city-scale self-shadows and resumes them when coverage tightens', () => {
    const f = fixture();
    const state = f.layer as any;
    state.mesh.geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-3000, 0, -3000), new THREE.Vector3(3000, 10, 3000));
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(1);
    expect(state.selfShadowStrength()).toBe(0);
    expect(state.modelShadows.isEnabled()).toBe(false);
    state.mesh.geometry.computeBoundingBox();
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(3);
    expect(state.selfShadowStrength()).toBe(1);
    f.layer.onRemove();
  });

  it.each(['azimuth', 'polar'] as const)('refreshes shadows after cumulative small %s changes', (axis) => {
    const f = fixture();
    const lighting = { azimuth: 100, polar: 40, nightMix: 0 };
    f.layer.setDayNightLighting(lighting);
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(2); // Shadow pass, then building color.
    for (const delta of [0.1, 0.2]) {
      f.layer.setDayNightLighting({ ...lighting, [axis]: lighting[axis] + delta });
      f.render();
    }
    expect(f.renderer.render).toHaveBeenCalledTimes(4); // Reuse the completed shadow map.
    f.layer.setDayNightLighting({ ...lighting, [axis]: lighting[axis] + 0.3 });
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(6);
    f.layer.onRemove();
  });

  it('measures sun movement across the azimuth wrap using the shortest angle', () => {
    const f = fixture();
    f.layer.setDayNightLighting({ azimuth: 359.9, polar: 40, nightMix: 0 });
    f.render();
    f.layer.setDayNightLighting({ azimuth: 0.1, polar: 40, nightMix: 0 });
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(3);
    f.layer.setDayNightLighting({ azimuth: 0.2, polar: 40, nightMix: 0 });
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(5);
    f.layer.onRemove();
  });
});

describe('closeBuildingZoom', () => {
  it('uses separate entry and exit zooms', () => {
    expect(closeBuildingZoom(12.9, false)).toBe(false);
    expect(closeBuildingZoom(13, false)).toBe(true);
    expect(closeBuildingZoom(12.9, true)).toBe(true);
    expect(closeBuildingZoom(12.7, true)).toBe(false);
  });
});

describe('building coordinate and view handoff', () => {
  it('places points north of the origin in positive local z', () => {
    const origin = maplibregl.MercatorCoordinate.fromLngLat([23.7609, 61.4981]);
    const units = origin.meterInMercatorCoordinateUnits();
    const north = buildingBodyLocalPoint(23.7609, 61.4991, origin, units);
    const east = buildingBodyLocalPoint(23.7619, 61.4981, origin, units);
    expect(north[1]).toBeGreaterThan(0);
    expect(east[0]).toBeGreaterThan(0);
    expect(Math.abs(north[0])).toBeLessThan(0.01);
  });

  it('keeps a rotation-safe geographic window around the camera', () => {
    const center = new maplibregl.LngLat(23.7609, 61.4981);
    const map = {
      getCenter: () => center,
      getZoom: () => 17.2,
      getBounds: () => new maplibregl.LngLatBounds([23.7509, 61.4961], [23.7709, 61.5001]),
    };
    const view = rotationStableBuildingView(map as never);
    const longitudeScale = Math.cos(center.lat * Math.PI / 180);
    expect((view.east - center.lng) * longitudeScale).toBeCloseTo(view.north - center.lat);
    expect((center.lng - view.west) * longitudeScale).toBeCloseTo(center.lat - view.south);
    expect(view.west).toBeLessThan(23.7509);
    expect(view.north).toBeGreaterThan(61.5001);
  });
});

describe('appendBuildingBody', () => {
  it('records metre contact distances without baking a dark gradient into sunlight', () => {
    const buffers = { positions: [] as number[], normals: [] as number[], colors: [] as number[],
      uvs: [] as number[], contact: [] as number[] };
    const color = new THREE.Color('#eeeeee');
    appendBuildingBody(buffers, [[[0, 0], [10, 0], [10, 10], [0, 10]]], 100, 112, color);
    for (let index = 6; index < buffers.positions.length / 3; index += 1) {
      expect(buffers.contact[index * 2]).toBe(buffers.positions[index * 3 + 1] - 100);
      expect(buffers.contact[index * 2 + 1]).toBe(112 - buffers.positions[index * 3 + 1]);
      expect(buffers.colors.slice(index * 3, index * 3 + 3)).toEqual([color.r, color.g, color.b]);
    }
    const elevated = { positions: [] as number[], normals: [] as number[], colors: [] as number[],
      uvs: [] as number[], contact: [] as number[] };
    appendBuildingBody(elevated, [[[0, 0], [10, 0], [10, 10], [0, 10]]], 105, 112, color, false);
    for (let index = 6; index < elevated.positions.length / 3; index += 1) {
      expect(elevated.contact[index * 2]).toBe(-1);
    }
  });

  it('caps the building and points wall normals outward', () => {
    const buffers = { positions: [] as number[], normals: [] as number[], colors: [] as number[], uvs: [] as number[] };
    const vertices = appendBuildingBody(buffers,
      [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], 2, 12, new THREE.Color('#eeeeee'));
    expect(vertices).toBe(30);
    for (let index = 0; index < 6; index += 1) {
      expect(buffers.normals[index * 3 + 1]).toBe(1);
    }
    expect(buffers.normals.slice(18, 21)).toEqual([0, 0, -1]);
    const roof = buffers.positions.slice(0, 18);
    for (let index = 0; index < roof.length; index += 9) {
      const ax = roof[index], az = roof[index + 2];
      const bx = roof[index + 3], bz = roof[index + 5];
      const cx = roof[index + 6], cz = roof[index + 8];
      expect((bx - ax) * (cz - az) - (bz - az) * (cx - ax)).toBeLessThan(0);
    }
  });

  it('keeps a courtyard out of the roof cap', () => {
    const buffers = { positions: [] as number[], normals: [] as number[], colors: [] as number[], uvs: [] as number[] };
    appendBuildingBody(buffers, [
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[3, 3], [3, 7], [7, 7], [7, 3]],
    ], 0, 10, new THREE.Color('#eeeeee'));
    const roofVertices = buffers.normals.reduce((sum, _unused, index) =>
      index % 3 === 1 && buffers.normals[index] === 1 ? sum + 1 : sum, 0);
    let area = 0;
    for (let index = 0; index < roofVertices * 3; index += 9) {
      const ax = buffers.positions[index], az = buffers.positions[index + 2];
      const bx = buffers.positions[index + 3], bz = buffers.positions[index + 5];
      const cx = buffers.positions[index + 6], cz = buffers.positions[index + 8];
      area += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
    }
    expect(area).toBeCloseTo(84);
  });
});
