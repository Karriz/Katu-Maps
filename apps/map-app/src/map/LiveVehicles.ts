import type { GeoJSONSource, Map, MapGeoJSONFeature, Point } from 'maplibre-gl';
import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';

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
};

type Bounds = { west: number; south: number; east: number; north: number };
type UnknownRecord = Record<string, unknown>;

const SOURCE_ID = 'live-vehicles';
export const LIVE_VEHICLE_LAYER_IDS = ['live-vehicle-halo', 'live-vehicle-markers', 'live-vehicle-labels'] as const;
const FINLAND_BOUNDS: Bounds = { west: 19, south: 59, east: 32, north: 71 };
const HSL_BOUNDS: Bounds = { west: 23.9, south: 59.9, east: 25.6, north: 60.6 };
const NYSSE_BOUNDS: Bounds = { west: 23.2, south: 61.2, east: 24.5, north: 62.0 };
const FOLI_BOUNDS: Bounds = { west: 21.8, south: 60.2, east: 23.0, north: 60.8 };

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
      kind: mode === 'tram' ? 'tram' as const : 'bus' as const,
      tripId: text((journey?.FramedVehicleJourneyRef as UnknownRecord | undefined)?.DatedVehicleJourneyRef),
      serviceDate: text(((journey?.FramedVehicleJourneyRef as UnknownRecord | undefined)?.DataFrameRef as UnknownRecord | undefined)?.value),
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
      tripId: text(vehicle.tripref),
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
    if (!Array.isArray(coordinates) || !finite(coordinates[0]) || !finite(coordinates[1])
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

function collection(vehicles: LiveVehicle[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((vehicle) => ({
      type: 'Feature', id: vehicle.id, geometry: { type: 'Point', coordinates: vehicle.coordinates },
      properties: { ...vehicle, coordinates: undefined },
    })),
  };
}

export class LiveVehiclesLayer {
  private map: Map | null = null;
  private controller: AbortController | null = null;
  private selectedId: string | null = null;
  private vehicles = new Map<string, LiveVehicle>();

  constructor(private readonly onSelect: (vehicle: LiveVehicle) => void) {}

  install(map: Map, interactionBlocked: () => boolean = () => false) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: collection([]) });
    const before = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    map.addLayer({ id: LIVE_VEHICLE_LAYER_IDS[0], type: 'circle', source: SOURCE_ID, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 6, 16, 10],
      'circle-color': '#ffffff', 'circle-opacity': 0.94, 'circle-stroke-color': '#17324d', 'circle-stroke-width': 1.5,
    } }, before);
    map.addLayer({ id: LIVE_VEHICLE_LAYER_IDS[1], type: 'circle', source: SOURCE_ID, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 10, 4, 16, 7],
      'circle-color': ['match', ['get', 'kind'], 'train', '#21845b', 'tram', '#8554c7', 'metro', '#e87524', '#1769e8'],
    } }, before);
    map.addLayer({ id: LIVE_VEHICLE_LAYER_IDS[2], type: 'symbol', source: SOURCE_ID, minzoom: 7, layout: {
      'text-field': ['get', 'route'], 'text-font': ['Noto Sans Bold', 'Open Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 16, 12], 'text-offset': [0, 1.25],
      'text-anchor': 'top', 'text-optional': true, 'text-allow-overlap': false,
    }, paint: { 'text-color': '#17324d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } }, before);
    const select = (feature: MapGeoJSONFeature | undefined) => {
      if (interactionBlocked() || !feature) return;
      const vehicle = this.vehicles.get(String(feature.id));
      if (!vehicle) return;
      this.selectedId = vehicle.id;
      this.onSelect(vehicle);
    };
    map.on('click', (event) => select(map.queryRenderedFeatures(event.point as Point, { layers: [...LIVE_VEHICLE_LAYER_IDS] })[0]));
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
    this.vehicles = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    (this.map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(collection(vehicles));
    if (this.selectedId) {
      const selected = this.vehicles.get(this.selectedId);
      if (selected) this.onSelect(selected);
    }
  }

  setVisibility(visible: boolean) {
    for (const id of LIVE_VEHICLE_LAYER_IDS) {
      if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    if (!visible) this.controller?.abort();
  }

  dispose() {
    this.controller?.abort();
    this.map = null;
    this.vehicles.clear();
  }
}
