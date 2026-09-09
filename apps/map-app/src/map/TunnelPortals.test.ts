import { describe, expect, it, vi } from 'vitest';
import type { Feature, LineString, Position } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { installTunnelPortals, tunnelPortals } from './TunnelPortals';

const line = (coordinates: Position[], tunnel = false, kind = 'primary'): Feature<LineString> => ({
  type: 'Feature', properties: { class: kind, ...(tunnel ? { brunnel: 'tunnel' } : {}) },
  geometry: { type: 'LineString', coordinates },
});
const a = [23, 61];
const b = [23.001, 61];
const c = [23.002, 61];

describe('tunnel entrance shadows', () => {
  it('draws short inward shadows only where tunnels meet surface geometry', () => {
    const data = tunnelPortals([
      line([a, b], true), line([[22.999, 61], a]), line([b, c]),
    ]);
    expect(data.features).toHaveLength(2);
    for (const feature of data.features) {
      const [mouth, tip] = feature.geometry.coordinates;
      expect(Math.abs(tip[0] - mouth[0])).toBeLessThan(0.0001);
      expect(tip[0]).toBeGreaterThan(a[0]);
      expect(tip[0]).toBeLessThan(b[0]);
    }
  });

  it('omits clipped endpoints, internal joins, and duplicate tile copies', () => {
    const tunnel = line([a, b], true);
    const data = tunnelPortals([tunnel, tunnel, line([b, c], true), line([[22.999, 61], a])]);
    expect(data.features).toHaveLength(1);
    expect(data.features[0].geometry.coordinates[0]).toEqual(a);
    expect(tunnelPortals([tunnel]).features).toEqual([]);
  });

  it('supports multipart rail tunnels and does not mistake roads for rail mouths', () => {
    const rail = line([a, b], true, 'rail');
    const multipart: Feature = { ...rail, geometry: { type: 'MultiLineString', coordinates: [[a, b], [b, c]] } };
    expect(tunnelPortals([multipart, line([[22.999, 61], a])]).features).toEqual([]);
    expect(tunnelPortals([multipart, line([[22.999, 61], a], false, 'rail')]).features).toHaveLength(1);
  });

  it('handles repeated vertices and coordinate noise at connections', () => {
    expect(tunnelPortals([
      line([a, a, b], true), line([[22.999, 61], [23.000001, 61]]),
    ]).features).toHaveLength(1);
    expect(tunnelPortals([line([a, a], true), line([a, b])]).features).toEqual([]);
  });

  it('refreshes on tile changes without an idle/setData loop and removes listeners', () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const setData = vi.fn();
    const querySourceFeatures = vi.fn(() => [line([a, b], true), line([a, c])]);
    const map = {
      on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
      getSource: () => ({ setData }), getZoom: () => 16, querySourceFeatures,
    };
    const dispose = installTunnelPortals(map as unknown as MapLibreMap);
    handlers.get('idle')!();
    handlers.get('sourcedata')!({ sourceId: 'tunnel-portals' });
    handlers.get('idle')!();
    expect(querySourceFeatures).toHaveBeenCalledTimes(1);
    handlers.get('sourcedata')!({ sourceId: 'openfreemap' });
    handlers.get('idle')!();
    expect(querySourceFeatures).toHaveBeenCalledTimes(2);
    expect(setData).toHaveBeenCalledTimes(1);
    dispose();
    expect(handlers.size).toBe(0);
  });
});
