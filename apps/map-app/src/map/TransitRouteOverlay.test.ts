import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map } from 'maplibre-gl';
import { fetchWithTimeout } from './ApiRequest';
import {
  TransitRouteOverlay,
  railRouteFeatures,
  transitRouteBoundsContain,
  transitRouteRequestBounds,
} from './TransitRouteOverlay';

function encodePolyline(coordinates: [number, number][], precision = 5) {
  const factor = 10 ** precision;
  let latitude = 0;
  let longitude = 0;
  const encode = (difference: number) => {
    let value = difference < 0 ? ~(difference << 1) : difference << 1;
    let result = '';
    while (value >= 0x20) {
      result += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    return result + String.fromCharCode(value + 63);
  };
  return coordinates.map(([nextLongitude, nextLatitude]) => {
    const roundedLatitude = Math.round(nextLatitude * factor);
    const roundedLongitude = Math.round(nextLongitude * factor);
    const result = encode(roundedLatitude - latitude) + encode(roundedLongitude - longitude);
    latitude = roundedLatitude;
    longitude = roundedLongitude;
    return result;
  }).join('');
}

describe('TransitRouteOverlay', () => {
  it('prefetches a half viewport margin around route requests', () => {
    const requestBounds = transitRouteRequestBounds({ south: 60, west: 24, north: 61, east: 26 });

    expect(requestBounds).toEqual({ south: 59.5, west: 23, north: 61.5, east: 27 });
    expect(transitRouteBoundsContain(requestBounds, {
      south: 60.25, west: 25, north: 61.25, east: 27,
    })).toBe(true);
    expect(transitRouteBoundsContain(requestBounds, {
      south: 60.25, west: 25, north: 61.25, east: 27.01,
    })).toBe(false);
  });

  it('keeps padded request coordinates within geographic limits', () => {
    expect(transitRouteRequestBounds({ south: -89, west: -179, north: 89, east: 179 }))
      .toEqual({ south: -90, west: -180, north: 90, east: 180 });
  });

  it('keeps only rail-based route polylines and preserves their route color', () => {
    const features = railRouteFeatures({
      routes: [
        { mode: 'TRAM', transitRoutes: [{ shortName: '3', color: 'D93D3D' }] },
        { mode: 'BUS', transitRoutes: [{ shortName: '8', color: '0055CC' }] },
      ],
      polylines: [{
        polyline: { points: encodePolyline([[0, 0], [0.01, 0.01]]), precision: 5 },
        routeIndexes: [0, 1],
      }],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties).toEqual({ color: '#D93D3D', label: '3', mode: 'TRAM' });
    expect(features[0].geometry.coordinates).toEqual([[0, 0], [0.01, 0.01]]);
  });

  it('uses app-consistent mode colors when a route has no usable color', () => {
    const features = railRouteFeatures({
      routes: [
        { mode: 'SUBWAY', transitRoutes: [{ shortName: 'M' }] },
        { mode: 'TRAM', transitRoutes: [{ shortName: '3', color: 'not-a-color' }] },
        { mode: 'RAIL', transitRoutes: [{ shortName: 'IC' }] },
      ],
      polylines: [{
        polyline: { points: encodePolyline([[0, 0], [0.01, 0.01]]), precision: 5 },
        routeIndexes: [0, 1, 2],
      }],
    });

    expect(features.map((feature) => feature.properties.color)).toEqual([
      '#e87524', '#8554c7', '#4f9b70',
    ]);
  });

  it('splits rail geometry at implausibly long segments and preserves valid fragments', () => {
    const firstFragment: [number, number][] = [[24, 60], [24.01, 60.01]];
    const secondFragment: [number, number][] = [[24.01, 60.03], [24.02, 60.04]];
    const features = railRouteFeatures({
      routes: [{ mode: 'RAIL', transitRoutes: [{ shortName: 'IC' }] }],
      polylines: [{
        polyline: { points: encodePolyline([...firstFragment, ...secondFragment]), precision: 5 },
        routeIndexes: [0],
      }],
    });

    expect(features.map((feature) => feature.geometry.coordinates)).toEqual([
      firstFragment,
      secondFragment,
    ]);
    expect(features.map((feature) => feature.id)).toEqual(['0:0:0', '0:0:1']);
  });
});

vi.mock('./ApiRequest', async (original) => ({
  ...await original<typeof import('./ApiRequest')>(),
  fetchWithTimeout: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

describe('transit route request lifecycle', () => {
  it('invalidates an unrelated pending response when returning to loaded coverage', async () => {
    const setData = vi.fn();
    const map = {
      addSource: vi.fn(), addLayer: vi.fn(), getLayer: () => undefined,
      getSource: () => ({ setData }),
    } as unknown as Map;
    const overlay = new TransitRouteOverlay();
    overlay.install(map);
    overlay.setVisibility(true);
    const bounds = (west: number) => ({
      getWest: () => west, getEast: () => west + 1, getSouth: () => 60, getNorth: () => 61,
    });
    const response = { ok: true, json: async () => ({}) } as Response;
    let finishPending!: (value: Response) => void;
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(response)
      .mockImplementationOnce(() => new Promise((resolve) => { finishPending = resolve; }));
    await overlay.update(bounds(20), 9);
    expect(setData).toHaveBeenCalledTimes(1);
    const pending = overlay.update(bounds(25), 9);
    const signal = vi.mocked(fetchWithTimeout).mock.calls[1][1]?.signal;
    await overlay.update(bounds(20), 9);
    expect(signal?.aborted).toBe(true);
    // Even a response already being decoded when aborted must not replace the source.
    finishPending(response);
    await pending;
    expect(setData).toHaveBeenCalledTimes(1);
    await overlay.update(bounds(20), 9);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    // The cancelled coverage remains fetchable on a later visit.
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(response);
    await overlay.update(bounds(25), 9);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(3);
    expect(setData).toHaveBeenCalledTimes(2);
    overlay.dispose();
  });
});
