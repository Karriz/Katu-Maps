export type TransitRouteResult = {
  geometry: GeoJSON.LineString;
  distanceKm: number;
  durationSeconds: number;
  departureTime?: string;
  arrivalTime?: string;
  transfers: number;
  transitLegs: Array<{
    mode: string;
    tripId?: string;
    realTime?: boolean;
    cancelled?: boolean;
    delaySeconds?: number;
    route?: string;
    headsign?: string;
    from?: string;
    to?: string;
    startTime?: string;
    endTime?: string;
  }>;
};

const TRANSIT_PLAN_ENDPOINT = 'https://api.transitous.org/api/v6/plan';
const TRANSITOUS_HEADERS = {
  Accept: 'application/json',
  'X-Client-Id': 'tampere-3d-map',
};

type TransitPlace = { lat?: number; lon?: number; name?: string };
type TransitLeg = {
  from?: TransitPlace;
  to?: TransitPlace;
  mode?: string;
  tripId?: string;
  realTime?: boolean;
  cancelled?: boolean;
  delaySeconds?: number;
  routeShortName?: string;
  displayName?: string;
  headsign?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  legGeometry?: { points?: string; precision?: number };
};

function decodePolyline(encoded: string, precision: number): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const factor = 10 ** precision;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude += (result & 1) ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude += (result & 1) ? ~(result >> 1) : result >> 1;
    coordinates.push([longitude / factor, latitude / factor]);
  }
  return coordinates;
}

function placeCoordinate(place: TransitPlace | undefined): [number, number] | undefined {
  return place && Number.isFinite(place.lon) && Number.isFinite(place.lat)
    ? [place.lon as number, place.lat as number]
    : undefined;
}

function legCoordinates(leg: TransitLeg) {
  const geometry = leg.legGeometry;
  if (geometry?.points && typeof geometry.precision === 'number') {
    return decodePolyline(geometry.points, geometry.precision);
  }
  return [placeCoordinate(leg.from), placeCoordinate(leg.to)].filter(
    (point): point is [number, number] => Boolean(point),
  );
}

export async function fetchTransitRoutes(
  origin: [number, number],
  destination: [number, number],
  options: { originStopId?: string; destinationStopId?: string; time?: string; arriveBy?: boolean; signal?: AbortSignal } = {},
): Promise<TransitRouteResult[]> {
  const params = new URLSearchParams({
    fromPlace: options.originStopId || `${origin[1]},${origin[0]}`,
    toPlace: options.destinationStopId || `${destination[1]},${destination[0]}`,
    time: options.time || new Date().toISOString(),
    arriveBy: String(options.arriveBy ?? false),
    timetableView: 'true',
    numItineraries: '3',
    maxItineraries: '3',
    detailedLegs: 'true',
    detailedTransfers: 'true',
    joinInterlinedLegs: 'false',
    directModes: 'WALK',
    preTransitModes: 'WALK',
    postTransitModes: 'WALK',
  });
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      response = await fetch(`${TRANSIT_PLAN_ENDPOINT}?${params}`, {
        signal: controller.signal,
        headers: TRANSITOUS_HEADERS,
      });
      if (response.ok || response.status < 500) break;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
    } finally {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error('Transitous request timed out');
  const payload = await response.json() as {
    itineraries?: Array<{ startTime?: string; endTime?: string; legs?: TransitLeg[] }>;
    connections?: Array<{ startTime?: string; endTime?: string; legs?: TransitLeg[] }>;
    error?: string;
  };
  const itineraries = payload.itineraries ?? payload.connections ?? [];
  if (!response.ok || itineraries.length === 0) throw new Error(payload.error || 'Transitous could not find a transit route');
  return itineraries.flatMap((itinerary) => {
    const coordinates = itinerary.legs?.flatMap(legCoordinates) ?? [];
    if (coordinates.length < 2) return [];
    const durationSeconds = itinerary.startTime && itinerary.endTime
      ? Math.max(0, (new Date(itinerary.endTime).getTime() - new Date(itinerary.startTime).getTime()) / 1000)
      : itinerary.legs?.reduce((sum, leg) => sum + (leg.duration ?? 0), 0) ?? 0;
    const transitLegs = itinerary.legs?.filter((leg) => leg.mode && !['WALK', 'FOOT'].includes(leg.mode)) ?? [];
    return [{
      geometry: { type: 'LineString', coordinates },
      distanceKm: 0,
      durationSeconds,
      departureTime: itinerary.startTime,
      arrivalTime: itinerary.endTime,
      transfers: Math.max(0, transitLegs.length - 1),
      transitLegs: (itinerary.legs ?? []).map((leg) => ({
        mode: leg.mode ?? 'TRANSIT',
        tripId: leg.tripId,
        realTime: leg.realTime,
        cancelled: leg.cancelled,
        delaySeconds: leg.delaySeconds,
        route: leg.routeShortName || leg.displayName,
        headsign: leg.headsign,
        from: leg.from?.name,
        to: leg.to?.name,
        startTime: leg.startTime,
        endTime: leg.endTime,
      })),
    }];
  });
}
