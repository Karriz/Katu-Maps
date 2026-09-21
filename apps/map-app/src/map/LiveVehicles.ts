import type { GeoJSONSource, Map as MaplibreMap, Point } from 'maplibre-gl';
import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';
import type { LiveVehicleModelLayer } from './LiveVehicleModelLayer';
import { fetchLiveFuzzyTrip, fetchLiveTripById } from './transit/DigitransitProvider';
import { liveObservationSmoothingMs } from './transit/vehiclePosition';
import type { RouteLineDeckLayer } from './RouteLineDeckLayer';

export type LiveVehicleKind = 'bus' | 'tram' | 'metro' | 'train';

export type LiveVehicle = {
  id: string;
  provider: 'hsl' | 'nysse' | 'foli' | 'digitraffic';
  coordinates: [number, number];
  recordedAt: number;
  route: string;
  destination?: string;
  heading?: number;
  kind: LiveVehicleKind;
  tripId?: string;
  serviceDate?: string;
  stops?: Array<{ name: string; time?: string }>;
  routeId?: string;
  direction?: number;
  startSeconds?: number;
  color?: string;
  geometry?: [number, number][];
};

type Bounds = { west: number; south: number; east: number; north: number };
type UnknownRecord = Record<string, unknown>;

const SOURCE_ID = 'live-vehicles';
const SELECTED_ROUTE_SOURCE_ID = 'live-vehicle-selected-route';
const SELECTED_ROUTE_CASING_ID = 'live-vehicle-selected-route-casing';
const SELECTED_ROUTE_LINE_ID = 'live-vehicle-selected-route-line';
export const LIVE_VEHICLE_LAYER_IDS = ['live-vehicle-halo', 'live-vehicle-markers', 'live-vehicle-labels'] as const;
const FINLAND_BOUNDS: Bounds = { west: 19, south: 59, east: 32, north: 71 };
const HSL_BOUNDS: Bounds = { west: 23.9, south: 59.9, east: 25.6, north: 60.6 };
const NYSSE_BOUNDS: Bounds = { west: 23.2, south: 61.2, east: 24.5, north: 62.0 };
const FOLI_BOUNDS: Bounds = { west: 21.8, south: 60.2, east: 23.0, north: 60.8 };
const MAX_TRIP_LOOKUPS = 12;
const TRIP_CACHE_MS = 30 * 60_000;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function overlaps(a: Bounds, b: Bounds) {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function inside(vehicle: LiveVehicle, bounds: Bounds) {
  const [lng, lat] = vehicle.coordinates;
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function epochMs(value: unknown) {
  if (finite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function hhmmSeconds(value: unknown, compact = false) {
  const raw = text(value);
  if (!raw) return undefined;
  const match = compact ? /^(\d{2})(\d{2})$/.exec(raw) : /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 47 && minutes < 60 ? hours * 3600 + minutes * 60 : undefined;
}

function helsinkiDateAndSeconds(value: unknown) {
  const instant = epochMs(value);
  if (instant === undefined) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return { serviceDate: `${part('year')}-${part('month')}-${part('day')}`, startSeconds: Number(part('hour')) * 3600 + Number(part('minute')) * 60 };
}

function jsonResponse(response: Response, label: string) {
  if (!response.ok) throw apiHttpError(response, label);
  return response.json() as Promise<unknown>;
}

export function normalizeNysseFleet(payload: unknown): LiveVehicle[] {
  const root = payload as { Siri?: { ServiceDelivery?: { VehicleMonitoringDelivery?: Array<{ VehicleActivity?: UnknownRecord[] }> } } };
  const activities = root.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.flatMap((item) => item.VehicleActivity ?? []) ?? [];
  return activities.flatMap((activity) => {
    const journey = activity.MonitoredVehicleJourney as UnknownRecord | undefined;
    const location = journey?.VehicleLocation as UnknownRecord | undefined;
    const lng = location?.Longitude;
    const lat = location?.Latitude;
    const id = text((journey?.VehicleRef as UnknownRecord | undefined)?.value);
    const route = text((journey?.PublishedLineName as UnknownRecord | undefined)?.value)
      ?? text((journey?.LineRef as UnknownRecord | undefined)?.value);
    const recordedAt = epochMs(activity.RecordedAtTime);
    if (!id || !route || !finite(lng) || !finite(lat) || recordedAt === undefined) return [];
    const mode = text(journey?.VehicleMode)?.toLowerCase();
    return [{
      id: `nysse:${id}`, provider: 'nysse' as const, coordinates: [lng, lat] as [number, number],
      recordedAt, route, destination: text((journey?.DestinationName as UnknownRecord | undefined)?.value),
      heading: finite(journey?.Bearing) ? journey.Bearing : undefined,
      kind: mode === 'tram' || (route === '1' || route === '3') && String((journey?.OperatorRef as UnknownRecord | undefined)?.value) === '56920'
        ? 'tram' as const : 'bus' as const,
      serviceDate: text(((journey?.FramedVehicleJourneyRef as UnknownRecord | undefined)?.DataFrameRef as UnknownRecord | undefined)?.value),
      routeId: `tampere:${text((journey?.LineRef as UnknownRecord | undefined)?.value) ?? route}`,
      direction: Number((journey?.DirectionRef as UnknownRecord | undefined)?.value),
      startSeconds: hhmmSeconds((journey?.FramedVehicleJourneyRef as UnknownRecord | undefined)?.DatedVehicleJourneyRef, true),
    }];
  });
}

export function normalizeFoliFleet(payload: unknown): LiveVehicle[] {
  const vehicles = (payload as { result?: { vehicles?: Record<string, UnknownRecord> } }).result?.vehicles ?? {};
  return Object.entries(vehicles).flatMap(([key, vehicle]) => {
    const lng = vehicle.longitude;
    const lat = vehicle.latitude;
    const recordedAt = epochMs(vehicle.recordedattime);
    const route = text(vehicle.publishedlinename) ?? text(vehicle.__routeref);
    if (!route || !finite(lng) || !finite(lat) || recordedAt === undefined) return [];
    const vehicleId = text(vehicle.vehicleref) ?? key;
    return [{
      id: `foli:${vehicleId}`, provider: 'foli' as const, coordinates: [lng, lat] as [number, number],
      recordedAt, route, destination: text(vehicle.destinationname), kind: 'bus' as const,
      heading: finite(vehicle.bearing) ? vehicle.bearing : undefined,
      routeId: `FOLI:${text(vehicle.__routeref) ?? route}`,
      direction: Number(vehicle.__directionid),
      ...helsinkiDateAndSeconds(vehicle.originaimeddeparturetime),
      stops: (Array.isArray(vehicle.onwardcalls) ? vehicle.onwardcalls : []).flatMap((call) => {
        const stop = call as UnknownRecord;
        const name = text(stop.stoppointname);
        if (!name) return [];
        const time = epochMs(stop.expectedarrivaltime ?? stop.aimedarrivaltime);
        return [{ name, time: time === undefined ? undefined : new Date(time).toISOString() }];
      }),
    }];
  });
}

export function normalizeDigitrafficFleet(payload: unknown): LiveVehicle[] {
  const features = (payload as { features?: Array<{ geometry?: { coordinates?: unknown }; properties?: UnknownRecord }> }).features ?? [];
  return features.flatMap((feature) => {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties ?? {};
    const trainNumber = finite(properties.trainNumber) ? properties.trainNumber : undefined;
    const departureDate = text(properties.departureDate);
    const recordedAt = epochMs(properties.timestamp);
    if (properties.isGpsLocation !== true || !Array.isArray(coordinates) || !finite(coordinates[0]) || !finite(coordinates[1])
      || trainNumber === undefined || !departureDate || recordedAt === undefined) return [];
    const commuter = text(properties.commuterLineID);
    const type = text(properties.trainType);
    return [{
      id: `digitraffic:${departureDate}:${trainNumber}`, provider: 'digitraffic' as const,
      coordinates: [coordinates[0], coordinates[1]] as [number, number], recordedAt,
      route: commuter || `${type ? `${type} ` : ''}${trainNumber}`, kind: 'train' as const,
      tripId: `${trainNumber}_${departureDate.replaceAll('-', '')}`, serviceDate: departureDate,
      heading: finite(properties.heading) ? properties.heading : undefined,
    }];
  });
}

export function normalizeHslMessage(payload: unknown): LiveVehicle | undefined {
  const position = (payload as { VP?: UnknownRecord }).VP;
  const lng = position?.long;
  const lat = position?.lat;
  const vehicle = position && (typeof position.veh === 'string' || finite(position.veh)) ? String(position.veh) : undefined;
  const route = position && (text(position.desi) ?? text(position.route));
  const recordedAt = epochMs(position?.tst);
  if (!vehicle || !route || !finite(lng) || !finite(lat) || recordedAt === undefined) return undefined;
  const operator = position && (typeof position.oper === 'string' || finite(position.oper)) ? String(position.oper) : '';
  const mode = text(position?.mode)?.toLowerCase();
  return {
    id: `hsl:${operator}:${vehicle}`, provider: 'hsl', coordinates: [lng, lat], recordedAt, route,
    destination: text(position?.dest), heading: finite(position?.hdg) ? position.hdg : undefined,
    kind: mode === 'tram' ? 'tram' : mode === 'metro' ? 'metro' : mode === 'train' ? 'train' : 'bus',
    serviceDate: text(position?.oday),
    routeId: position && text(position.route) ? `HSL:${text(position.route)}` : undefined,
    direction: finite(position?.dir) ? position.dir - 1 : undefined,
    startSeconds: hhmmSeconds(position?.start),
  };
}

async function fetchJson(url: string, label: string, signal?: AbortSignal, headers?: HeadersInit) {
  return jsonResponse(await fetchWithTimeout(url, { signal, headers: { Accept: 'application/json', ...headers } }, 10_000), label);
}

async function collectHsl(signal?: AbortSignal) {
  const { default: mqtt } = await import('mqtt');
  const client = await mqtt.connectAsync(serviceConfig.hslMqttEndpoint, { protocolVersion: 4, reconnectPeriod: 0, connectTimeout: 5_000 });
  const vehicles = new Map<string, LiveVehicle>();
  try {
    await client.subscribeAsync('/hfp/v2/journey/ongoing/vp/+/+/+/+/+/+/+/#', { qos: 0 });
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = window.setTimeout(finish, 2_000);
      signal?.addEventListener('abort', finish, { once: true });
      client.on('message', (_topic, message) => {
        try {
          const vehicle = normalizeHslMessage(JSON.parse(message.toString()));
          if (vehicle) vehicles.set(vehicle.id, vehicle);
        } catch { /* Ignore malformed broker messages. */ }
      });
    });
  } finally {
    await client.endAsync();
  }
  return [...vehicles.values()];
}

export async function fetchLiveVehicles(bounds: Bounds, zoom: number, signal?: AbortSignal) {
  const requests: Array<Promise<LiveVehicle[]>> = [];
  if (zoom >= 4 && overlaps(bounds, FINLAND_BOUNDS)) {
    requests.push(fetchJson(`${serviceConfig.digitrafficRailEndpoint}/train-locations.geojson/latest`, 'Digitraffic train locations', signal, {
      'Digitraffic-User': serviceConfig.clientId,
    }).then(normalizeDigitrafficFleet));
  }
  if (zoom >= 9 && overlaps(bounds, HSL_BOUNDS)) requests.push(collectHsl(signal));
  if (zoom >= 9 && overlaps(bounds, NYSSE_BOUNDS)) {
    requests.push(fetchJson(serviceConfig.nysseVehiclePositionsEndpoint, 'Nysse vehicle positions', signal).then(normalizeNysseFleet));
  }
  if (zoom >= 9 && overlaps(bounds, FOLI_BOUNDS)) {
    requests.push(fetchJson(serviceConfig.foliVehiclePositionsEndpoint, 'Föli vehicle positions', signal).then(normalizeFoliFleet));
  }
  const settled = await Promise.allSettled(requests);
  return settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((vehicle) => inside(vehicle, bounds) && vehicle.recordedAt >= Date.now() - 90_000);
}

function collection(vehicles: LiveVehicle[], detailed = new Set<string>()): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((vehicle) => ({
      type: 'Feature', id: vehicle.id, geometry: { type: 'Point', coordinates: vehicle.coordinates },
      properties: { id: vehicle.id, route: vehicle.route, kind: vehicle.kind,
        color: vehicle.color, detailed: detailed.has(vehicle.id) },
    })),
  };
}

