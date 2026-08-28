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
});
