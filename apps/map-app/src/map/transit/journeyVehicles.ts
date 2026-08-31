import type { TransitRouteResult } from './types';

type TransitRouteLeg = TransitRouteResult['transitLegs'][number];

function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isWalking(mode: string) {
  return ['WALK', 'FOOT', 'PEDESTRIAN'].includes(mode.trim().toUpperCase());
}

export type JourneyVehicleLegs = {
  current?: TransitRouteLeg;
  next?: TransitRouteLeg;
};

/** Resolve vehicle legs from the full journey timeline, including walk/wait gaps. */
export function resolveJourneyVehicleLegs(
  legs: TransitRouteResult['transitLegs'],
  now: number,
): JourneyVehicleLegs {
  const vehicleLegs = legs.filter((leg) => leg.tripId && !leg.cancelled && !isWalking(leg.mode));
  const currentIndex = vehicleLegs.findIndex((leg) => {
    const start = timestamp(leg.startTime);
    const end = timestamp(leg.endTime);
    return start !== undefined && end !== undefined && now >= start && now < end;
  });
  if (currentIndex >= 0) {
    return { current: vehicleLegs[currentIndex], next: vehicleLegs[currentIndex + 1] };
  }
  const firstFutureIndex = vehicleLegs.findIndex((leg) => {
    const start = timestamp(leg.startTime);
    return start !== undefined && now < start;
  });
  const transitHasStarted = vehicleLegs.some((leg) => {
    const start = timestamp(leg.startTime);
    return start !== undefined && now >= start;
  });
  // At the beginning of a planned journey, promote the first vehicle to the
  // primary slot even while the passenger is walking to it or waiting. The
  // following transit vehicle is the subdued preview.
  if (!transitHasStarted && firstFutureIndex >= 0) {
    return {
      current: vehicleLegs[firstFutureIndex],
      next: vehicleLegs[firstFutureIndex + 1],
    };
  }
  return {
    next: firstFutureIndex >= 0 ? vehicleLegs[firstFutureIndex] : undefined,
  };
}

export function journeyVehicleKey(leg: TransitRouteLeg | undefined) {
  return leg?.tripId
    ? `${leg.provider}:${leg.tripId}:${leg.serviceDate ?? ''}:${leg.from?.stopId ?? ''}:${leg.scheduledStartTime ?? leg.startTime ?? ''}`
    : undefined;
}
