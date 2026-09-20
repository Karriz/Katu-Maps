import { describe, expect, it } from 'vitest';
import {
  buildEstimatedTripLeg,
  blendVehiclePoses,
  estimatedDistance,
  estimatedVehiclePose,
  observedVehiclePose,
  transitStopIconCollisionLayout,
  TransitStopsLayer,
  type TransitVehiclePose,
} from './TransitStopsLayer';
import { beginObservedPositionTransition } from './transit/vehiclePosition';

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

describe('transit stop icon collisions', () => {
  it('keeps rail and tram icons visible while they reserve space from bus stops', () => {
    expect(transitStopIconCollisionLayout(true)).toMatchObject({
      'icon-allow-overlap': true,
      'icon-ignore-placement': false,
    });
  });

  it('continues decluttering ordinary bus stop icons', () => {
    expect(transitStopIconCollisionLayout(false)).toMatchObject({
      'icon-allow-overlap': false,
      'icon-ignore-placement': false,
    });
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

  it('projects stop anchors onto route segments instead of snapping to vertices', () => {
    const leg = buildEstimatedTripLeg({
      from: { stopId: 'start', lon: 24, lat: 60, departure: baseTime },
      intermediateStops: [{ stopId: 'middle', lon: 24.005, lat: 60, arrival: baseTime + 5 * minute }],
      to: { stopId: 'end', lon: 24.01, lat: 60, arrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.01, 60]])!;

    expect(leg.anchors[1].distance).toBeCloseTo(leg.cumulativeDistances[1] / 2, 4);
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

  it('caps a repeated stop at the resolved occurrence rather than the first one', () => {
    const leg = buildEstimatedTripLeg({
      from: { stopId: 'loop', lon: 24, lat: 60, departure: baseTime },
      intermediateStops: [{ stopId: 'turn', lon: 24.01, lat: 60, arrival: baseTime + 5 * minute }],
      to: { stopId: 'loop', lon: 24, lat: 60, arrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.01, 60], [24, 60]])!;
    const finalDistance = leg.anchors.find((anchor) => anchor.stopIndex === 2)!.distance;
    const distance = estimatedDistance(leg, baseTime + 9 * minute, {
      stopId: 'loop', coordinates: [24, 60], departureTime: baseTime + 11 * minute,
    }, finalDistance);
    expect(distance).toBeGreaterThan(leg.anchors[0].distance);
    expect(distance).toBeLessThanOrEqual(finalDistance);
  });

  it('blends an expired live position into its estimate without a jump', () => {
    const pose = (longitude: number, status: TransitVehiclePose['status']): TransitVehiclePose => ({
      mode: 'BUS', color: '#123456', status, realTime: status === 'live',
      hasLeftStartingStop: true,
      parts: [{ coordinates: [longitude, 60], heading: 0 }],
    });
    expect(blendVehiclePoses(pose(24, 'live'), pose(24.01, 'estimated'), 0).parts[0].coordinates[0]).toBe(24);
    expect(blendVehiclePoses(pose(24, 'live'), pose(24.01, 'estimated'), 0.5).parts[0].coordinates[0]).toBeCloseTo(24.005);
    expect(blendVehiclePoses(pose(24, 'live'), pose(24.01, 'estimated'), 1).parts[0].coordinates[0]).toBe(24.01);
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
    expect(estimatedVehiclePose(leg, baseTime - minute, 'TRAM', '#8554c7')?.hasLeftStartingStop).toBe(false);
    expect(pose?.hasLeftStartingStop).toBe(true);
  });

  it('keeps route geometry available for live observations when the timeline is unusable', () => {
    const leg = {
      provider: 'digitransit' as const,
      tripId: 'tampere:live-without-times',
      realTime: false,
      from: { stopId: 'a', lon: 23.75, lat: 61.49 },
      to: { stopId: 'b', lon: 23.76, lat: 61.5 },
      coordinates: [] as [number, number][],
    };
    const coordinates = [[23.75, 61.49], [23.76, 61.5]] as [number, number][];

    expect(buildEstimatedTripLeg(leg, coordinates)).toBeUndefined();
    expect(buildEstimatedTripLeg(leg, coordinates, true)).toMatchObject({
      coordinates,
      anchors: [],
    });
  });

  it('renders a fresh observation without a usable estimate or boarding context', () => {
    const now = baseTime;
    const observedLeg = buildEstimatedTripLeg({
      provider: 'digitransit',
      tripId: 'tampere:live-only',
      coordinates: [],
    }, [[23.75, 61.49], [23.76, 61.5]], true)!;
    const observation = {
      provider: 'digitransit' as const,
      tripId: 'tampere:live-only',
      serviceDate: '2026-08-28',
      coordinates: [23.755, 61.495] as [number, number],
      recordedAt: now,
    };
    const layer = new TransitStopsLayer();
    const internals = layer as unknown as {
      poseForTrackedTrip: (tracked: unknown, time: number, allowEstimate: boolean) => {
        pose: TransitVehiclePose;
      } | undefined;
    };
    const positioned = internals.poseForTrackedTrip({
      selection: {
        tripId: observation.tripId,
        mode: 'BUS',
        color: '#123456',
        showRoute: false,
        provider: observation.provider,
        serviceDate: observation.serviceDate,
      },
      estimatedLegs: [],
      observedLeg,
      boardingContextUsable: false,
      observedTransition: beginObservedPositionTransition(undefined, observation, now),
      lastFetchAt: now,
    }, now, false);

    expect(positioned?.pose.status).toBe('live');
    expect(positioned?.pose.parts[Math.floor(positioned.pose.parts.length / 2)].coordinates)
      .toEqual(observation.coordinates);
  });

  it('uses the trip timeline for live auto-follow departure state', () => {
    const now = baseTime;
    const observedLeg = buildEstimatedTripLeg({
      provider: 'digitransit',
      tripId: 'tampere:live-before-departure',
      from: { lon: 23.75, lat: 61.49, departure: now + minute },
      to: { lon: 23.76, lat: 61.5, arrival: now + 6 * minute },
      coordinates: [],
    }, [[23.75, 61.49], [23.76, 61.5]], true)!;
    const observation = {
      provider: 'digitransit' as const,
      tripId: 'tampere:live-before-departure',
      serviceDate: '2026-08-28',
      coordinates: [23.755, 61.495] as [number, number],
      recordedAt: now,
    };
    const layer = new TransitStopsLayer();
    const poseForTrackedTrip = (layer as unknown as {
      poseForTrackedTrip: (tracked: unknown, time: number, allowEstimate: boolean) => {
        pose: TransitVehiclePose;
      } | undefined;
    }).poseForTrackedTrip.bind(layer);
    const tracked = {
      selection: {
        tripId: observation.tripId, mode: 'BUS', color: '#123456', showRoute: false,
        provider: observation.provider, serviceDate: observation.serviceDate,
      },
      estimatedLegs: [observedLeg], observedLeg, boardingContextUsable: true,
      observedTransition: beginObservedPositionTransition(undefined, observation, now),
      lastFetchAt: now,
    };

    expect(poseForTrackedTrip(tracked, now, true)?.pose.hasLeftStartingStop).toBe(false);
    expect(poseForTrackedTrip(tracked, now + minute, true)?.pose.hasLeftStartingStop).toBe(true);
  });

  it.each([
    ['TRAM', 3],
    ['RAIL', 5],
  ])('snaps a live %s consist to its route and keeps it articulated', (mode, partCount) => {
    const leg = buildEstimatedTripLeg({
      from: { lon: 24, lat: 60, departure: baseTime },
      to: { lon: 24.002, lat: 60.002, arrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.001, 60], [24.001, 60.001], [24.002, 60.001], [24.002, 60.002]])!;
    const gps = [24.00103, 60.00102] as [number, number];
    const pose = observedVehiclePose(leg, gps, mode, '#123456', true);
    const middle = Math.floor(pose.parts.length / 2);

    expect(pose.parts).toHaveLength(partCount);
    expect(pose.parts[middle].coordinates[0]).toBeCloseTo(24.00103, 10);
    expect(pose.parts[middle].coordinates[1]).toBeCloseTo(60.001, 10);
    expect(new Set(pose.parts.map((part) => part.coordinates.join(','))).size).toBe(partCount);
    expect(new Set(pose.parts.map((part) => part.heading)).size).toBeGreaterThan(1);
  });

  it('keeps live train sections separated near the end of a route', () => {
    const leg = buildEstimatedTripLeg({
      from: { lon: 24, lat: 60, departure: baseTime },
      to: { lon: 24.004, lat: 60, arrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.004, 60]])!;
    const pose = observedVehiclePose(leg, [24.004, 60], 'RAIL', '#123456', true);

    expect(new Set(pose.parts.map((part) => part.coordinates.join(','))).size).toBe(5);
    expect(pose.parts.every((part) => part.coordinates[1] === 60)).toBe(true);
    expect(pose.parts[2].coordinates[0]).toBeLessThan(24.004);
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

  it('clamps estimated positions before departure and after arrival', () => {
    const leg = buildEstimatedTripLeg({
      from: { stopId: 'a', lon: 24, lat: 60, departure: baseTime },
      to: { stopId: 'b', lon: 24.02, lat: 60, arrival: baseTime + 10 * minute },
      coordinates: [],
    }, [[24, 60], [24.01, 60], [24.02, 60]])!;

    expect(estimatedDistance(leg, baseTime - minute)).toBe(leg.anchors[0].distance);
    expect(estimatedDistance(leg, baseTime + 11 * minute)).toBe(leg.anchors[leg.anchors.length - 1].distance);
  });

});
