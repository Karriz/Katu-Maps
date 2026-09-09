import { describe, expect, it, vi } from 'vitest';
import { LngLat } from 'maplibre-gl';
import { FacadeModelLayer } from './FacadeModelLayer';

type PolygonGeometry = { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };

type FacadeFeature = {
  id: number;
  properties: { render_height: number; render_min_height: number };
  geometry: PolygonGeometry
    | { type: 'MultiPolygon'; coordinates: Array<Array<Array<[number, number]>>> };
};

function rectangle(
  id: number, west = 23.7598, south = 61.4999, width = 0.0004, height = 0.0002,
  renderHeight = 9,
): FacadeFeature & { geometry: PolygonGeometry } {
  return {
    id,
    properties: { render_height: renderHeight, render_min_height: 0 },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south], [west + width, south], [west + width, south + height],
        [west, south + height], [west, south],
      ]],
    },
  };
}

function fixture(features: FacadeFeature[], renderHeight = 9) {
  const layer = new FacadeModelLayer('buildings');
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
    sampledCount: () => (layer as any).sampledFacadeCount as number,
  };
}

describe('FacadeModelLayer source refresh', () => {
  it('waits for all visible source tiles before committing the view sample', () => {
    const { layer, map, setLoaded, sampledCount } = fixture([rectangle(10)]);

    expect(layer.updateFacades()).toBe(false);
    expect(map.querySourceFeatures).not.toHaveBeenCalled();
    expect((layer as any).lastViewSignature).toBe('');

    setLoaded(true);
    expect(completeJob(() => layer.updateFacades())).toBe(true);
    expect(sampledCount()).toBe(1);
    expect((layer as any).lastViewSignature).not.toBe('');
    expect(layer.updateFacades()).toBe(false);
    expect(map.querySourceFeatures).toHaveBeenCalledOnce();
  });

  it('resamples an unchanged camera after source invalidation', () => {
    const features = [rectangle(10)];
    const { layer, map, setLoaded, sampledCount } = fixture(features);
    setLoaded(true);
    expect(completeJob(() => layer.updateFacades())).toBe(true);
    expect(sampledCount()).toBe(1);

    features.push(rectangle(20, 23.7604));
    layer.invalidateSource();
    expect(completeJob(() => layer.updateFacades())).toBe(true);
    expect(sampledCount()).toBe(2);
    expect(map.querySourceFeatures).toHaveBeenCalledTimes(2);
  });

  it('does not let an ineligible tile fragment hide a usable duplicate', () => {
    const tinyFragment = rectangle(10, 23.7598, 61.4999, 0.00001, 0.00001);
    const { layer, setLoaded, sampledCount } = fixture([tinyFragment, rectangle(10)]);
    setLoaded(true);

    expect(completeJob(() => layer.updateFacades())).toBe(true);
    expect(sampledCount()).toBe(1);
  });

  it('keeps one facade set when tiles repeat a slightly clipped building', () => {
    const clipped = rectangle(20, 23.75981, 61.4999, 0.00036, 0.0002);
    const complete = rectangle(10, 23.7598, 61.4999, 0.0004, 0.0002);
    const { layer, setLoaded, sampledCount } = fixture([clipped, complete]);
    setLoaded(true);

    expect(completeJob(() => layer.updateFacades())).toBe(true);
    expect(sampledCount()).toBe(1);
  });

  it('creates independent facades for houses grouped into a MultiPolygon', () => {
    const houses = Array.from({ length: 12 }, (_, index) => (
      rectangle(100, 23.756 + index * 0.001, 61.4999).geometry.coordinates
    ));
    const grouped: FacadeFeature = {
      id: 100,
      properties: { render_height: 9, render_min_height: 0 },
      geometry: { type: 'MultiPolygon', coordinates: houses },
    };
    const { layer, setLoaded, sampledCount } = fixture([grouped]);
    setLoaded(true);

    expect(completeJob(() => layer.updateFacades())).toBe(true);
    expect(sampledCount()).toBe(12);
  });

  it('skips buildings that are too short for facades', () => {
    const short = rectangle(10, 23.7598, 61.4999, 0.0004, 0.0002, 2);
    const { layer, setLoaded, sampledCount } = fixture([short]);
    setLoaded(true);

    expect(completeJob(() => layer.updateFacades())).toBe(true);
    expect(sampledCount()).toBe(0);
  });
});

function completeJob(update: () => boolean): boolean {
  for (let i = 0; i < 1000; i++) if (update()) return true;
  return false;
}
