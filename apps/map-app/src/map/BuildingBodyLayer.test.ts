import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import { appendBuildingBody, buildingBodyLocalPoint, closeBuildingZoom, rotationStableBuildingView } from './BuildingBodyLayer';

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
