import { describe, expect, it } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { estimatedRoadWidthExpression, estimatedRoadWidthMetres, shouldDrawRoadCenterline } from './RoadWidth';
import {
  bufferPlanLine,
  buildRoadCellPolygons,
  cellsAround,
  clipLineOutsideRects,
  clipPlanLineToRect,
  collectRoadCenterlines,
  densifyPlanLine,
  fallbackLinesForCoverage,
  lngLatsToPlan,
  planOriginFromLngLat,
  planToLngLat,
  roadWorkCellAt,
  stitchRoadCenterlines,
  bufferPlanRings,
  type RoadCenterline,
} from './RoadPolygonGeometry';

const TAMPERE: [number, number] = [23.7609, 61.4981];
const ROAD_CELL_HALF = 128;

function pointInRing(point: { east: number; north: number }, ring: Array<{ east: number; north: number }>) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const last = ring[previous];
    const intersects = (current.north > point.north) !== (last.north > point.north)
      && point.east < (
        (last.east - current.east) * (point.north - current.north)
        / ((last.north - current.north) || 1e-9)
      ) + current.east;
    if (intersects) inside = !inside;
  }
  return inside;
}

function road(coordinates: Array<[number, number]>, extra: Record<string, unknown> = {}): RoadCenterline {
  return {
    coordinates,
    properties: { className: 'primary', layer: 0, ramp: false, ...extra },
  };
}

describe('road width model', () => {
  it('matches the MapLibre expression for class, ramp and service widths', () => {
    const compiled = createExpression(estimatedRoadWidthExpression(), 'road-width-model');
    if (compiled.result !== 'success') throw new Error('Invalid width expression');
    const cases = [
      { class: 'motorway' },
      { class: 'minor' },
      { class: 'motorway', ramp: 1 },
      { class: 'service', service: 'driveway' },
      { class: 'service' },
    ];
    for (const properties of cases) {
      const expected = estimatedRoadWidthMetres({
        className: String(properties.class),
        ramp: properties.ramp === 1,
        service: 'service' in properties ? properties.service : undefined,
      });
      expect(compiled.value.evaluate({ zoom: 16 }, { properties } as never)).toBe(expected);
    }
  });

  it('draws centerlines only on wide paved carriageways', () => {
    expect(shouldDrawRoadCenterline({ className: 'motorway' })).toBe(true);
    expect(shouldDrawRoadCenterline({ className: 'secondary' })).toBe(true);
    expect(shouldDrawRoadCenterline({ className: 'tertiary' })).toBe(false);
    expect(shouldDrawRoadCenterline({ className: 'minor' })).toBe(false);
    expect(shouldDrawRoadCenterline({ className: 'motorway', ramp: true })).toBe(false);
    expect(shouldDrawRoadCenterline({ className: 'primary', surface: 'unpaved' })).toBe(false);
    expect(shouldDrawRoadCenterline({ className: 'primary', surface: 'gravel' })).toBe(false);
  });
});

