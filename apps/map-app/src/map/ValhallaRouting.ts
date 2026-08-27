export type RouteMode = 'pedestrian' | 'bicycle' | 'auto' | 'transit';

export type RouteResult = {
  geometry: GeoJSON.LineString;
  distanceKm: number;
  durationSeconds: number;
  transitLegs?: Array<{
    mode: string;
    geometry?: GeoJSON.LineString;
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
    provider?: 'digitransit' | 'transitous';
    serviceDate?: string;
  }>;
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

const VALHALLA_ENDPOINT = 'https://valhalla1.openstreetmap.de/route';

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

export async function fetchValhallaRoute(
  origin: [number, number],
  destination: [number, number],
  mode: RouteMode,
  signal?: AbortSignal,
): Promise<RouteResult> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
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
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error('Routing request timed out');

  const payload = await response.json() as ValhallaResponse;
  if (!response.ok || !payload.trip) {
    throw new Error(payload.error || 'Valhalla could not find a route');
  }

  const coordinates = payload.trip.legs?.flatMap((leg) => shapeCoordinates(leg.shape) ?? []) ?? [];
  if (coordinates.length < 2) throw new Error('Valhalla returned an empty route');

  return {
    geometry: { type: 'LineString', coordinates },
    distanceKm: payload.trip.summary?.length ?? 0,
    durationSeconds: payload.trip.summary?.time ?? 0,
  };
}
