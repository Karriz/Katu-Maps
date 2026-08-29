import type {
  TransitBounds,
  TransitDeparture,
  TransitProvider,
  TransitRouteResult,
  TransitStop,
  TransitTrip,
  TransitTripPlace,
} from './types';
import { decodePolyline, finiteNumber, isoDurationSeconds } from './utils';

const ENDPOINT = 'https://api.digitransit.fi/routing/v2/finland/gtfs/v1';
const SUBSCRIPTION_KEY = import.meta.env.VITE_DIGITRANSIT_SUBSCRIPTION_KEY as string | undefined;

type GraphQlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

async function graphQl<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!SUBSCRIPTION_KEY) {
    throw new Error('Digitransit is not configured. Set VITE_DIGITRANSIT_SUBSCRIPTION_KEY.');
  }
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'digitransit-subscription-key': SUBSCRIPTION_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json() as GraphQlResponse<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join('; ')
      || `Digitransit returned HTTP ${response.status}`);
  }
  return payload.data;
}

const STOPS_QUERY = `
  query StopsByBounds($south: Float!, $west: Float!, $north: Float!, $east: Float!) {
    stopsByBbox(minLat: $south, minLon: $west, maxLat: $north, maxLon: $east) {
      gtfsId
      name
      lat
      lon
      vehicleMode
      locationType
      parentStation { gtfsId }
    }
  }
`;

type DigitransitStop = {
  gtfsId?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  vehicleMode?: unknown;
  locationType?: unknown;
  parentStation?: { gtfsId?: unknown } | null;
};

function stopFrom(raw: DigitransitStop): TransitStop | undefined {
  if (
    typeof raw.gtfsId !== 'string'
    || typeof raw.name !== 'string'
    || !finiteNumber(raw.lat)
    || !finiteNumber(raw.lon)
  ) return undefined;
  return {
    stopId: raw.gtfsId,
    name: raw.name,
    coordinates: [raw.lon, raw.lat],
    mode: typeof raw.vehicleMode === 'string' ? raw.vehicleMode : 'TRANSIT',
    parentId: typeof raw.parentStation?.gtfsId === 'string' ? raw.parentStation.gtfsId : undefined,
    importance: raw.locationType === 'STATION' ? 1 : raw.parentStation ? 0.5 : 0,
    provider: 'digitransit',
  };
}

function finlandDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function serviceDateFromEpoch(serviceDay: unknown) {
  return finiteNumber(serviceDay) ? finlandDate(new Date(serviceDay * 1000)) : undefined;
}

function stopTimeIso(serviceDay: unknown, seconds: unknown) {
  if (!finiteNumber(serviceDay) || !finiteNumber(seconds)) return undefined;
  return new Date((serviceDay + seconds) * 1000).toISOString();
}

const DEPARTURES_QUERY = `
  query Departures($id: String!) {
    stop(id: $id) { ...DepartureStop }
    station(id: $id) { ...DepartureStop }
  }
  fragment DepartureStop on Stop {
    stoptimesWithoutPatterns(numberOfDepartures: 10, omitCanceled: false, omitNonPickups: true) {
      serviceDay
      scheduledDeparture
      realtimeDeparture
      realtime
      realtimeState
      headsign
      trip {
        gtfsId
        route {
          gtfsId
          shortName
          longName
          mode
          color
          textColor
        }
      }
    }
  }
`;

type DepartureStopTime = {
  serviceDay?: unknown;
  scheduledDeparture?: unknown;
  realtimeDeparture?: unknown;
  realtime?: unknown;
  realtimeState?: unknown;
  headsign?: unknown;
  trip?: {
    gtfsId?: unknown;
    route?: {
      gtfsId?: unknown;
      shortName?: unknown;
      longName?: unknown;
      mode?: unknown;
      color?: unknown;
      textColor?: unknown;
    } | null;
  } | null;
};

