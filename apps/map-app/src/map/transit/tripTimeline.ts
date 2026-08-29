import type { TransitProviderId, TransitTrip, TransitTripLeg, TransitTripPlace } from './types';

/** Selected departures and trip details may differ slightly as realtime feeds update. */
export const BOARDING_TIME_TOLERANCE_MS = 2 * 60_000;
export const TRIP_END_GRACE_MS = 60_000;

export type SelectedTripContext = {
  tripId: string;
  provider: TransitProviderId;
  serviceDate?: string;
  boardingStopId?: string;
  selectedDeparture?: string;
};

export type ResolvedTrip = {
  leg: TransitTripLeg;
  stops: TransitTripPlace[];
  boardingStopIndex: number;
  times: number[];
};

export function tripPlaceTime(place: TransitTripPlace, departure = false) {
  const value = departure
    ? place.departure ?? place.arrival ?? place.scheduledDeparture ?? place.scheduledArrival
    : place.arrival ?? place.departure ?? place.scheduledArrival ?? place.scheduledDeparture;
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function places(leg: TransitTripLeg) {
  return [leg.from, ...(leg.intermediateStops ?? []), leg.to]
    .filter((place): place is TransitTripPlace => Boolean(place));
}

/**
 * Produces the single timeline used by both the stop panel and map marker.
 * Invalid/ambiguous instances are rejected rather than partially rendered.
 */
export function resolveSelectedTrip(payload: TransitTrip, context: SelectedTripContext): ResolvedTrip | undefined {
  if (context.provider === 'transitous' && !context.serviceDate) return undefined;
  const matching = payload.legs.filter((leg) => leg.tripId === context.tripId);
  if (matching.length !== 1) return undefined;
  const leg = matching[0];
  if (context.serviceDate && leg.serviceDate !== context.serviceDate) return undefined;
  const stops = places(leg);
  if (stops.length < 2) return undefined;

  const times = stops.map((stop, index) => tripPlaceTime(stop, index === 0));
  if (times.some((time) => time === undefined)) return undefined;
  const resolvedTimes = times as number[];
  const callSequence = stops.flatMap((stop) => [tripPlaceTime(stop), tripPlaceTime(stop, true)]);
  if (callSequence.some((time) => time === undefined)) return undefined;
  if ((callSequence as number[]).some((time, index, sequence) => index > 0 && time < sequence[index - 1])) {
    return undefined;
  }

  let boardingStopIndex = -1;
  if (context.boardingStopId && context.selectedDeparture) {
    const selectedTime = Date.parse(context.selectedDeparture);
    if (!Number.isFinite(selectedTime)) return undefined;
    const candidates = stops.flatMap((stop, index) => (
      stop.stopId === context.boardingStopId || stop.parentStopId === context.boardingStopId ? [index] : []
    ));
    boardingStopIndex = candidates.reduce((best, index) => {
      const candidateTime = tripPlaceTime(stops[index], true);
      if (candidateTime === undefined) return best;
      if (best < 0) return index;
      return Math.abs(candidateTime - selectedTime) < Math.abs(tripPlaceTime(stops[best], true)! - selectedTime)
        ? index : best;
    }, -1);
    if (boardingStopIndex < 0) return undefined;
    const boardingTime = tripPlaceTime(stops[boardingStopIndex], true);
    if (boardingTime === undefined || Math.abs(boardingTime - selectedTime) > BOARDING_TIME_TOLERANCE_MS) return undefined;
  }
  return { leg, stops, boardingStopIndex, times: resolvedTimes };
}

export function tripIsDisplayableAt(times: number[], now: number) {
  return times.length > 1 && now <= times[times.length - 1] + TRIP_END_GRACE_MS;
}