export function selectedLiveVehicleRoute(vehicle: LiveVehicle | undefined): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const geometry = vehicle?.geometry;
  return { type: 'FeatureCollection', features: geometry && geometry.length >= 2
    && geometry.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: geometry },
      properties: { color: vehicle.color ?? ({ train: '#21845b', tram: '#8554c7', metro: '#e87524', bus: '#1769e8' })[vehicle.kind] } }]
    : [] };
}

export function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy);
}

export function snapToGeometry(coordinates: [number, number], geometry?: [number, number][]) {
  if (!geometry || geometry.length < 2) return undefined;
  const metersPerLng = 111_320 * Math.cos(coordinates[1] * Math.PI / 180);
  let closest: { coordinates: [number, number]; distance: number } | undefined;
  for (let index = 1; index < geometry.length; index += 1) {
    const a = geometry[index - 1];
    const b = geometry[index];
    const dx = (b[0] - a[0]) * metersPerLng;
    const dy = (b[1] - a[1]) * 111_320;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const fraction = Math.max(0, Math.min(1, (((coordinates[0] - a[0]) * metersPerLng) * dx
      + (coordinates[1] - a[1]) * 111_320 * dy) / lengthSquared));
    const point: [number, number] = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])];
    const distance = Math.hypot((coordinates[0] - point[0]) * metersPerLng, (coordinates[1] - point[1]) * 111_320);
    if (!closest || distance < closest.distance) closest = { coordinates: point, distance };
  }
  return closest && closest.distance <= 65 ? closest.coordinates : undefined;
}