const TRIP_QUERY = `
  query TripDetails($id: String!, $serviceDate: LocalDate!) {
    trip(id: $id) {
      gtfsId
      tripGeometry { points length }
      onServiceDate(date: $serviceDate) {
        stopCalls {
          stopLocation { ... on Stop { gtfsId name lat lon parentStation { gtfsId } } }
          schedule { time { ... on ArrivalDepartureTime { arrival departure } } }
          realTime {
            arrival { time delay }
            departure { time delay }
          }
        }
      }
    }
  }
`;

type TripCall = {
  stopLocation?: {
    gtfsId?: unknown;
    name?: unknown;
    lat?: unknown;
    lon?: unknown;
    parentStation?: { gtfsId?: unknown } | null;
  } | null;
  schedule?: { time?: { arrival?: unknown; departure?: unknown } | null } | null;
  realTime?: {
    arrival?: { time?: unknown; delay?: unknown } | null;
    departure?: { time?: unknown; delay?: unknown } | null;
  } | null;
};

function tripPlace(call: TripCall): TransitTripPlace | undefined {
  if (!call.stopLocation || typeof call.stopLocation.name !== 'string') return undefined;
  const scheduledArrival = typeof call.schedule?.time?.arrival === 'string' ? call.schedule.time.arrival : undefined;
  const scheduledDeparture = typeof call.schedule?.time?.departure === 'string' ? call.schedule.time.departure : undefined;
  const realtimeArrival = typeof call.realTime?.arrival?.time === 'string' ? call.realTime.arrival.time : undefined;
  const realtimeDeparture = typeof call.realTime?.departure?.time === 'string' ? call.realTime.departure.time : undefined;
  return {
    stopId: typeof call.stopLocation.gtfsId === 'string' ? call.stopLocation.gtfsId : undefined,
    parentStopId: typeof call.stopLocation.parentStation?.gtfsId === 'string'
      ? call.stopLocation.parentStation.gtfsId
      : undefined,
    name: call.stopLocation.name,
    lat: finiteNumber(call.stopLocation.lat) ? call.stopLocation.lat : undefined,
    lon: finiteNumber(call.stopLocation.lon) ? call.stopLocation.lon : undefined,
    scheduledArrival,
    scheduledDeparture,
    // Keep the two clocks independent. A delay at another call is not evidence
    // that this call has the same delay.
    arrival: realtimeArrival ?? scheduledArrival,
    departure: realtimeDeparture ?? scheduledDeparture,
  };
}

const PLAN_QUERY = `
  query Plan(
    $origin: PlanLabeledLocationInput!
    $destination: PlanLabeledLocationInput!
    $dateTime: PlanDateTimeInput
  ) {
    planConnection(
      origin: $origin
      destination: $destination
      dateTime: $dateTime
      first: 3
      modes: { direct: [WALK] }
    ) {
      edges {
        node {
          duration
          start
          end
          numberOfTransfers
          legs {
            mode
            transitLeg
            realTime
            realtimeState
            distance
            serviceDate
            start { scheduledTime estimated { time delay } }
            end { scheduledTime estimated { time delay } }
            from { name lat lon }
            to { name lat lon }
            headsign
            trip { gtfsId }
            route { shortName longName }
            legGeometry { points length }
          }
        }
      }
    }
  }
`;

type PlanLeg = {
  mode?: unknown;
  transitLeg?: unknown;
  realTime?: unknown;
  realtimeState?: unknown;
  distance?: unknown;
  serviceDate?: unknown;
  start?: { scheduledTime?: unknown; estimated?: { time?: unknown; delay?: unknown } | null } | null;
  end?: { scheduledTime?: unknown; estimated?: { time?: unknown; delay?: unknown } | null } | null;
  from?: { name?: unknown; lat?: unknown; lon?: unknown } | null;
  to?: { name?: unknown; lat?: unknown; lon?: unknown } | null;
  headsign?: unknown;
  trip?: { gtfsId?: unknown } | null;
  route?: { shortName?: unknown; longName?: unknown } | null;
  legGeometry?: { points?: unknown } | null;
};

type PlanItinerary = {
  duration?: unknown;
  start?: unknown;
  end?: unknown;
  numberOfTransfers?: unknown;
  legs?: PlanLeg[];
};

