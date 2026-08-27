import type {
  TransitBounds,
  TransitDeparture,
  TransitProvider,
  TransitRouteOptions,
  TransitRouteResult,
  TransitStop,
  TransitStopSelection,
  TransitTrip,
  TransitTripPlace,
} from './types';
import { decodePolyline, finiteNumber, text } from './utils';

const API_ROOT = 'https://api.transitous.org/api/v6';
const HEADERS = { Accept: 'application/json', 'X-Client-Id': 'tampere-3d-map' };

type RawStop = {
  name?: unknown;
  stopId?: unknown;
  parentId?: unknown;
  lat?: unknown;
  lon?: unknown;
  importance?: unknown;
  modes?: unknown;
};

type RawPlace = TransitTripPlace & { lat?: number; lon?: number };
type RawLeg = {
  tripId?: unknown;
  mode?: unknown;
  realTime?: unknown;
  cancelled?: unknown;
  delaySeconds?: unknown;
  routeShortName?: unknown;
  displayName?: unknown;
  headsign?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  duration?: unknown;
  from?: RawPlace;
  to?: RawPlace;
  intermediateStops?: unknown;
  legGeometry?: { points?: unknown; precision?: unknown };
};

function modeFrom(value: unknown) {
  if (!Array.isArray(value)) return 'TRANSIT';
  return value.find((mode): mode is string => typeof mode === 'string') ?? 'TRANSIT';
}

function stopFrom(raw: RawStop, index: number): TransitStop | undefined {
  if (!finiteNumber(raw.lat) || !finiteNumber(raw.lon) || typeof raw.name !== 'string') return undefined;
  const stopId = typeof raw.stopId === 'string' ? raw.stopId : `${raw.lon}:${raw.lat}:${index}`;
  return {
    stopId,
    name: raw.name,
    coordinates: [raw.lon, raw.lat],
    mode: modeFrom(raw.modes),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : undefined,
    importance: finiteNumber(raw.importance) ? raw.importance : 0,
    provider: 'transitous',
  };
}

function absoluteTime(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
}

function tripLeg(raw: RawLeg) {
  const points = raw.legGeometry?.points;
  const precision = raw.legGeometry?.precision;
  const coordinates = typeof points === 'string' && typeof precision === 'number'
    ? decodePolyline(points, precision)
    : [raw.from, raw.to]
      .filter((place): place is RawPlace => finiteNumber(place?.lon) && finiteNumber(place?.lat))
      .map((place) => [place.lon as number, place.lat as number] as [number, number]);
  return {
    tripId: text(raw.tripId) || undefined,
    startTime: absoluteTime(raw.startTime),
    endTime: absoluteTime(raw.endTime),
    realTime: raw.realTime === true,
    from: raw.from,
    to: raw.to,
    intermediateStops: Array.isArray(raw.intermediateStops)
      ? raw.intermediateStops as TransitTripPlace[]
      : [],
    coordinates,
  };
}