export function interpolatedCoordinates(from: [number, number], to: [number, number], fraction: number): [number, number] {
  const t = Math.max(0, Math.min(1, fraction));
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

export function interpolateOnRoute(from: [number, number], to: [number, number], geometry: [number, number][] | undefined, fraction: number) {
  if (!geometry || geometry.length < 2) return interpolatedCoordinates(from, to, fraction);
  const latitude = (from[1] + to[1]) / 2;
  const metersPerLng = 111_320 * Math.cos(latitude * Math.PI / 180);
  const lengths = [0];
  for (let index = 1; index < geometry.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot((geometry[index][0] - geometry[index - 1][0]) * metersPerLng,
      (geometry[index][1] - geometry[index - 1][1]) * 111_320));
  }
  const progress = (point: [number, number]) => {
    let best = { distance: Infinity, progress: 0 };
    for (let index = 1; index < geometry.length; index += 1) {
      const a = geometry[index - 1];
      const b = geometry[index];
      const dx = (b[0] - a[0]) * metersPerLng;
      const dy = (b[1] - a[1]) * 111_320;
      const segment = lengths[index] - lengths[index - 1];
      if (segment < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * metersPerLng * dx + (point[1] - a[1]) * 111_320 * dy) / (segment * segment)));
      const distance = Math.hypot((point[0] - a[0]) * metersPerLng - dx * t,
        (point[1] - a[1]) * 111_320 - dy * t);
      if (distance < best.distance) best = { distance, progress: lengths[index - 1] + segment * t };
    }
    return best;
  };
  const start = progress(from);
  const end = progress(to);
  const straight = Math.hypot((to[0] - from[0]) * metersPerLng, (to[1] - from[1]) * 111_320);
  const routeDistance = end.progress - start.progress;
  if (start.distance > 15 || end.distance > 15 || routeDistance < 0 || routeDistance > Math.max(200, straight * 3)) {
    return interpolatedCoordinates(from, to, fraction);
  }
  const target = start.progress + routeDistance * Math.max(0, Math.min(1, fraction));
  const index = Math.max(1, lengths.findIndex((length) => length >= target));
  const segment = lengths[index] - lengths[index - 1];
  return interpolatedCoordinates(geometry[index - 1], geometry[index], segment ? (target - lengths[index - 1]) / segment : 0);
}

