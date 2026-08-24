import type { LngLatLike, RasterDEMSourceSpecification } from 'maplibre-gl';

export const GLOBAL_TERRAIN_MAX_ZOOM = 12;
export const DETAIL_TERRAIN_MAX_ZOOM = 18;
export const DETAIL_TERRAIN_MIN_ZOOM = GLOBAL_TERRAIN_MAX_ZOOM + 1;

const MAPTERHORN_TILE_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
const availabilityCache = new Map<string, Promise<boolean>>();

type Coordinate = { lng: number; lat: number };

function coordinate(value: LngLatLike): Coordinate {
  if (Array.isArray(value)) return { lng: value[0], lat: value[1] };
  if ('lng' in value) return { lng: value.lng, lat: value.lat };
  return { lng: value.lon, lat: value.lat };
}

function tileCoordinate(value: LngLatLike, zoom: number) {
  const { lng, lat } = coordinate(value);
  const worldSize = 2 ** zoom;
  const boundedLatitude = Math.max(-85.0511287, Math.min(85.0511287, lat));
  const latitudeRadians = boundedLatitude * Math.PI / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * worldSize),
    y: Math.floor(
      ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * worldSize,
    ),
  };
}

function tileUrl(value: LngLatLike, zoom: number) {
  const { x, y } = tileCoordinate(value, zoom);
  return MAPTERHORN_TILE_URL
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

function tileAvailable(url: string, signal?: AbortSignal) {
  if (!signal) {
    const cached = availabilityCache.get(url);
    if (cached) return cached;
  }

  const request = fetch(url, { method: 'HEAD', mode: 'cors', signal })
    .then((response) => response.ok)
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return false;
    });

  if (!signal) availabilityCache.set(url, request);
  return request;
}

/**
 * Finds the highest detailed Mapterhorn zoom that covers the visible sample
 * points. z0-z12 is globally guaranteed; z13+ varies by regional source.
 */
export async function detailedTerrainZoom(
  samplePoints: LngLatLike[],
  preferredZoom: number,
  signal?: AbortSignal,
) {
  const highestZoom = Math.max(
    DETAIL_TERRAIN_MIN_ZOOM,
    Math.min(DETAIL_TERRAIN_MAX_ZOOM, Math.floor(preferredZoom)),
  );

  for (let zoom = highestZoom; zoom >= DETAIL_TERRAIN_MIN_ZOOM; zoom -= 1) {
    const urls = [...new Set(samplePoints.map((point) => tileUrl(point, zoom)))];
    const availability = await Promise.all(
      urls.map((url) => tileAvailable(url, signal)),
    );
    if (availability.every(Boolean)) return zoom;
  }

  return GLOBAL_TERRAIN_MAX_ZOOM;
}

export function detailedTerrainSource(maxzoom: number): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    tiles: [MAPTERHORN_TILE_URL],
    tileSize: 512,
    encoding: 'terrarium',
    maxzoom,
    attribution: '<a href="https://mapterhorn.com/attribution/">© Mapterhorn terrain data</a>',
  };
}
