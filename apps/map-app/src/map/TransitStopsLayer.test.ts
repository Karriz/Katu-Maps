import { describe, expect, it } from 'vitest';
import {
  buildEstimatedTripLeg,
  estimatedDistance,
  estimatedVehiclePose,
  TransitStopsLayer,
  type TransitVehiclePose,
} from './TransitStopsLayer';

const minute = 60_000;
const baseTime = Date.UTC(2026, 7, 28, 12);

const stop = {
  stopId: 'stop-1',
  name: 'Central stop',
  mode: 'TRAM',
  coordinates: [23.76, 61.5] as [number, number],
  provider: 'transitous' as const,
};

function layerForSelectionTests(onPose: (pose: TransitVehiclePose | null) => void) {
  const source = { setData: () => undefined };
  const layer = new TransitStopsLayer(onPose);
  const internals = layer as unknown as {
    map: { getSource: () => typeof source };
    trackedTrips: { current?: { controller?: AbortController } };
  };
  internals.map = { getSource: () => source };
  internals.trackedTrips = { current: {} };
  return { layer, internals };
}

describe('transit panel and route vehicle selection', () => {
  it('keeps the routed vehicle trip when selecting a stop for the desktop info panel', () => {
    const poses: (TransitVehiclePose | null)[] = [];
    const { layer, internals } = layerForSelectionTests((pose) => poses.push(pose));

    layer.selectSearchStopPreservingTrip(stop);

    expect(internals.trackedTrips.current).toBeDefined();
    expect(poses).toHaveLength(0);
  });

  it('clears the tracked trip for a standalone stop selection', () => {
    const poses: (TransitVehiclePose | null)[] = [];
    const { layer, internals } = layerForSelectionTests((pose) => poses.push(pose));

    layer.selectSearchStop(stop);

    expect(internals.trackedTrips.current).toBeUndefined();
    expect(poses).toHaveLength(1);
    expect(poses[0]).toBeNull();
  });

  it('clears only the selected stop without clearing the routed vehicle trip', () => {
    const poses: (TransitVehiclePose | null)[] = [];
    const { layer, internals } = layerForSelectionTests((pose) => poses.push(pose));

    layer.clearStopSelection();

    expect(internals.trackedTrips.current).toBeDefined();
    expect(poses).toHaveLength(0);
  });
});

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

  it('uses scheduled Transitous stop times when realtime values are absent', () => {
    const leg = buildEstimatedTripLeg({
      provider: 'transitous',
      tripId: 'berlin:scheduled-trip',
      realTime: false,
      from: { stopId: 'a', lon: 13.37, lat: 52.52, scheduledDeparture: baseTime },
      intermediateStops: [{
        stopId: 'b', lon: 13.38, lat: 52.52,
        scheduledArrival: baseTime + 5 * minute,
        scheduledDeparture: baseTime + 6 * minute,
      }],
      to: { stopId: 'c', lon: 13.39, lat: 52.52, scheduledArrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[13.37, 52.52], [13.38, 52.52], [13.39, 52.52]]);

    expect(leg?.anchors.map((anchor) => anchor.time)).toEqual([
      baseTime,
      baseTime + 5 * minute,
      baseTime + 6 * minute,
      baseTime + 10 * minute,
    ]);
    expect(estimatedVehiclePose(leg!, baseTime + 3 * minute, 'BUS', '#123456')?.status)
      .toBe('estimated');
  });

  it('keeps Digitransit realtime stop-time interpolation estimated without coordinates', () => {
    const leg = buildEstimatedTripLeg({
      provider: 'digitransit',
      tripId: 'tampere:no-position',
      realTime: true,
      from: { stopId: 'a', lon: 23.75, lat: 61.49, departure: baseTime },
      to: { stopId: 'b', lon: 23.76, lat: 61.5, arrival: baseTime + 5 * minute },
      coordinates: [],
    }, [[23.75, 61.49], [23.76, 61.5]])!;

    const pose = estimatedVehiclePose(leg, baseTime + 2 * minute, 'TRAM', '#8554c7');
    expect(pose?.status).toBe('estimated');
    expect(pose?.realTime).toBe(false);
  });

  it('approaches conservatively and dwells between arrival and departure', () => {
    const leg = buildEstimatedTripLeg({
      from: { stopId: 'a', lon: 24, lat: 60, departure: baseTime },
      intermediateStops: [{
        stopId: 'b', lon: 24.01, lat: 60,
        arrival: baseTime + 5 * minute,
        departure: baseTime + 6 * minute,
      }],
      to: { stopId: 'c', lon: 24.02, lat: 60, arrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.01, 60], [24.02, 60]])!;
    const stopDistance = leg.anchors[1].distance;

    expect(estimatedDistance(leg, baseTime + 4 * minute + 45_000)).toBeLessThan(stopDistance);
    expect(estimatedDistance(leg, baseTime + 5 * minute)).toBe(stopDistance);
    expect(estimatedDistance(leg, baseTime + 5 * minute + 30_000)).toBe(stopDistance);
    expect(estimatedDistance(leg, baseTime + 6 * minute)).toBe(stopDistance);
  });
});