export function routeSectionPoses(center: [number, number], geometry: [number, number][] | undefined,
  count: number, spacingMeters: number, fallbackHeading = 0) {
  if (!geometry || geometry.length < 2) return Array.from({ length: count }, (_, index) => {
    const offset = (index - (count - 1) / 2) * spacingMeters;
    const radians = fallbackHeading * Math.PI / 180;
    return { coordinates: [center[0] + Math.sin(radians) * offset / (111_320 * Math.cos(center[1] * Math.PI / 180)),
      center[1] + Math.cos(radians) * offset / 111_320] as [number, number], heading: fallbackHeading };
  });
  const metersPerLng = 111_320 * Math.cos(center[1] * Math.PI / 180);
  const lengths = [0];
  let closest = { distance: Infinity, progress: 0 };
  for (let index = 1; index < geometry.length; index += 1) {
    const a = geometry[index - 1]; const b = geometry[index];
    const dx = (b[0] - a[0]) * metersPerLng; const dy = (b[1] - a[1]) * 111_320;
    const segment = Math.hypot(dx, dy);
    lengths.push(lengths[index - 1] + segment);
    if (!segment) continue;
    const t = Math.max(0, Math.min(1, ((center[0] - a[0]) * metersPerLng * dx + (center[1] - a[1]) * 111_320 * dy) / (segment * segment)));
    const distance = Math.hypot((center[0] - a[0]) * metersPerLng - dx * t, (center[1] - a[1]) * 111_320 - dy * t);
    if (distance < closest.distance) closest = { distance, progress: lengths[index - 1] + segment * t };
  }
  if (closest.distance > 65) return routeSectionPoses(center, undefined, count, spacingMeters, fallbackHeading);
  return Array.from({ length: count }, (_, part) => {
    const target = Math.max(0, Math.min(lengths[lengths.length - 1], closest.progress + (part - (count - 1) / 2) * spacingMeters));
    const index = Math.max(1, lengths.findIndex((distance) => distance >= target));
    const fraction = lengths[index] > lengths[index - 1] ? (target - lengths[index - 1]) / (lengths[index] - lengths[index - 1]) : 0;
    const a = geometry[index - 1]; const b = geometry[index];
    return { coordinates: interpolatedCoordinates(a, b, fraction),
      heading: Math.atan2((b[0] - a[0]) * metersPerLng, (b[1] - a[1]) * 111_320) * 180 / Math.PI };
  });
}