describe('road polygon geometry', () => {
  it('buffers a straight road to the estimated metre width', () => {
    const origin = planOriginFromLngLat(...TAMPERE);
    const line = lngLatsToPlan([
      TAMPERE,
      [TAMPERE[0] + 0.002, TAMPERE[1]],
    ], origin);
    const ring = bufferPlanLine(line, 5);
    expect(pointInRing({ east: (line[0].east + line[1].east) / 2, north: 4.5 }, ring)).toBe(true);
    expect(pointInRing({ east: (line[0].east + line[1].east) / 2, north: 5.6 }, ring)).toBe(false);
  });

  it('clips buffered polygons to the cell so cell cuts are square, not rounded', () => {
    const cell = roadWorkCellAt(...TAMPERE);
    const origin = planOriginFromLngLat((cell.west + cell.east) / 2, (cell.south + cell.north) / 2);
    const start = planToLngLat({ east: -80, north: 0 }, origin);
    const end = planToLngLat({ east: 80, north: 0 }, origin);
    const result = buildRoadCellPolygons(cell, [road([start, end], { className: 'motorway' })]);
    const surface = result.polygons.filter((feature) => feature.properties.kind === 'surface');
    expect(surface.length).toBeGreaterThan(0);
    const ring = surface[0].geometry.coordinates[0].map(([lng, lat]) => lngLatsToPlan([[lng, lat]], origin)[0]);
    const maxEast = Math.max(...ring.map((point) => point.east));
    const minEast = Math.min(...ring.map((point) => point.east));
    expect(maxEast).toBeLessThanOrEqual(ROAD_CELL_HALF + 0.05);
    expect(minEast).toBeGreaterThanOrEqual(-ROAD_CELL_HALF - 0.05);
    expect(result.polygons.some((feature) => feature.properties.kind === 'casing')).toBe(true);
  });

  it('joins adjacent cells without a gap on a continuous carriageway', () => {
    const originCell = roadWorkCellAt(...TAMPERE);
    const neighbor = cellsAround(TAMPERE[0], TAMPERE[1], 400, 9)
      .find((cell) => cell.ix === originCell.ix + 1 && cell.iy === originCell.iy);
    expect(neighbor).toBeTruthy();
    const origin = planOriginFromLngLat((originCell.west + neighbor!.east) / 2, TAMPERE[1]);
    const line = [
      planToLngLat({ east: -200, north: 0 }, origin),
      planToLngLat({ east: 200, north: 0 }, origin),
    ];
    const left = buildRoadCellPolygons(originCell, [road(line)]);
    const right = buildRoadCellPolygons(neighbor!, [road(line)]);
    const leftEdge = left.polygons.find((feature) => feature.properties.kind === 'surface')!
      .geometry.coordinates[0];
    const rightEdge = right.polygons.find((feature) => feature.properties.kind === 'surface')!
      .geometry.coordinates[0];
    const leftMaxLng = Math.max(...leftEdge.map((point) => point[0]));
    const rightMinLng = Math.min(...rightEdge.map((point) => point[0]));
    expect(Math.abs(leftMaxLng - rightMinLng)).toBeLessThan(0.00002);
  });

  it('keeps parallel carriageways as separate surfaces with a median gap', () => {
    const cell = roadWorkCellAt(...TAMPERE);
    const origin = planOriginFromLngLat((cell.west + cell.east) / 2, (cell.south + cell.north) / 2);
    const south = [
      planToLngLat({ east: -40, north: 0 }, origin),
      planToLngLat({ east: 40, north: 0 }, origin),
    ];
    const north = [
      planToLngLat({ east: -40, north: 20 }, origin),
      planToLngLat({ east: 40, north: 20 }, origin),
    ];
    const result = buildRoadCellPolygons(cell, [road(south, { className: 'trunk' }), road(north, { className: 'trunk' })]);
    const surfaces = result.polygons.filter((feature) => feature.properties.kind === 'surface');
    expect(surfaces).toHaveLength(2);
    const rings = surfaces.map((feature) => feature.geometry.coordinates[0].map(
      ([lng, lat]) => lngLatsToPlan([[lng, lat]], origin)[0],
    ));
    const median = { east: 0, north: 10 };
    expect(rings.some((ring) => pointInRing(median, ring))).toBe(false);
  });

  it('ignores bridges, tunnels, paths and duplicate tile fragments', () => {
    const lines = collectRoadCenterlines([
      { geometry: { type: 'LineString', coordinates: [TAMPERE, [TAMPERE[0] + 0.001, TAMPERE[1]]] }, properties: { class: 'path' } },
      { geometry: { type: 'LineString', coordinates: [TAMPERE, [TAMPERE[0] + 0.001, TAMPERE[1]]] }, properties: { class: 'primary', brunnel: 'bridge' } },
      { geometry: { type: 'LineString', coordinates: [TAMPERE, [TAMPERE[0] + 0.001, TAMPERE[1]]] }, properties: { class: 'primary', brunnel: 'tunnel' } },
      { geometry: { type: 'LineString', coordinates: [TAMPERE, [TAMPERE[0] + 0.001, TAMPERE[1]]] }, properties: { class: 'primary' } },
      { geometry: { type: 'LineString', coordinates: [TAMPERE, [TAMPERE[0] + 0.001, TAMPERE[1]]] }, properties: { class: 'primary' } },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].properties.className).toBe('primary');
  });

  it('stitches tile-clipped fragments before buffering', () => {
    const left = road([TAMPERE, [TAMPERE[0] + 0.0004, TAMPERE[1]]]);
    const right = road([[TAMPERE[0] + 0.0004, TAMPERE[1]], [TAMPERE[0] + 0.0008, TAMPERE[1]]]);
    const stitched = stitchRoadCenterlines([left, right]);
    expect(stitched).toHaveLength(1);
    expect(stitched[0].coordinates[0]).toEqual(TAMPERE);
    expect(stitched[0].coordinates.at(-1)?.[0]).toBeCloseTo(TAMPERE[0] + 0.0008, 6);
  });

  it('clips fallback lines to completed cells with a seam allowance', () => {
    const cell = roadWorkCellAt(...TAMPERE);
    const origin = planOriginFromLngLat((cell.west + cell.east) / 2, (cell.south + cell.north) / 2);
    const coordinates = [
      planToLngLat({ east: -400, north: 0 }, origin),
      planToLngLat({ east: 400, north: 0 }, origin),
    ];
    const parts = clipLineOutsideRects(coordinates, [cell], 0.6);
    expect(parts.length).toBeGreaterThan(0);
    const midLng = (cell.west + cell.east) / 2;
    const coveredInterior = parts.some((part) => part.some(([lng]) => Math.abs(lng - midLng) < 0.0003));
    expect(coveredInterior).toBe(false);
  });

  it('clips a line to the interior of a rectangle', () => {
    const rect = { minEast: -10, maxEast: 10, minNorth: -10, maxNorth: 10 };
    const parts = clipPlanLineToRect([
      { east: -20, north: 0 },
      { east: 20, north: 0 },
    ], rect);
    expect(parts).toHaveLength(1);
    expect(parts[0][0].east).toBeCloseTo(-10, 5);
    expect(parts[0].at(-1)?.east).toBeCloseTo(10, 5);
  });

  it('adds dashed centerlines on wide roads and skips narrow, ramp, and unpaved ones', () => {
    const cell = roadWorkCellAt(...TAMPERE);
    const origin = planOriginFromLngLat((cell.west + cell.east) / 2, (cell.south + cell.north) / 2);
    const start = planToLngLat({ east: -80, north: 0 }, origin);
    const end = planToLngLat({ east: 80, north: 0 }, origin);
    const wide = buildRoadCellPolygons(cell, [road([start, end], { className: 'secondary' })]);
    expect(wide.centerlines.length).toBeGreaterThan(0);
    const allInside = wide.centerlines.every((feature) => (
      feature.geometry.coordinates.every(([lng, lat]) => {
        const point = lngLatsToPlan([[lng, lat]], origin)[0];
        return Math.abs(point.east) <= ROAD_CELL_HALF + 0.05 && Math.abs(point.north) <= ROAD_CELL_HALF + 0.05;
      })
    ));
    expect(allInside).toBe(true);
    expect(buildRoadCellPolygons(cell, [road([start, end], { className: 'minor' })]).centerlines).toHaveLength(0);
    expect(buildRoadCellPolygons(cell, [road([start, end], { className: 'motorway', ramp: true })]).centerlines).toHaveLength(0);
    expect(buildRoadCellPolygons(cell, [road([start, end], { className: 'primary', surface: 'unpaved' })]).centerlines).toHaveLength(0);
  });

  it('smooths a closed roundabout instead of buffering an octagon with miters', () => {
    const origin = planOriginFromLngLat(...TAMPERE);
    const radius = 18;
    const loop: Array<{ east: number; north: number }> = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      loop.push({ east: Math.cos(angle) * radius, north: Math.sin(angle) * radius });
    }
    loop.push({ ...loop[0] });
    const densified = densifyPlanLine(loop, 12);
    expect(densified.length).toBeGreaterThan(loop.length * 2);
    const rings = bufferPlanRings(densified, 4);
    expect(rings.length).toBe(2);
    const distances = rings[0].map((point) => Math.hypot(point.east, point.north));
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(2.2);
    const island = { east: 0, north: 0 };
    expect(pointInRing(island, rings[0])).toBe(true);
    expect(pointInRing(island, rings[1])).toBe(true);
    const cell = roadWorkCellAt(...TAMPERE);
    const coordinates = loop.map((point) => planToLngLat(point, origin));
    const polygons = buildRoadCellPolygons(cell, [road(coordinates, { className: 'primary' })]);
    const surface = polygons.polygons.find((feature) => feature.properties.kind === 'surface');
    expect(surface).toBeTruthy();
    expect(surface!.geometry.coordinates.length).toBe(2);
    expect(surface!.geometry.coordinates[0].length).toBeGreaterThan(20);
  });

  it('keeps a right-angle city corner from becoming a roundabout arc', () => {
    const origin = planOriginFromLngLat(...TAMPERE);
    const corner = densifyPlanLine(lngLatsToPlan([
      planToLngLat({ east: -40, north: 0 }, origin),
      planToLngLat({ east: 0, north: 0 }, origin),
      planToLngLat({ east: 0, north: 40 }, origin),
    ], origin), 12);
    expect(corner.some((point) => point.east > 4 && point.north > 4)).toBe(false);
  });

  it('ignores far-away roads when collecting nearby centerlines', () => {
    const nearby = collectRoadCenterlines([
      { geometry: { type: 'LineString', coordinates: [TAMPERE, [TAMPERE[0] + 0.001, TAMPERE[1]]] }, properties: { class: 'primary' } },
      { geometry: { type: 'LineString', coordinates: [[24.9, 60.2], [24.91, 60.2]] }, properties: { class: 'motorway' } },
    ], { longitude: TAMPERE[0], latitude: TAMPERE[1], metres: 2200 });
    expect(nearby).toHaveLength(1);
    expect(nearby[0].properties.className).toBe('primary');
  });

  it('densifies long segments so draped vertices can follow terrain', () => {
    const origin = planOriginFromLngLat(...TAMPERE);
    const points = densifyPlanLine(lngLatsToPlan([TAMPERE, [TAMPERE[0] + 0.003, TAMPERE[1]]], origin), 12);
    expect(points.length).toBeGreaterThan(8);
  });

  it('keeps fallback lines for uncovered range while dropping replaced cell interiors', () => {
    const cell = roadWorkCellAt(...TAMPERE);
    const origin = planOriginFromLngLat((cell.west + cell.east) / 2, TAMPERE[1]);
    const line = road([
      planToLngLat({ east: -500, north: 0 }, origin),
      planToLngLat({ east: 500, north: 0 }, origin),
    ]);
    const features = fallbackLinesForCoverage([line], [cell], {
      longitude: TAMPERE[0], latitude: TAMPERE[1], metres: 2000,
    });
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((feature) => feature.geometry.coordinates.length >= 2)).toBe(true);
  });
});
