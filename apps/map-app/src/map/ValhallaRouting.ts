import type { TransitRouteResult } from './transit';

export type RouteMode = 'pedestrian' | 'bicycle' | 'auto' | 'transit';

export type RouteResult = {
  geometry: GeoJSON.LineString;
  distanceKm: number;
  durationSeconds: number;
  transitLegs?: TransitRouteResult['transitLegs'];
  /** Router that produced this geometry, useful for transparency and diagnostics. */
  provider?: TransitRouteResult['provider'] | 'valhalla' | 'osrm';
};

type ValhallaShape = string | GeoJSON.LineString | { type: 'LineString'; coordinates: number[][] } | number[][];

type ValhallaResponse = {
  trip?: {
    summary?: { length?: number; time?: number };
    legs?: Array<{ shape?: ValhallaShape }>;
  };
  error?: string;
  error_code?: number;
};

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: GeoJSON.LineString;
  }>;
  message?: string;
};

const VALHALLA_ENDPOINT = 'https://valhalla1.openstreetmap.de/route';
// Public OSRM servers are not consistently CORS-enabled. Keep OSRM opt-in so
// the browser only calls a deployment-owned CORS proxy or OSRM instance.
const OSRM_ENDPOINT = import.meta.env.VITE_OSRM_ENDPOINT?.trim();
const OSRM_ENDPOINTS: Record<Exclude<RouteMode, 'transit'>, string> = {
  pedestrian: 'foot',
  bicycle: 'bike',
  auto: 'driving',
};

function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    latitude += (result & 1) ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    longitude += (result & 1) ? ~(result >> 1) : result >> 1;

    // Valhalla encodes latitude/longitude, while GeoJSON expects longitude/latitude.
    coordinates.push([longitude / 1e6, latitude / 1e6]);
  }

  return coordinates;
}

function shapeCoordinates(shape: ValhallaShape | undefined) {
  if (!shape) return undefined;
  if (typeof shape === 'string') return decodePolyline6(shape);
  if (Array.isArray(shape)) return shape;
  return shape.coordinates;
}

async function fetchOsrmRoute(
  origin: [number, number],
  destination: [number, number],
  mode: Exclude<RouteMode, 'transit'>,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const profile = OSRM_ENDPOINTS[mode];
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const coordinates = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
    const response = await fetch(
      `${OSRM_ENDPOINT}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=true`,
      { headers: { 'x-client-id': 'katu-maps' }, signal: controller.signal },
    );
    const payload = await response.json() as OsrmResponse;
    const route = payload.routes?.[0];
    if (!response.ok || payload.code !== 'Ok' || !route?.geometry || route.geometry.coordinates.length < 2) {
      throw new Error(payload.message || 'OSRM could not find a route');
    }
    return {
      geometry: route.geometry,
      distanceKm: (route.distance ?? 0) / 1000,
      durationSeconds: route.duration ?? 0,
      provider: 'osrm',
    };
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function fetchValhallaRoute(
  origin: [number, number],
  destination: [number, number],
  mode: Exclude<RouteMode, 'transit'>,
  signal?: AbortSignal,
): Promise<RouteResult> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20_000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      response = await fetch(VALHALLA_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-client-id': 'tampere-3d-map',
        },
        body: JSON.stringify({
      locations: [
        { lon: origin[0], lat: origin[1] },
        { lon: destination[0], lat: destination[1] },
      ],
      costing: mode,
      units: 'kilometers',
      shape_format: 'geojson',
      directions_options: { units: 'kilometers' },
        }),
        signal: controller.signal,
      });
      if (response.ok || response.status < 500) break;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      // The per-attempt controller is also used for our timeout. Preserve
      // that distinction so callers do not mistake a service timeout for a
      // user-requested cancellation and leave the UI stuck loading.
      if (timedOut || (error as Error).name === 'AbortError') {
        lastError = new Error('Routing service timed out. Please try again.');
      }
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  if (!response) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!OSRM_ENDPOINT) throw lastError instanceof Error
      ? lastError
      : new Error('Valhalla routing is unavailable');
    try {
      return await fetchOsrmRoute(origin, destination, mode, signal);
    } catch (fallbackError) {
      if (signal?.aborted) throw fallbackError;
      throw new Error(`Valhalla unavailable; OSRM fallback failed: ${(fallbackError as Error).message}`);
    }
  }

  const payload = await response.json() as ValhallaResponse;
  if (!response.ok || !payload.trip) {
    if (response.status >= 500) {
      if (!OSRM_ENDPOINT) throw new Error(payload.error || 'Valhalla routing is unavailable');
      try {
        return await fetchOsrmRoute(origin, destination, mode, signal);
      } catch (fallbackError) {
        if (signal?.aborted) throw fallbackError;
        throw new Error(`Valhalla unavailable; OSRM fallback failed: ${(fallbackError as Error).message}`);
      }
    }
    throw new Error(payload.error || 'Valhalla could not find a route');
  }

  const coordinates = payload.trip.legs?.flatMap((leg) => shapeCoordinates(leg.shape) ?? []) ?? [];
  if (coordinates.length < 2) throw new Error('Valhalla returned an empty route');

  return {
    geometry: { type: 'LineString', coordinates },
    distanceKm: payload.trip.summary?.length ?? 0,
    durationSeconds: payload.trip.summary?.time ?? 0,
    provider: 'valhalla',
  };
}