function modelLength(kind: LiveVehicleKind) {
  if (kind === 'train' || kind === 'metro') return 95;
  if (kind === 'tram') return 27;
  return 12;
}

function vehicleScreenDistance(map: MaplibreMap, vehicle: LiveVehicle, point: Point, detailed: boolean) {
  const center = map.project(vehicle.coordinates);
  if (!detailed || vehicle.heading === undefined) return Math.hypot(point.x - center.x, point.y - center.y);
  const halfLength = modelLength(vehicle.kind) / 2;
  const heading = vehicle.heading * Math.PI / 180;
  const east = Math.sin(heading) * halfLength;
  const north = Math.cos(heading) * halfLength;
  const latitudeStep = north / 111_320;
  const longitudeStep = east / (111_320 * Math.max(0.1, Math.cos(vehicle.coordinates[1] * Math.PI / 180)));
  const front = map.project([vehicle.coordinates[0] + longitudeStep, vehicle.coordinates[1] + latitudeStep]);
  const rear = map.project([vehicle.coordinates[0] - longitudeStep, vehicle.coordinates[1] - latitudeStep]);
  return distanceToSegment(point, front, rear);
}

export class LiveVehiclesLayer {
  private map: MaplibreMap | null = null;
  private controller: AbortController | null = null;
  private selectedController: AbortController | null = null;
  private selectedId: string | null = null;
  private selectedVehicle: LiveVehicle | null = null;
  private vehicles = new Map<string, LiveVehicle>();
  private displayedVehicles = new Map<string, LiveVehicle>();
  private modelLayer: LiveVehicleModelLayer | null = null;
  private routeDeckLayer: RouteLineDeckLayer | null = null;
  private deckGeometry: [number, number][] | undefined;
  private deckColor: string | undefined;
  private detailedIds = new Set<string>();
  private visible = false;
  private tripCache = new Map<string, { expires: number; value?: Awaited<ReturnType<typeof fetchLiveFuzzyTrip>> }>();
  private animationFrame = 0;
  private lastPaint = 0;
  private transitions = new Map<string, { from: [number, number]; to: [number, number]; started: number; duration: number;
    geometry?: [number, number][] }>();

  constructor(private readonly onSelect: (vehicle: LiveVehicle) => void,
    private readonly onAnimatedPosition: (vehicle: LiveVehicle) => void = () => undefined) {}