async function jsonRequest<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: HEADERS });
  if (!response.ok) throw new Error(`Transitous returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const transitousProvider: TransitProvider = {
  id: 'transitous',
  label: 'Transitous',

  async fetchStops(bounds, signal) {
    const params = new URLSearchParams({
      min: `${bounds.south},${bounds.west}`,
      max: `${bounds.north},${bounds.east}`,
      grouped: 'false',
      modes: 'TRANSIT',
      language: typeof navigator !== 'undefined' ? navigator.language : 'en',
    });
    const payload = await jsonRequest<unknown>(`${API_ROOT}/map/stops?${params}`, signal);
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((item, index) => {
      const stop = stopFrom(item as RawStop, index);
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
    const params = new URLSearchParams({
      stopId: stop.stopId,
      n: '10',
      mode: 'TRANSIT',
      realtimeMode: 'REALTIME',
      withAlerts: 'false',
      language: typeof navigator !== 'undefined' ? navigator.language : 'en',
    });
    if (!['RAIL', 'SUBURBAN', 'SUBWAY', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL'].includes(stop.mode)) {
      params.set('radius', '0');
      params.set('exactRadius', 'true');
    }
    const payload = await jsonRequest<{ stopTimes?: Array<Record<string, unknown> & { place?: Record<string, unknown> }> }>(
      `${API_ROOT}/stoptimes?${params}`,
      signal,
    );
    return (payload.stopTimes ?? []).flatMap((item) => {
      const departure = absoluteTime(item.place?.departure ?? item.place?.scheduledDeparture);
      if (!departure) return [];
      return [{
        departure,
        mode: text(item.mode) || undefined,
        routeId: text(item.routeId) || undefined,
        tripId: text(item.tripId) || undefined,
        routeShortName: text(item.routeShortName) || undefined,
        displayName: text(item.displayName) || undefined,
        routeLongName: text(item.routeLongName) || undefined,
        headsign: text(item.headsign) || undefined,
        routeColor: text(item.routeColor) || undefined,
        routeTextColor: text(item.routeTextColor) || undefined,
        cancelled: item.cancelled === true,
        realTime: item.realTime === true,
        provider: 'transitous' as const,
      }];
    });
  },

  async fetchTrip(tripId, _serviceDate, signal) {
    const params = new URLSearchParams({
      tripId,
      detailedLegs: 'true',
      joinInterlinedLegs: 'false',
      language: typeof navigator !== 'undefined' ? navigator.language : 'en',
    });
    const payload = await jsonRequest<{ legs?: RawLeg[] }>(`${API_ROOT}/trip?${params}`, signal);
    return { legs: (payload.legs ?? []).map(tripLeg) } satisfies TransitTrip;
  },

  async fetchRoutes(origin, destination, options = {}) {
    const originStopId = options.originStopProvider === 'transitous' ? options.originStopId : undefined;
    const destinationStopId = options.destinationStopProvider === 'transitous' ? options.destinationStopId : undefined;
    const params = new URLSearchParams({
      fromPlace: originStopId || `${origin[1]},${origin[0]}`,
      toPlace: destinationStopId || `${destination[1]},${destination[0]}`,
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
        response = await fetch(`${API_ROOT}/plan?${params}`, {
          signal: controller.signal,
          headers: HEADERS,
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
      itineraries?: Array<{ startTime?: string; endTime?: string; legs?: RawLeg[] }>;
      connections?: Array<{ startTime?: string; endTime?: string; legs?: RawLeg[] }>;
      error?: string;
    };
    const itineraries = payload.itineraries ?? payload.connections ?? [];
    if (!response.ok || itineraries.length === 0) {
      throw new Error(payload.error || 'Transitous could not find a transit route');
    }
    return itineraries.flatMap((itinerary): TransitRouteResult[] => {
      const legs = itinerary.legs ?? [];
      const legRoutes = legs.map((leg) => tripLeg(leg));
      const coordinates = legRoutes.flatMap((leg) => leg.coordinates);
      if (coordinates.length < 2) return [];
      const startTime = absoluteTime(itinerary.startTime);
      const endTime = absoluteTime(itinerary.endTime);
      const durationSeconds = startTime && endTime
        ? Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)
        : legs.reduce((sum, leg) => sum + (finiteNumber(leg.duration) ? leg.duration : 0), 0);
      const transitLegs = legs.filter((leg) => text(leg.mode) && !['WALK', 'FOOT'].includes(text(leg.mode)));
      return [{
        geometry: { type: 'LineString', coordinates },
        distanceKm: 0,
        durationSeconds,
        departureTime: startTime,
        arrivalTime: endTime,
        transfers: Math.max(0, transitLegs.length - 1),
        provider: 'transitous',
        transitLegs: legs.map((leg) => ({
          mode: text(leg.mode, 'TRANSIT'),
          geometry: { type: 'LineString', coordinates: legRoutes[legs.indexOf(leg)].coordinates },
          tripId: text(leg.tripId) || undefined,
          realTime: leg.realTime === true,
          cancelled: leg.cancelled === true,
          delaySeconds: finiteNumber(leg.delaySeconds) ? leg.delaySeconds : undefined,
          route: text(leg.routeShortName, text(leg.displayName)) || undefined,
          headsign: text(leg.headsign) || undefined,
          from: leg.from?.name,
          to: leg.to?.name,
          startTime: absoluteTime(leg.startTime),
          endTime: absoluteTime(leg.endTime),
          provider: 'transitous',
        })),
      }];
    });
  },
};