function planLocation(coordinates: [number, number], stopId?: string) {
  return stopId
    ? { location: { stopLocation: { stopLocationId: stopId } } }
    : { location: { coordinate: { latitude: coordinates[1], longitude: coordinates[0] } } };
}

function legTime(value: PlanLeg['start']) {
  const estimated = value?.estimated?.time;
  if (typeof estimated === 'string') return estimated;
  return typeof value?.scheduledTime === 'string' ? value.scheduledTime : undefined;
}

function planLegCoordinates(leg: PlanLeg): [number, number][] {
  if (typeof leg.legGeometry?.points === 'string') return decodePolyline(leg.legGeometry.points, 5);
  return [leg.from, leg.to].flatMap((place) => (
    finiteNumber(place?.lon) && finiteNumber(place?.lat)
      ? [[place.lon, place.lat] as [number, number]]
      : []
  ));
}

export const digitransitProvider: TransitProvider = {
  id: 'digitransit',
  label: 'Digitransit',

  async fetchStops(bounds, signal) {
    const data = await graphQl<{ stopsByBbox?: DigitransitStop[] }>(STOPS_QUERY, bounds, signal);
    return (data.stopsByBbox ?? []).flatMap((raw) => {
      const stop = stopFrom(raw);
      return stop ? [stop] : [];
    });
  },

  async searchStops(query, bounds, signal) {
    const stops = await this.fetchStops(bounds, signal);
    const normalizedQuery = query.toLocaleLowerCase();
    return stops
      .filter((stop) => stop.name.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, 6);
  },

  async fetchDepartures(stop, signal) {
    const data = await graphQl<{
      stop?: { stoptimesWithoutPatterns?: DepartureStopTime[] } | null;
      station?: { stoptimesWithoutPatterns?: DepartureStopTime[] } | null;
    }>(DEPARTURES_QUERY, { id: stop.stopId }, signal);
    const stopTimes = data.stop?.stoptimesWithoutPatterns ?? data.station?.stoptimesWithoutPatterns ?? [];
    return stopTimes.flatMap((stopTime): TransitDeparture[] => {
      const departureSeconds = stopTime.realtime === true
        ? stopTime.realtimeDeparture
        : stopTime.scheduledDeparture;
      const departure = stopTimeIso(stopTime.serviceDay, departureSeconds)
        ?? stopTimeIso(stopTime.serviceDay, stopTime.scheduledDeparture);
      if (!departure) return [];
      const route = stopTime.trip?.route;
      return [{
        departure,
        scheduledDeparture: stopTimeIso(stopTime.serviceDay, stopTime.scheduledDeparture),
        mode: typeof route?.mode === 'string' ? route.mode : stop.mode,
        routeId: typeof route?.gtfsId === 'string' ? route.gtfsId : undefined,
        tripId: typeof stopTime.trip?.gtfsId === 'string' ? stopTime.trip.gtfsId : undefined,
        routeShortName: typeof route?.shortName === 'string' ? route.shortName : undefined,
        routeLongName: typeof route?.longName === 'string' ? route.longName : undefined,
        headsign: typeof stopTime.headsign === 'string' ? stopTime.headsign : undefined,
        routeColor: typeof route?.color === 'string' ? route.color : undefined,
        routeTextColor: typeof route?.textColor === 'string' ? route.textColor : undefined,
        cancelled: stopTime.realtimeState === 'CANCELED',
        realTime: stopTime.realtime === true,
        serviceDate: serviceDateFromEpoch(stopTime.serviceDay),
        provider: 'digitransit',
      }];
    });
  },

  async fetchTrip(tripId, serviceDate, signal) {
    const resolvedServiceDate = serviceDate ?? finlandDate(new Date());
    const data = await graphQl<{
      trip?: {
        tripGeometry?: { points?: unknown } | null;
        onServiceDate?: { stopCalls?: TripCall[] } | null;
      } | null;
    }>(TRIP_QUERY, { id: tripId, serviceDate: resolvedServiceDate }, signal);
    const trip = data.trip;
    const calls = trip?.onServiceDate?.stopCalls ?? [];
    const places = calls.flatMap((call) => {
      const place = tripPlace(call);
      return place ? [place] : [];
    });
    const geometry = typeof trip?.tripGeometry?.points === 'string'
      ? decodePolyline(trip.tripGeometry.points, 5)
      : places.flatMap((place) => (
        finiteNumber(place.lon) && finiteNumber(place.lat)
          ? [[place.lon, place.lat] as [number, number]]
          : []
      ));
    if (places.length < 2 || geometry.length < 2) return { legs: [] };
    const first = places[0];
    const last = places[places.length - 1];
    return {
      legs: [{
        provider: 'digitransit',
        tripId,
        serviceDate: resolvedServiceDate,
        startTime: typeof first.departure === 'string' ? first.departure : undefined,
        endTime: typeof last.arrival === 'string' ? last.arrival : undefined,
        realTime: (trip?.onServiceDate?.stopCalls ?? []).some((call) => Boolean(
          call.realTime?.arrival?.time || call.realTime?.departure?.time,
        )),
        from: first,
        to: last,
        intermediateStops: places.slice(1, -1),
        coordinates: geometry,
      }],
    } satisfies TransitTrip;
  },

  async fetchRoutes(origin, destination, options = {}) {
    const originStopId = options.originStopProvider === 'digitransit' ? options.originStopId : undefined;
    const destinationStopId = options.destinationStopProvider === 'digitransit'
      ? options.destinationStopId
      : undefined;
    const requestedTime = options.time ?? new Date().toISOString();
    const data = await graphQl<{
      planConnection?: { edges?: Array<{ node?: PlanItinerary | null }> } | null;
    }>(PLAN_QUERY, {
      origin: planLocation(origin, originStopId),
      destination: planLocation(destination, destinationStopId),
      dateTime: options.arriveBy
        ? { latestArrival: requestedTime }
        : { earliestDeparture: requestedTime },
    }, options.signal);
    const itineraries = (data.planConnection?.edges ?? []).flatMap((edge) => edge.node ? [edge.node] : []);
    if (!itineraries.length) throw new Error('Digitransit could not find a transit route');
    return itineraries.flatMap((itinerary): TransitRouteResult[] => {
      const legs = itinerary.legs ?? [];
      const coordinates = legs.flatMap(planLegCoordinates);
      if (coordinates.length < 2) return [];
      const transitLegCount = legs.filter((leg) => leg.transitLeg === true).length;
      return [{
        geometry: { type: 'LineString', coordinates },
        distanceKm: legs.reduce((sum, leg) => sum + (finiteNumber(leg.distance) ? leg.distance : 0), 0) / 1000,
        durationSeconds: finiteNumber(itinerary.duration) ? itinerary.duration : 0,
        departureTime: typeof itinerary.start === 'string' ? itinerary.start : undefined,
        arrivalTime: typeof itinerary.end === 'string' ? itinerary.end : undefined,
        transfers: finiteNumber(itinerary.numberOfTransfers)
          ? itinerary.numberOfTransfers
          : Math.max(0, transitLegCount - 1),
        provider: 'digitransit',
        transitLegs: legs.map((leg) => ({
          mode: typeof leg.mode === 'string' ? leg.mode : 'TRANSIT',
          geometry: { type: 'LineString', coordinates: planLegCoordinates(leg) },
          tripId: typeof leg.trip?.gtfsId === 'string' ? leg.trip.gtfsId : undefined,
          realTime: leg.realTime === true,
          cancelled: leg.realtimeState === 'CANCELED',
          delaySeconds: isoDurationSeconds(leg.start?.estimated?.delay),
          route: typeof leg.route?.shortName === 'string'
            ? leg.route.shortName
            : typeof leg.route?.longName === 'string' ? leg.route.longName : undefined,
          headsign: typeof leg.headsign === 'string' ? leg.headsign : undefined,
          from: typeof leg.from?.name === 'string' ? leg.from.name : undefined,
          to: typeof leg.to?.name === 'string' ? leg.to.name : undefined,
          startTime: legTime(leg.start),
          endTime: legTime(leg.end),
          serviceDate: typeof leg.serviceDate === 'string' ? leg.serviceDate : undefined,
          provider: 'digitransit',
        })),
      }];
    });
  },
};