  setModelLayer(layer: LiveVehicleModelLayer) { this.modelLayer = layer; }

  setRouteDeckLayer(layer: RouteLineDeckLayer) { this.routeDeckLayer = layer; }

  clearSelection() {
    this.selectedId = null;
    this.selectedVehicle = null;
    this.selectedController?.abort();
    this.updateSelectedRoute();
  }

  private updateSelectedRoute() {
    const selected = this.selectedId ? this.vehicles.get(this.selectedId) ?? this.selectedVehicle ?? undefined : undefined;
    const route = selectedLiveVehicleRoute(selected);
    (this.map?.getSource(SELECTED_ROUTE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(route);
    const feature = route.features[0];
    const geometry = feature?.geometry.coordinates as [number, number][] | undefined;
    const color = feature?.properties?.color as string | undefined;
    if (geometry !== this.deckGeometry || color !== this.deckColor) {
      this.deckGeometry = geometry;
      this.deckColor = color;
      this.routeDeckLayer?.setFeatures(geometry && color ? [{ coordinates: geometry, color,
        widthPixels: 4.5, casingWidthPixels: 8 }] : []);
    }
    this.routeDeckLayer?.setVisible(this.visible && Boolean(geometry));
  }

  vehicleAtPoint(point: Point) {
    if (!this.visible || !this.map) return undefined;
    let nearest: LiveVehicle | undefined;
    let distance = 24;
    for (const vehicle of this.displayedVehicles.values()) {
      const candidate = vehicleScreenDistance(this.map, vehicle, point, this.detailedIds.has(vehicle.id));
      if (candidate >= distance) continue;
      nearest = vehicle;
      distance = candidate;
    }
    return nearest;
  }

  hasVehicleAtPoint(point: Point) { return Boolean(this.vehicleAtPoint(point)); }

  install(map: MaplibreMap, interactionBlocked: () => boolean = () => false) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: collection([]) });
    map.addSource(SELECTED_ROUTE_SOURCE_ID, { type: 'geojson', data: selectedLiveVehicleRoute(undefined) });
    const before = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    map.addLayer({ id: SELECTED_ROUTE_CASING_ID, type: 'line', source: SELECTED_ROUTE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#fffdf8', 'line-opacity': 0.88,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 6, 16, 10] },
    }, before);
    map.addLayer({ id: SELECTED_ROUTE_LINE_ID, type: 'line', source: SELECTED_ROUTE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.92,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 3.5, 16, 6] },
    }, before);
    map.addLayer({ id: LIVE_VEHICLE_LAYER_IDS[0], type: 'circle', source: SOURCE_ID, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 6, 16, 10],
      'circle-color': '#ffffff', 'circle-opacity': ['case', ['get', 'detailed'], 0.01, 0.94],
      'circle-stroke-color': '#17324d', 'circle-stroke-width': 1.5,
      'circle-stroke-opacity': ['case', ['get', 'detailed'], 0.01, 1],
    } }, before);
    map.addLayer({ id: LIVE_VEHICLE_LAYER_IDS[1], type: 'circle', source: SOURCE_ID, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 4, 16, 7],
      'circle-color': ['coalesce', ['get', 'color'], ['match', ['get', 'kind'], 'train', '#21845b', 'tram', '#8554c7', 'metro', '#e87524', '#1769e8']],
      'circle-opacity': ['case', ['get', 'detailed'], 0.01, 1],
    } }, before);
    map.addLayer({ id: LIVE_VEHICLE_LAYER_IDS[2], type: 'symbol', source: SOURCE_ID, minzoom: 7, layout: {
      'text-field': ['get', 'route'], 'text-font': ['Noto Sans Bold', 'Open Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 16, 12], 'text-offset': [0, 1.25],
      'text-anchor': 'top', 'text-optional': true, 'text-allow-overlap': false,
    }, paint: { 'text-color': '#17324d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } }, before);
    const select = (point: Point) => {
      if (interactionBlocked()) return;
      const vehicle = this.vehicleAtPoint(point);
      if (!vehicle) return;
      this.selectedId = vehicle.id;
      this.selectedVehicle = vehicle;
      this.onSelect(vehicle);
      this.updateSelectedRoute();
      if (!vehicle.geometry) void this.enrichSelectedVehicle(vehicle.id);
    };
    map.on('click', (event) => select(event.point));
    let hovering = false;
    map.on('mousemove', (event) => {
      const hit = this.hasVehicleAtPoint(event.point);
      if (hit) {
        map.getCanvas().style.cursor = 'pointer';
        hovering = true;
      } else if (hovering) {
        map.getCanvas().style.cursor = '';
        hovering = false;
      }
    });
    for (const id of LIVE_VEHICLE_LAYER_IDS) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
  }

  async update(bounds: Bounds, zoom: number) {
    if (!this.map) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const vehicles = await fetchLiveVehicles(bounds, zoom, controller.signal);
    if (controller.signal.aborted || !this.map) return;
    this.commitVehicles(vehicles);
    const center = this.map.getCenter();
    const candidates = zoom >= 12 ? vehicles : vehicles.filter((vehicle) => vehicle.provider === 'digitraffic');
    const ranked = [...candidates].sort((a, b) => {
      const distance = (v: LiveVehicle) => (v.coordinates[0] - center.lng) ** 2 + (v.coordinates[1] - center.lat) ** 2;
      return distance(a) - distance(b);
    }).slice(0, MAX_TRIP_LOOKUPS);
    void Promise.all(ranked.map((vehicle) => this.enrichVehicle(vehicle, controller.signal))).then(() => {
      if (!controller.signal.aborted && this.map) this.commitVehicles(vehicles);
    });
  }

  private async enrichVehicle(vehicle: LiveVehicle, signal: AbortSignal) {
    if (!vehicle.serviceDate) return;
    const directId = vehicle.provider === 'digitraffic' && vehicle.tripId
      ? `digitraffic:${vehicle.tripId.replace(/^digitraffic:/, '')}` : undefined;
    if (!directId && (!vehicle.routeId || !Number.isInteger(vehicle.direction)
      || !Number.isInteger(vehicle.startSeconds))) return;
    const key = directId ?? `${vehicle.routeId}|${vehicle.serviceDate}|${vehicle.direction}|${vehicle.startSeconds}`;
    let cached = this.tripCache.get(key);
    if (!cached || cached.expires < Date.now()) {
      try {
        const value = directId
          ? await fetchLiveTripById(directId, vehicle.serviceDate, signal)
          : await fetchLiveFuzzyTrip({ routeId: vehicle.routeId!, serviceDate: vehicle.serviceDate,
            direction: vehicle.direction!, startSeconds: vehicle.startSeconds! }, signal);
        if (signal.aborted) return;
        cached = { expires: Date.now() + (value ? TRIP_CACHE_MS : 60_000), value };
        this.tripCache.set(key, cached);
      } catch { /* Vehicle positions remain usable if trip lookup is unavailable. */ }
    }
    if (!cached?.value || signal.aborted) return;
    vehicle.tripId = cached.value.tripId;
    vehicle.color = cached.value.color;
    vehicle.geometry = cached.value.geometry;
    vehicle.stops = cached.value.stops;
    vehicle.coordinates = snapToGeometry(vehicle.coordinates, vehicle.geometry) ?? vehicle.coordinates;
  }

  private async enrichSelectedVehicle(id: string) {
    this.selectedController?.abort();
    const controller = new AbortController();
    this.selectedController = controller;
    const vehicle = this.vehicles.get(id);
    if (!vehicle) return;
    const enriched = { ...vehicle };
    await this.enrichVehicle(enriched, controller.signal);
    if (controller.signal.aborted || this.selectedId !== id || !this.map || !enriched.geometry) return;
    this.commitVehicles([...this.vehicles.values()].map((candidate) => candidate.id === id ? enriched : candidate));
  }

  private commitVehicles(vehicles: LiveVehicle[]) {
    if (!this.map) return;
    const now = performance.now();
    const previous = this.vehicles;
    for (const vehicle of vehicles) {
      const prior = previous.get(vehicle.id);
      if (prior && vehicle.recordedAt < prior.recordedAt) {
        Object.assign(vehicle, prior);
        continue;
      }
      if (!prior?.geometry || vehicle.geometry || prior.provider !== vehicle.provider
        || prior.serviceDate !== vehicle.serviceDate || prior.routeId !== vehicle.routeId
        || prior.startSeconds !== vehicle.startSeconds) continue;
      vehicle.geometry = prior.geometry;
      vehicle.color = prior.color;
      vehicle.stops = prior.stops;
      vehicle.tripId = prior.tripId;
      vehicle.coordinates = snapToGeometry(vehicle.coordinates, vehicle.geometry) ?? vehicle.coordinates;
    }
    this.vehicles = new Map(vehicles.map((vehicle) => [vehicle.id, { ...vehicle }]));
    if (this.selectedId) this.selectedVehicle = this.vehicles.get(this.selectedId) ?? this.selectedVehicle;
    this.updateSelectedRoute();
    this.transitions = new Map(vehicles.map((vehicle) => {
      const prior = previous.get(vehicle.id);
      const priorTransition = this.transitions.get(vehicle.id);
      const sameObservation = prior?.recordedAt === vehicle.recordedAt;
      const sameTarget = priorTransition?.to[0] === vehicle.coordinates[0]
        && priorTransition.to[1] === vehicle.coordinates[1];
      if (sameObservation && sameTarget && priorTransition) return [vehicle.id, priorTransition];
      const from = priorTransition ? interpolateOnRoute(priorTransition.from, priorTransition.to, priorTransition.geometry,
        priorTransition.duration > 0 ? (now - priorTransition.started) / priorTransition.duration : 1)
        : prior?.coordinates ?? vehicle.coordinates;
      const duration = !prior ? 0 : liveObservationSmoothingMs(
        sameObservation ? undefined : prior.recordedAt, vehicle.recordedAt);
      return [vehicle.id, { from, to: vehicle.coordinates, started: now, duration, geometry: vehicle.geometry }];
    }));
    this.detailedIds = this.modelLayer?.setVehicles(vehicles) ?? new Set<string>();
    cancelAnimationFrame(this.animationFrame);
    this.lastPaint = 0;
    this.paintAnimated();
    if (this.selectedId) {
      const selected = this.vehicles.get(this.selectedId);
      if (selected) this.onSelect(selected);
    }
  }

  private paintAnimated = () => {
    if (!this.map || !this.visible) return;
    const now = performance.now();
    if (now - this.lastPaint < 80) {
      this.animationFrame = requestAnimationFrame(this.paintAnimated);
      return;
    }
    this.lastPaint = now;
    let moving = false;
    const display = [...this.vehicles.values()].map((vehicle) => {
      const transition = this.transitions.get(vehicle.id);
      if (!transition) return vehicle;
      const fraction = transition.duration > 0 ? (now - transition.started) / transition.duration : 1;
      if (fraction < 1) moving = true;
      return { ...vehicle, coordinates: interpolateOnRoute(transition.from, transition.to, transition.geometry, fraction) };
    });
    this.displayedVehicles = new Map(display.map((vehicle) => [vehicle.id, vehicle]));
    (this.map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(collection(display, this.detailedIds));
    this.modelLayer?.setVehicles(display);
    if (this.selectedId) {
      const selected = display.find((vehicle) => vehicle.id === this.selectedId);
      if (selected) this.onAnimatedPosition(selected);
    }
    if (moving) this.animationFrame = requestAnimationFrame(this.paintAnimated);
  };

  setVisibility(visible: boolean) {
    this.visible = visible;
    for (const id of [SELECTED_ROUTE_CASING_ID, SELECTED_ROUTE_LINE_ID]) {
      if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    for (const id of LIVE_VEHICLE_LAYER_IDS) {
      if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    if (!visible) this.controller?.abort();
    this.routeDeckLayer?.setVisible(visible && Boolean(this.deckGeometry));
    if (!visible) this.selectedController?.abort();
    if (!visible) cancelAnimationFrame(this.animationFrame);
    if (visible && this.vehicles.size) this.paintAnimated();
    if (!visible) this.modelLayer?.setVehicles([]);
    if (!visible) this.detailedIds.clear();
    if (!visible) this.clearSelection();
  }

  dispose() {
    this.controller?.abort();
    this.selectedController?.abort();
    cancelAnimationFrame(this.animationFrame);
    this.map = null;
    this.vehicles.clear();
    this.displayedVehicles.clear();
    this.detailedIds.clear();
    this.modelLayer = null;
    this.routeDeckLayer?.setFeatures([]);
    this.routeDeckLayer?.setVisible(false);
    this.routeDeckLayer = null;
  }
}
