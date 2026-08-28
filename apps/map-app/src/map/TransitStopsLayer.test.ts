import { describe, expect, it } from 'vitest';
import { buildEstimatedTripLeg, estimatedDistance } from './TransitStopsLayer';

const minute = 60_000;
const baseTime = Date.UTC(2026, 7, 28, 12);

describe('transit vehicle estimation', () => {
  it('orients reversed geometry in stop-call order', () => {
    const leg = buildEstimatedTripLeg({
      tripId: 'service:trip',
      from: { stopId: 'first', lon: 24, lat: 60, departure: 0 },
      to: { stopId: 'last', lon: 24.02, lat: 60, arrival: 10 * minute },
      coordinates: [],
    }, [[24.02, 60], [24.01, 60], [24, 60]]);

    expect(leg?.coordinates[0]).toEqual([24, 60]);
    expect(leg?.anchors.map((anchor) => anchor.stopId)).toEqual(['first', 'last']);
    expect(leg?.anchors[1].distance).toBeGreaterThan(leg?.anchors[0].distance ?? 0);
  });

  it('keeps loop-route stop anchors monotonic', () => {
    const leg = buildEstimatedTripLeg({
      from: { stopId: 'start', lon: 24, lat: 60, departure: 0 },
      intermediateStops: [{ stopId: 'middle', lon: 24.01, lat: 60, arrival: 5 * minute }],
      to: { stopId: 'return', lon: 24, lat: 60, arrival: 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.01, 60], [24, 60]]);

    expect(leg?.anchors.map((anchor) => anchor.distance)).toEqual([
      0,
      leg?.cumulativeDistances[1],
      leg?.cumulativeDistances[2],
    ]);
  });

  it('does not advance beyond an upcoming boarding stop', () => {
    const leg = buildEstimatedTripLeg({
      from: { stopId: 'origin', lon: 24, lat: 60, departure: baseTime },
      intermediateStops: [{ stopId: 'board', lon: 24.01, lat: 60, departure: baseTime + 8 * minute }],
      to: { stopId: 'end', lon: 24.02, lat: 60, arrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.01, 60], [24.02, 60]]);
    expect(leg).toBeDefined();
    const unconstrained = estimatedDistance(leg!, baseTime + 9 * minute);
    const constrained = estimatedDistance(leg!, baseTime + 9 * minute, {
      stopId: 'board', coordinates: [24.01, 60], departureTime: baseTime + 10 * minute,
    });

    expect(constrained).toBe(leg!.anchors[1].distance);
    expect(unconstrained).toBeGreaterThan(constrained!);
  });
});
