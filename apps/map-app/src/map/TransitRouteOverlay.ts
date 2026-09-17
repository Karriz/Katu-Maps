import type { GeoJSONSource, LineLayerSpecification, Map } from 'maplibre-gl';
import { decodePolyline } from './transit/utils';
import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';

const SOURCE_ID = 'transit-route-overlay';
const CASING_LAYER_ID = 'transit-route-overlay-casing';
const LINE_LAYER_ID = 'transit-route-overlay-lines';
const HEADERS = { Accept: 'application/json', 'X-Client-Id': serviceConfig.clientId };
const RAIL_MODES = new Set([
  'TRAM', 'SUBWAY', 'RAIL', 'SUBURBAN', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL', 'FUNICULAR',
]);
const MAX_RAIL_SEGMENT_METERS = 2_000;

type EncodedPolyline = { points?: unknown; precision?: unknown };
type TransitRoute = {
  mode?: unknown;
  transitRoutes?: Array<{ id?: unknown; shortName?: unknown; longName?: unknown; color?: unknown }>;
};
type TransitousMapRoutes = {
  routes?: TransitRoute[];
  polylines?: Array<{ polyline?: EncodedPolyline; colors?: unknown; routeIndexes?: unknown }>;
};

type OverlayFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { color: string; label: string; mode: string };
};

function defaultColor(mode: string) {
  if (mode === 'SUBWAY') return '#e87524';
  if (mode === 'TRAM') return '#8554c7';
  return '#4f9b70';
}

function color(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function distanceMeters(from: [number, number], to: [number, number]) {
  const radians = Math.PI / 180;
  const latitude1 = from[1] * radians;
  const latitude2 = to[1] * radians;
  const latitudeDelta = (to[1] - from[1]) * radians;
  const longitudeDelta = (to[0] - from[0]) * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

/** Split rather than reconnecting a route when its source contains an implausible rail segment. */
function plausibleRailFragments(coordinates: [number, number][]) {
  const fragments: [number, number][][] = [];
  let fragment: [number, number][] = coordinates.length > 0 ? [coordinates[0]] : [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index];
    if (distanceMeters(coordinates[index - 1], coordinate) > MAX_RAIL_SEGMENT_METERS) {
      if (fragment.length >= 2) fragments.push(fragment);
      fragment = [coordinate];
    } else {
      fragment.push(coordinate);
    }
  }
  if (fragment.length >= 2) fragments.push(fragment);
  return fragments;
}

export function railRouteFeatures(payload: TransitousMapRoutes): OverlayFeature[] {
  const routes = payload.routes ?? [];
  const features: OverlayFeature[] = [];
  (payload.polylines ?? []).forEach((line, lineIndex) => {
    if (!Array.isArray(line.routeIndexes) || !line.polyline || typeof line.polyline.points !== 'string') return;
    const precision = typeof line.polyline.precision === 'number' ? line.polyline.precision : 5;
    const coordinates = decodePolyline(line.polyline.points, precision);
    if (coordinates.length < 2) return;
    line.routeIndexes.forEach((routeIndex) => {
      if (typeof routeIndex !== 'number') return;
      const route = routes[routeIndex];
      const mode = typeof route?.mode === 'string' ? route.mode.toUpperCase() : '';
      if (!RAIL_MODES.has(mode)) return;
      const service = route.transitRoutes?.[0];
      const label = [service?.shortName, service?.longName].find((value): value is string => typeof value === 'string') ?? mode;
      plausibleRailFragments(coordinates).forEach((fragment, fragmentIndex) => {
        features.push({
          type: 'Feature',
          id: `${routeIndex}:${lineIndex}:${fragmentIndex}`,
          geometry: { type: 'LineString', coordinates: fragment },
          properties: { color: color(service?.color ?? (Array.isArray(line.colors) ? line.colors[0] : undefined), defaultColor(mode)), label, mode },
        });
      });
    });
  });
  return features;
}

function emptyCollection() {
  return { type: 'FeatureCollection' as const, features: [] as OverlayFeature[] };
}

export class TransitRouteOverlay {
  private map: Map | null = null;
  private controller: AbortController | null = null;
  private requestVersion = 0;
  private visible = false;
  private lastRequestKey = '';

  install(map: Map) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    const casing: LineLayerSpecification = {
      id: CASING_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fffdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3.6, 8, 4.4, 12, 5.2, 18, 8], 'line-opacity': 0.9 },
    };
    const lines: LineLayerSpecification = {
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 8, 2.2, 12, 2.7, 18, 4.8],
        'line-opacity': 0.96,
      },
    };
    const before = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    map.addLayer(casing, before);
    map.addLayer(lines, before);
  }

  setVisibility(visible: boolean) {
    this.visible = visible;
    if (!this.map) return;
    [CASING_LAYER_ID, LINE_LAYER_ID].forEach((layerId) => {
      if (this.map?.getLayer(layerId)) this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    });
    if (!visible) this.clear();
  }

  async update(bounds: { getSouth(): number; getWest(): number; getNorth(): number; getEast(): number }, zoom: number) {
    if (!this.map || !this.visible) return;
    const zoomBucket = Math.max(4, Math.floor(zoom));
    const key = [zoomBucket, bounds.getSouth().toFixed(3), bounds.getWest().toFixed(3), bounds.getNorth().toFixed(3), bounds.getEast().toFixed(3)].join(':');
    if (key === this.lastRequestKey) return;
    this.lastRequestKey = key;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const requestVersion = ++this.requestVersion;
    const params = new URLSearchParams({
      zoom: String(zoomBucket),
      min: `${bounds.getSouth()},${bounds.getWest()}`,
      max: `${bounds.getNorth()},${bounds.getEast()}`,
      language: typeof navigator === 'undefined' ? 'en' : navigator.language,
    });
    try {
      const response = await fetchWithTimeout(`${serviceConfig.transitousRoutesEndpoint}?${params}`, {
        signal: controller.signal,
        headers: HEADERS,
      }, 20_000);
      if (!response.ok) throw apiHttpError(response, 'Transitous');
      const payload = await response.json() as TransitousMapRoutes;
      if (this.map !== null && requestVersion === this.requestVersion) {
        (this.map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: railRouteFeatures(payload),
        });
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') console.warn('Transit route overlay request failed.', error);
    }
  }

  clear() {
    this.controller?.abort();
    this.lastRequestKey = '';
    (this.map?.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(emptyCollection());
  }

  dispose() {
    this.controller?.abort();
    this.requestVersion += 1;
    this.map = null;
  }
}
