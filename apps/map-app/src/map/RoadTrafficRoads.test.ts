import { describe, expect, it } from 'vitest';
import { clampTrafficBbox, parseOverpassRoads, trafficRoadsRequestKey } from './RoadTrafficRoads';

describe('viewport road fetching', () => {
  it('rejects a country-sized bbox so Overpass is only used in view', () => {
    expect(clampTrafficBbox([19, 59, 32, 70])).toBeUndefined();
    expect(clampTrafficBbox([24.0, 60.0, 26.0, 61.0])).toBeUndefined();
    expect(clampTrafficBbox([25.00, 60.22, 25.06, 60.26])).toEqual([25.00, 60.22, 25.06, 60.26]);
    expect(clampTrafficBbox([24.6, 60.12, 25.4, 60.38])).toEqual([24.6, 60.12, 25.4, 60.38]);
  });

  it('refetches when crossing the snap zoom even if the bbox is unchanged', () => {
    const bbox: [number, number, number, number] = [25.00, 60.22, 25.06, 60.26];
    expect(trafficRoadsRequestKey(bbox, 10.1)).toMatch(/^chord:/);
    expect(trafficRoadsRequestKey(bbox, 10.3)).not.toBe(trafficRoadsRequestKey(bbox, 10.1));
  });

  it('keeps major highways and drops footpaths', () => {
    const ways = parseOverpassRoads({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { highway: 'trunk', ref: '101', name: 'Kehä I' },
          geometry: [
            { lat: 60.2413, lon: 25.0293 },
            { lat: 60.2414, lon: 25.0310 },
          ],
        },
        {
          type: 'way',
          id: 2,
          tags: { highway: 'footway' },
          geometry: [
            { lat: 60.2413, lon: 25.0293 },
            { lat: 60.2415, lon: 25.0294 },
          ],
        },
      ],
    });
    expect(ways).toHaveLength(1);
    expect(ways[0]).toMatchObject({ ref: '101', highway: 'trunk' });
    expect(ways[0].coordinates[0]).toEqual([25.0293, 60.2413]);
  });
});
