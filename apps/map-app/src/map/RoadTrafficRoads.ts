import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { isRecord, text } from './Digitraffic';
import { RequestRateGate } from './RequestRateGate';
import { serviceConfig } from './ServiceConfig';
import type { TrafficLngLat } from './RoadTrafficGeometry';
import type { RoadTrafficWay } from './RoadTrafficSnap';

export type TrafficBBox = [number, number, number, number];

const HIGHWAYS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const OVERPASS_GATE = new RequestRateGate(1_000);
const CACHE_TTL_MS = 10 * 60_000;
const MAX_SPAN = 1.6;
export const TRAFFIC_ROAD_SNAP_MIN_ZOOM = 10.2;
const FALLBACK_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const cache = new Map<string, { ways: RoadTrafficWay[]; fetchedAt: number }>();

function bboxKey(bbox: TrafficBBox) {
  return bbox.map((value) => value.toFixed(3)).join(',');
}

export function clampTrafficBbox(bbox: TrafficBBox, maxSpan = MAX_SPAN): TrafficBBox | undefined {
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite)) return undefined;
  if (east <= west || north <= south) return undefined;
  if (east - west > maxSpan || north - south > maxSpan) return undefined;
  return bbox;
}

export function trafficRoadsRequestKey(bbox: TrafficBBox, zoom: number) {
  const quantized = bbox.map((value) => value.toFixed(3)).join(',');
  if (zoom < TRAFFIC_ROAD_SNAP_MIN_ZOOM) return `chord:${quantized}`;
  return `${Math.max(10, Math.floor(zoom))}:${quantized}`;
}

export function parseOverpassRoads(payload: unknown): RoadTrafficWay[] {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) return [];
  const ways: RoadTrafficWay[] = [];
  for (const element of payload.elements) {
    if (!isRecord(element) || element.type !== 'way' || !Array.isArray(element.geometry)) continue;
    const tags = isRecord(element.tags) ? element.tags : {};
    const highway = text(tags.highway);
    if (!highway || !HIGHWAYS.has(highway)) continue;
    const coordinates: TrafficLngLat[] = [];
    for (const node of element.geometry) {
      if (!isRecord(node)) continue;
      const lat = typeof node.lat === 'number' ? node.lat : undefined;
      const lon = typeof node.lon === 'number' ? node.lon : undefined;
      if (lat === undefined || lon === undefined) continue;
      coordinates.push([lon, lat]);
    }
    if (coordinates.length < 2) continue;
    ways.push({
      id: String(element.id ?? `${coordinates[0][0]},${coordinates[0][1]}`),
      ref: text(tags.ref),
      name: text(tags.name) ?? text(tags['name:en']),
      highway,
      coordinates,
    });
  }
  return ways;
}

function overpassQuery(bbox: TrafficBBox) {
  const [west, south, east, north] = bbox;
  return `[out:json][timeout:20];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${south},${west},${north},${east});out geom;`;
}

function overpassEndpoints() {
  const configured = serviceConfig.overpassEndpoint;
  return [...new Set([configured, ...FALLBACK_ENDPOINTS].filter(Boolean))];
}

async function fetchOverpass(query: string, signal: AbortSignal) {
  await OVERPASS_GATE.wait(signal);
  let lastError: Error | undefined;
  for (const endpoint of overpassEndpoints()) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams({ data: query }),
      }, 18_000);
      if (!response.ok) {
        lastError = apiHttpError(response, 'Overpass');
        continue;
      }
      return response.json() as Promise<unknown>;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error instanceof Error ? error : new Error('Overpass request failed');
    }
  }
  throw lastError ?? new Error('Overpass unavailable');
}

export function resetRoadTrafficRoadCaches() {
  cache.clear();
}

export async function fetchViewportRoads(bbox: TrafficBBox, signal?: AbortSignal) {
  const clamped = clampTrafficBbox(bbox);
  if (!clamped) return [];
  const key = bboxKey(clamped);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.ways;
  const controller = signal ?? new AbortController().signal;
  const ways = parseOverpassRoads(await fetchOverpass(overpassQuery(clamped), controller));
  cache.set(key, { ways, fetchedAt: Date.now() });
  return ways;
}
