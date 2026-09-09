import { describe, expect, it, vi } from 'vitest';
import { LngLat } from 'maplibre-gl';
import { RoofModelLayer } from './RoofModelLayer';

type PolygonRoofGeometry = { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };

type RoofFeature = {
  id: number;
  properties: { render_height: number; render_min_height: number };
  geometry: PolygonRoofGeometry
    | { type: 'MultiPolygon'; coordinates: Array<Array<Array<[number, number]>>> };
};

function rectangle(
  id: number, west = 23.7598, south = 61.4999, width = 0.0004, height = 0.0002,
): RoofFeature & { geometry: PolygonRoofGeometry } {
  return {
    id,
    properties: { render_height: 5, render_min_height: 0 },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south], [west + width, south], [west + width, south + height],
        [west, south + height], [west, south],
      ]],
    },
  };
}

function fixture(features: RoofFeature[]) {
  const layer = new RoofModelLayer('buildings');
  let loaded = false;
  const map = {
    getZoom: () => 15,
    getCenter: () => new LngLat(23.76, 61.5),
    getBounds: () => ({
      getWest: () => 23.75, getSouth: () => 61.49,
      getEast: () => 23.77, getNorth: () => 61.51,
    }),
    getSource: () => ({}),
    isSourceLoaded: () => loaded,
    querySourceFeatures: vi.fn(() => features),
    queryTerrainElevation: () => 0,
    triggerRepaint: vi.fn(),
  };
  (layer as any).map = map;
  (layer as any).sceneOrigin = map.getCenter();
  return {
    layer,
    map,
    setLoaded(value: boolean) { loaded = value; },
    sampledCount: () => (layer as any).sampledRoofCount as number,
  };
}

describe('RoofModelLayer source refresh', () => {
  it('waits for all visible source tiles before committing the view sample', () => {
    const { layer, map, setLoaded, sampledCount } = fixture([rectangle(10)]);

    expect(layer.updateRoofs()).toBe(false);
    expect(map.querySourceFeatures).not.toHaveBeenCalled();
    expect((layer as any).lastViewSignature).toBe('');

    setLoaded(true);
    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    expect(sampledCount()).toBe(1);
    expect((layer as any).lastViewSignature).not.toBe('');
    expect(layer.updateRoofs()).toBe(false);
    expect(map.querySourceFeatures).toHaveBeenCalledOnce();
  });

  it('resamples an unchanged camera after source invalidation', () => {
    const features = [rectangle(10)];
    const { layer, map, setLoaded, sampledCount } = fixture(features);
    setLoaded(true);
    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    expect(sampledCount()).toBe(1);

    features.push(rectangle(20, 23.7604));
    layer.invalidateSource();
    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    expect(sampledCount()).toBe(2);
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2);
  });

  it('does not let an ineligible tile fragment hide a usable duplicate', () => {
    const tinyFragment = rectangle(10, 23.7598, 61.4999, 0.00001, 0.00001);
    const { layer, setLoaded, sampledCount } = fixture([tinyFragment, rectangle(10)]);
    setLoaded(true);

    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    expect(sampledCount()).toBe(1);
  });

  it('keeps one complete roof when tiles repeat a slightly clipped house', () => {
    const clipped = rectangle(20, 23.75981, 61.4999, 0.00036, 0.0002);
    const complete = rectangle(10, 23.7598, 61.4999, 0.0004, 0.0002);
    const { layer, setLoaded, sampledCount } = fixture([clipped, complete]);
    setLoaded(true);

    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    expect(sampledCount()).toBe(1);
  });

  it('does not add a crossing roof to a ground-level part inside a building outline', () => {
    const outline = rectangle(10, 23.7598, 61.4999, 0.0005, 0.00025);
    const overlappingPart = rectangle(20, 23.7601, 61.49996, 0.00016, 0.0001);
    const { layer, setLoaded, sampledCount } = fixture([overlappingPart, outline]);
    setLoaded(true);

    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    expect(sampledCount()).toBe(1);
  });

  it('creates independent roofs for ordinary houses grouped into a MultiPolygon', () => {
    const houses = Array.from({ length: 12 }, (_, index) => (
      rectangle(100, 23.756 + index * 0.001, 61.4999).geometry.coordinates
    ));
    const grouped: RoofFeature = {
      id: 100,
      properties: { render_height: 5, render_min_height: 0 },
      geometry: { type: 'MultiPolygon', coordinates: houses },
    };
    const { layer, setLoaded, sampledCount } = fixture([grouped]);
    setLoaded(true);

    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    // The climate rule intentionally leaves roughly 25% flat; the grouped
    // source feature must still produce roofs across its individual houses.
    expect(sampledCount()).toBeGreaterThanOrEqual(7);
    expect(sampledCount()).toBeLessThanOrEqual(12);
  });

  it('does not draw a flat roof slab over a building with a courtyard hole', () => {
    // A large building outline (~1000 m²) with an inner ring (courtyard).
    // The outer ring is a simple convex rectangle that would normally qualify
    // for a flat roof, but the hole must prevent the slab from covering the
    // open courtyard.
    const w = 23.7598, s = 61.4999;
    const outer: Array<[number, number]> = [
      [w, s], [w + 0.001, s], [w + 0.001, s + 0.001], [w, s + 0.001], [w, s],
    ];
    const inner: Array<[number, number]> = [
      [w + 0.0003, s + 0.0003], [w + 0.0007, s + 0.0003],
      [w + 0.0007, s + 0.0007], [w + 0.0003, s + 0.0007], [w + 0.0003, s + 0.0003],
    ];
    const withCourtyard: RoofFeature = {
      id: 50,
      properties: { render_height: 12, render_min_height: 0 },
      geometry: { type: 'Polygon', coordinates: [outer, inner] },
    };
    const { layer, setLoaded, sampledCount } = fixture([withCourtyard]);
    setLoaded(true);

    expect(completeJob(() => layer.updateRoofs())).toBe(true);
    expect(sampledCount()).toBe(0);
  });
});

function completeJob(update: () => boolean): boolean {
  for (let i = 0; i < 1000; i++) if (update()) return true;
  return false;
}
