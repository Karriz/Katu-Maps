import type {
  TransitProviderId,
  TransitVehicleObservation,
} from './types';

export const LIVE_OBSERVATION_MAX_AGE_MS = 60_000;
export const LIVE_OBSERVATION_FUTURE_TOLERANCE_MS = 15_000;
export const LIVE_POSITION_SMOOTHING_MS = 5_000;

export type VehiclePositionContext = {
  provider: TransitProviderId;
  tripId: string;
  serviceDate?: string;
};

export type VehicleRequestIdentity = {
  generation: number;
  key: string;
};

export function vehicleResponseIsCurrent(
  request: VehicleRequestIdentity,
  active: VehicleRequestIdentity,
) {
  return request.generation === active.generation && request.key === active.key;
}

export function matchLiveObservation(
  observations: TransitVehicleObservation[],
  context: VehiclePositionContext,
  now: number,
) {
  if (!context.serviceDate) return undefined;
  const matching = observations.filter((observation) => (
    observation.provider === context.provider
    && observation.tripId === context.tripId
    && observation.serviceDate === context.serviceDate
    && Number.isFinite(observation.recordedAt)
    && observation.recordedAt >= now - LIVE_OBSERVATION_MAX_AGE_MS
    && observation.recordedAt <= now + LIVE_OBSERVATION_FUTURE_TOLERANCE_MS
    && observation.coordinates.every(Number.isFinite)
  ));
  // More than one vehicle claiming the same dated trip is ambiguous. Do not
  // choose one based on route, recency, or array order.
  return matching.length === 1 ? matching[0] : undefined;
}

export type ObservedPositionTransition = {
  from: [number, number];
  to: [number, number];
  start: number;
  end: number;
  observation: TransitVehicleObservation;
};

export function beginObservedPositionTransition(
  from: [number, number] | undefined,
  observation: TransitVehicleObservation,
  now: number,
  durationMs = LIVE_POSITION_SMOOTHING_MS,
): ObservedPositionTransition {
  return {
    from: from ?? observation.coordinates,
    to: observation.coordinates,
    start: now,
    end: now + Math.max(0, durationMs),
    observation,
  };
}

/** Interpolate only to the latest observation; never project beyond it. */
export function observedPositionAt(transition: ObservedPositionTransition, now: number) {
  const progress = transition.end > transition.start
    ? Math.max(0, Math.min(1, (now - transition.start) / (transition.end - transition.start)))
    : 1;
  return [
    transition.from[0] + (transition.to[0] - transition.from[0]) * progress,
    transition.from[1] + (transition.to[1] - transition.from[1]) * progress,
  ] as [number, number];
}
