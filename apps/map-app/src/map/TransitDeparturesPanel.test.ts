import { describe, expect, it } from 'vitest';
import { selectedRouteStopIndex } from './TransitDeparturesPanel';

describe('selectedRouteStopIndex', () => {
  it('finds a boarding stop well below the beginning by stable ID', () => {
    const routeStops = Array.from({ length: 30 }, (_, index) => ({
      stopId: `stop-${index}`,
      name: index === 4 || index === 23 ? 'Duplicate stop name' : `Stop ${index}`,
    }));

    expect(selectedRouteStopIndex(routeStops, 'stop-23')).toBe(23);
  });

  it('does not fall back to a name or list position when the ID is absent', () => {
    expect(selectedRouteStopIndex([
      { stopId: 'first', name: 'Central' },
      { stopId: 'second', name: 'Central' },
    ], 'missing')).toBe(-1);
  });

  it('matches a station departure to a stop call at one of its platforms', () => {
    expect(selectedRouteStopIndex([
      { stopId: 'digitraffic:platform-1', parentStopId: 'digitraffic:station', name: 'Central' },
    ], 'digitraffic:station')).toBe(0);
  });

  it('uses the selected departure time to disambiguate repeated stop calls', () => {
    expect(selectedRouteStopIndex([
      { stopId: 'loop-stop', departure: '2026-08-28T12:05:00Z' },
      { stopId: 'loop-stop', departure: '2026-08-28T12:45:00Z' },
    ], 'loop-stop', '2026-08-28T12:44:00Z')).toBe(1);
  });
});
