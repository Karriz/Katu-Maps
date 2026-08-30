import type { TransitProviderId, TransitTrip, TransitTripLeg, TransitTripPlace } from './types';

/** Provider timetable values are minute-resolution in some feeds. */
export const BOARDING_TIME_TOLERANCE_MS = 60_000;
export const TRIP_END_GRACE_MS = 60_000;

export type TripResolutionReason =
  | 'trip-id-mismatch'
  | 'service-date-mismatch'
  | 'boarding-stop-not-found'
  | 'boarding-occurrence-ambiguous'
  | 'scheduled-call-time-mismatch'
  | 'route-calls-unusable';

export type SelectedTripContext = {
  tripId: string;
  provider: TransitProviderId;
  serviceDate?: string;
  boardingStopId?: string;
  scheduledDeparture?: string;
};

export type ResolvedTrip = {
  leg: TransitTripLeg;
  stops: TransitTripPlace[];
  boardingStopIndex: number;
  /** Whether the selected departure could be tied to one exact stop call. */
  boardingContextUsable: boolean;
  /** Best available timeline. Route identity does not depend on its validity. */
  times: number[];
  vehicleTimelineUsable: boolean;
};

export type TripResolution =
  | { ok: true; trip: ResolvedTrip }
  | { ok: false; reason: TripResolutionReason };

export function tripPlaceTime(place: TransitTripPlace, departure = false, scheduledOnly = false) {
  const value = scheduledOnly
    ? (departure ? place.scheduledDeparture ?? place.scheduledArrival : place.scheduledArrival ?? place.scheduledDeparture)
    : departure
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

/** Resolve identity first; validate the optional vehicle timeline separately. */
export function resolveSelectedTripResult(payload: TransitTrip, context: SelectedTripContext): TripResolution {
  const matching = payload.legs.filter((leg) => leg.tripId === context.tripId
    && (!leg.provider || leg.provider === context.provider));
  if (matching.length !== 1) return { ok: false, reason: 'trip-id-mismatch' };
  const leg = matching[0];
  if (context.serviceDate && leg.serviceDate && leg.serviceDate !== context.serviceDate) {
    return { ok: false, reason: 'service-date-mismatch' };
  }
  const stops = places(leg);
  if (stops.length < 2) return { ok: false, reason: 'route-calls-unusable' };

  let boardingStopIndex = -1;
  if (context.boardingStopId) {
    const candidates = stops.flatMap((stop, index) => (
      stop.stopId === context.boardingStopId || stop.parentStopId === context.boardingStopId ? [index] : []
    ));
    if (candidates.length && context.scheduledDeparture) {
      const selectedTime = Date.parse(context.scheduledDeparture);
      const matchingCalls = candidates.filter((index) => {
        const callTime = tripPlaceTime(stops[index], true, true);
        return Number.isFinite(selectedTime) && callTime !== undefined
          && Math.abs(callTime - selectedTime) <= BOARDING_TIME_TOLERANCE_MS;
      });
      if (matchingCalls.length === 1) [boardingStopIndex] = matchingCalls;
    } else if (candidates.length === 1) {
      [boardingStopIndex] = candidates;
    }
  }

  const parsed = stops.map((stop, index) => tripPlaceTime(stop, index === 0));
  const times = parsed.filter((time): time is number => time !== undefined);
  const vehicleTimelineUsable = times.length === stops.length
    && times.every((time, index) => index === 0 || time >= times[index - 1]);
  return { ok: true, trip: {
    leg,
    stops,
    boardingStopIndex,
    boardingContextUsable: boardingStopIndex >= 0,
    times,
    vehicleTimelineUsable,
  } };
}

/** Compatibility convenience for callers that only need a resolved route. */
export function resolveSelectedTrip(payload: TransitTrip, context: SelectedTripContext) {
  const result = resolveSelectedTripResult(payload, context);
  return result.ok ? result.trip : undefined;
}

export function tripIsDisplayableAt(times: number[], now: number) {
  return times.length > 1 && now <= times[times.length - 1] + TRIP_END_GRACE_MS;
}
