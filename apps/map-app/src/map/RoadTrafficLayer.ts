import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  Map,
  MapGeoJSONFeature,
  Point,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { Construction, TriangleAlert, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAP_COLORS } from './MapPalette';
import {
  fetchRoadTrafficStations,
  stationCongestion,
  TRAFFIC_CONGESTION_COLORS,
  type RoadTrafficSelection,
  type RoadTrafficStation,
} from './RoadTraffic';
import {
  fetchRoadTrafficMessages,
  type RoadTrafficMessage,
} from './RoadTrafficMessages';
import { fetchViewportRoads, TRAFFIC_ROAD_SNAP_MIN_ZOOM, trafficRoadsRequestKey } from './RoadTrafficRoads';
import { mergeRoadNetwork, stationSegmentCoordinates, type RoadTrafficWay } from './RoadTrafficSnap';

const SOURCE_ID = 'road-traffic';
const SELECTED_SOURCE_ID = 'road-traffic-selected';
const MESSAGE_SOURCE_ID = 'road-traffic-messages';
const MESSAGE_SELECTED_SOURCE_ID = 'road-traffic-messages-selected';
const ROADWORK_ICON_ID = 'road-traffic-roadwork-icon';
const INCIDENT_ICON_ID = 'road-traffic-incident-icon';

export const ROAD_TRAFFIC_LAYER_IDS = [
  'road-traffic-dots',
  'road-traffic-casings',
  'road-traffic-lines',
  'road-traffic-hit-targets',
  'road-traffic-selected-halo',
  'road-traffic-selected-line',
  'road-traffic-message-lines',
  'road-traffic-message-hit-targets',
  'road-traffic-message-dots',
  'road-traffic-message-point-hits',
  'road-traffic-message-icons',
  'road-traffic-message-selected-line',
  'road-traffic-message-selected-halo',
  'road-traffic-message-selected-icon',
] as const;

export const ROAD_TRAFFIC_INTERACTIVE_LAYER_IDS = [
  'road-traffic-message-hit-targets',
  'road-traffic-message-point-hits',
  'road-traffic-message-icons',
  'road-traffic-message-selected-icon',
  'road-traffic-hit-targets',
  'road-traffic-lines',
  'road-traffic-dots',
  'road-traffic-selected-line',
] as const;

const MESSAGE_INTERACTIVE_LAYER_IDS = [
  'road-traffic-message-hit-targets',
  'road-traffic-message-point-hits',
  'road-traffic-message-icons',
  'road-traffic-message-selected-icon',
] as const;

export type RoadTrafficClickTarget =
  | { type: 'station'; station: RoadTrafficStation }
  | { type: 'message'; message: RoadTrafficMessage };

function emptyCollection() {
  return { type: 'FeatureCollection' as const, features: [] };
}

const congestionColor: ExpressionSpecification = [
  'match',
  ['get', 'congestion'],
  'free', TRAFFIC_CONGESTION_COLORS.free,
  'slow', TRAFFIC_CONGESTION_COLORS.slow,
  'heavy', TRAFFIC_CONGESTION_COLORS.heavy,
  'severe', TRAFFIC_CONGESTION_COLORS.severe,
  TRAFFIC_CONGESTION_COLORS.unknown,
];

const messageColor: ExpressionSpecification = [
  'match',
  ['get', 'kind'],
  'roadwork', MAP_COLORS.roadWork,
  MAP_COLORS.roadIncident,
];

async function addTrafficIcon(map: Map, imageId: string, Icon: LucideIcon, fill: string) {
  if (map.hasImage(imageId)) return;
  const renderedIcon = renderToStaticMarkup(createElement(Icon, {
    color: '#ffffff',
    size: 24,
    strokeWidth: 2.4,
  }));
  const svg = renderedIcon.replace(
    /(<svg[^>]*>)/,
    `$1<circle cx="12" cy="12" r="11.25" fill="${fill}"/>`,
  );
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Unable to load ${imageId}`));
  });
  if (!map.hasImage(imageId)) map.addImage(imageId, image, { pixelRatio: 2 });
}

function lineFeatures(station: RoadTrafficStation, network: RoadTrafficWay[] = []) {
  return ([1, 2] as const).flatMap((direction) => {
    const reading = direction === 1 ? station.direction1 : station.direction2;
    if (reading.speedKmh === undefined && reading.volumePerHour === undefined) return [];
    const volume = reading.volumePerHour ?? 0;
    return [{
      type: 'Feature' as const,
      id: Number.parseInt(`${station.id}${direction}`, 10) || undefined,
      geometry: {
        type: 'LineString' as const,
        coordinates: stationSegmentCoordinates(station, direction, network),
      },
      properties: {
        id: station.id,
        kind: 'station',
        name: station.name,
        direction,
        congestion: reading.congestion,
        volume,
        lineWidth: Math.min(7.5, 2.2 + volume / 420),
        lon: station.coordinates[0],
        lat: station.coordinates[1],
      },
    }];
  });
}

function pointFeature(station: RoadTrafficStation) {
  return {
    type: 'Feature' as const,
    id: Number.parseInt(station.id, 10) || undefined,
    geometry: { type: 'Point' as const, coordinates: station.coordinates },
    properties: {
      id: station.id,
      kind: 'station',
      name: station.name,
      congestion: stationCongestion(station),
      lon: station.coordinates[0],
      lat: station.coordinates[1],
    },
  };
}

function messageLineFeature(message: RoadTrafficMessage) {
  if (message.geometry.type === 'Point') return [];
  return [{
    type: 'Feature' as const,
    geometry: message.geometry,
    properties: {
      id: message.id,
      kind: message.kind,
      name: message.name,
      lon: message.coordinates[0],
      lat: message.coordinates[1],
    },
  }];
}

function messagePointFeature(message: RoadTrafficMessage) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: message.coordinates },
    properties: {
      id: message.id,
      kind: message.kind,
      name: message.name,
      icon: message.kind === 'roadwork' ? ROADWORK_ICON_ID : INCIDENT_ICON_ID,
      lon: message.coordinates[0],
      lat: message.coordinates[1],
    },
  };
}

export function roadTrafficFeatureAt(map: Map, point: Point) {
  const layers = ROAD_TRAFFIC_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
  if (!layers.length) return undefined;
  return map.queryRenderedFeatures(point, { layers })[0];
}

function selectionFromFeature(feature: MapGeoJSONFeature, point: Point, map: Map): RoadTrafficSelection | undefined {
  const properties = feature.properties ?? {};
  const id = typeof properties.id === 'string'
    ? properties.id
    : typeof properties.id === 'number'
      ? String(properties.id)
      : undefined;
  if (!id) return undefined;
  const lon = Number(properties.lon);
  const lat = Number(properties.lat);
  const coordinates = Number.isFinite(lon) && Number.isFinite(lat)
    ? [lon, lat] as [number, number]
    : feature.geometry.type === 'Point'
      ? [Number(feature.geometry.coordinates[0]), Number(feature.geometry.coordinates[1])] as [number, number]
      : feature.geometry.type === 'LineString'
        ? [
          (Number(feature.geometry.coordinates[0][0]) + Number(feature.geometry.coordinates[1][0])) / 2,
          (Number(feature.geometry.coordinates[0][1]) + Number(feature.geometry.coordinates[1][1])) / 2,
        ] as [number, number]
        : map.unproject(point).toArray() as [number, number];
  if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return undefined;
  return {
    id,
    name: typeof properties.name === 'string' && properties.name ? properties.name : id,
    coordinates,
  };
}

export class RoadTrafficLayer {
  private map: Map | null = null;
  private requestController: AbortController | null = null;
  private roadsController: AbortController | null = null;
  private selected: RoadTrafficSelection | null = null;
  private selectedMessageId: string | null = null;
  private stations = new globalThis.Map<string, RoadTrafficStation>();
  private messages = new globalThis.Map<string, RoadTrafficMessage>();
  private ways: RoadTrafficWay[] = [];
  private lastRoadsKey = '';
  private ready = false;
  private roadsMoveTimer = 0;
  private handleMoveEnd = () => {
    window.clearTimeout(this.roadsMoveTimer);
    this.roadsMoveTimer = window.setTimeout(() => {
      const map = this.map;
      if (!map || !this.ready) return;
      void this.syncViewport(map.getBounds(), map.getZoom());
    }, 280);
  };

  async install(
    map: Map,
    onSelect: (target: RoadTrafficClickTarget) => void,
    interactionBlocked: () => boolean = () => false,
  ) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    map.addSource(SELECTED_SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    map.addSource(MESSAGE_SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    map.addSource(MESSAGE_SELECTED_SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    await Promise.all([
      addTrafficIcon(map, ROADWORK_ICON_ID, Construction, MAP_COLORS.roadWork),
      addTrafficIcon(map, INCIDENT_ICON_ID, TriangleAlert, MAP_COLORS.roadIncident),
    ]);
    if (this.map !== map) return;
    const beforeLayerId = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    const dots: CircleLayerSpecification = {
      id: 'road-traffic-dots',
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      minzoom: 5,
      maxzoom: 11,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.2, 8, 5.2],
        'circle-color': congestionColor,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.1,
        'circle-opacity': 0.94,
      },
    };
    const casings: LineLayerSpecification = {
      id: 'road-traffic-casings',
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      minzoom: 7,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['+', ['coalesce', ['get', 'lineWidth'], 3], 2.4],
        'line-opacity': 0.9,
      },
    };
    const lines: LineLayerSpecification = {
      id: 'road-traffic-lines',
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      minzoom: 7,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': congestionColor,
        'line-width': ['coalesce', ['get', 'lineWidth'], 3],
        'line-opacity': 0.96,
      },
    };
    const hitTargets: LineLayerSpecification = {
      id: 'road-traffic-hit-targets',
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      minzoom: 7,
      paint: {
        'line-color': '#ffffff',
        'line-width': 22,
        'line-opacity': 0.01,
      },
    };
    const selectedHalo: LineLayerSpecification = {
      id: 'road-traffic-selected-halo',
      type: 'line',
      source: SELECTED_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 10,
        'line-opacity': 0.95,
      },
    };
    const selectedLine: LineLayerSpecification = {
      id: 'road-traffic-selected-line',
      type: 'line',
      source: SELECTED_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': congestionColor,
        'line-width': 5,
      },
    };
    const messageLines: LineLayerSpecification = {
      id: 'road-traffic-message-lines',
      type: 'line',
      source: MESSAGE_SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      minzoom: 6,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': messageColor,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 12, 4.2, 16, 6],
        'line-dasharray': [2, 1.4],
        'line-opacity': 0.95,
      },
    };
    const messageHits: LineLayerSpecification = {
      id: 'road-traffic-message-hit-targets',
      type: 'line',
      source: MESSAGE_SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      minzoom: 6,
      paint: {
        'line-color': '#ffffff',
        'line-width': 22,
        'line-opacity': 0.01,
      },
    };
    const messageDots: CircleLayerSpecification = {
      id: 'road-traffic-message-dots',
      type: 'circle',
      source: MESSAGE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      minzoom: 5,
      maxzoom: 8.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 8, 6],
        'circle-color': messageColor,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
        'circle-opacity': 0.96,
      },
    };
    const messagePointHits: CircleLayerSpecification = {
      id: 'road-traffic-message-point-hits',
      type: 'circle',
      source: MESSAGE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      minzoom: 5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 12, 16, 18],
        'circle-color': '#ffffff',
        'circle-opacity': 0.01,
      },
    };
    const messageIcons: SymbolLayerSpecification = {
      id: 'road-traffic-message-icons',
      type: 'symbol',
      source: MESSAGE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      minzoom: 8,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 1.12, 14, 1.4, 18, 1.6],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const messageSelectedLine: LineLayerSpecification = {
      id: 'road-traffic-message-selected-line',
      type: 'line',
      source: MESSAGE_SELECTED_SOURCE_ID,
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': messageColor,
        'line-width': 7,
        'line-opacity': 0.98,
      },
    };
    const messageSelectedHalo: CircleLayerSpecification = {
      id: 'road-traffic-message-selected-halo',
      type: 'circle',
      source: MESSAGE_SELECTED_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 12, 18, 20],
        'circle-color': '#ffffff',
        'circle-opacity': 0.98,
        'circle-stroke-color': messageColor,
        'circle-stroke-width': 3,
      },
    };
    const messageSelectedIcon: SymbolLayerSpecification = {
      id: 'road-traffic-message-selected-icon',
      type: 'symbol',
      source: MESSAGE_SELECTED_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 1.28, 14, 1.55, 18, 1.75],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };

    map.addLayer(dots, beforeLayerId);
    map.addLayer(casings, beforeLayerId);
    map.addLayer(lines, beforeLayerId);
    map.addLayer(hitTargets, beforeLayerId);
    map.addLayer(selectedHalo, beforeLayerId);
    map.addLayer(selectedLine, beforeLayerId);
    map.addLayer(messageLines, beforeLayerId);
    map.addLayer(messageHits, beforeLayerId);
    map.addLayer(messageDots, beforeLayerId);
    map.addLayer(messagePointHits, beforeLayerId);
    map.addLayer(messageIcons, beforeLayerId);
    map.addLayer(messageSelectedLine, beforeLayerId);
    map.addLayer(messageSelectedHalo, beforeLayerId);
    map.addLayer(messageSelectedIcon, beforeLayerId);
    this.ready = true;

    const selectFeature = (feature: MapGeoJSONFeature | undefined, point: Point) => {
      const selection = feature ? selectionFromFeature(feature, point, map) : undefined;
      if (!selection) return;
      const kind = typeof feature?.properties?.kind === 'string' ? feature.properties.kind : undefined;
      if (kind === 'roadwork' || kind === 'incident') {
        const message = this.messages.get(selection.id);
        if (!message) return;
        this.selectMessage(message);
        onSelect({ type: 'message', message });
        return;
      }
      const station = this.stations.get(selection.id);
      if (!station) return;
      this.selectStation(station);
      onSelect({ type: 'station', station });
    };
    map.on('click', (event) => {
      if (interactionBlocked()) return;
      const layers = ROAD_TRAFFIC_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
      if (!layers.length) return;
      const features = map.queryRenderedFeatures(event.point, { layers });
      const preferred = features.find((feature) => MESSAGE_INTERACTIVE_LAYER_IDS.includes(feature.layer.id as typeof MESSAGE_INTERACTIVE_LAYER_IDS[number]))
        ?? features[0];
      selectFeature(preferred, event.point);
    });
    ROAD_TRAFFIC_INTERACTIVE_LAYER_IDS.forEach((layerId) => {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('moveend', this.handleMoveEnd);
  }

  async update(options?: { bypassCache?: boolean }) {
    const map = this.map;
    if (!map || !this.ready) return;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    try {
      const [stationsResult, messagesResult] = await Promise.allSettled([
        fetchRoadTrafficStations(controller.signal, options),
        fetchRoadTrafficMessages(controller.signal, options),
      ]);
      if (this.requestController !== controller || this.map !== map) return;
      if (stationsResult.status === 'rejected' && messagesResult.status === 'rejected') {
        throw stationsResult.reason;
      }
      if (stationsResult.status === 'fulfilled') {
        const stations = stationsResult.value;
        this.stations = new globalThis.Map(stations.map((station) => [station.id, station]));
        this.applyGeometry();
        if (this.selected) {
          const next = this.stations.get(this.selected.id);
          if (next) this.selectStation(next);
        }
        void this.syncViewport(map.getBounds(), map.getZoom());
      }
      if (messagesResult.status === 'fulfilled') {
        const messages = messagesResult.value;
        this.messages = new globalThis.Map(messages.map((message) => [message.id, message]));
        const source = map.getSource(MESSAGE_SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData({
          type: 'FeatureCollection',
          features: messages.flatMap((message) => [...messageLineFeature(message), messagePointFeature(message)]),
        });
        if (this.selectedMessageId) {
          const next = this.messages.get(this.selectedMessageId);
          if (next) this.selectMessage(next);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }
  }

  private network() {
    return this.ways.length ? mergeRoadNetwork(this.ways) : [];
  }

  private applyGeometry() {
    const map = this.map;
    if (!map || !this.ready) return;
    const network = this.network();
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: [...this.stations.values()].flatMap((station) => [pointFeature(station), ...lineFeatures(station, network)]),
    });
  }

  async syncViewport(bounds: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }, zoom: number) {
    const map = this.map;
    if (!map || !this.ready) return;
    if (!this.stations.size) return;
    if (map.getLayoutProperty('road-traffic-lines', 'visibility') === 'none') return;
    const pad = 0.012;
    const bbox: [number, number, number, number] = [
      bounds.getWest() - pad,
      bounds.getSouth() - pad,
      bounds.getEast() + pad,
      bounds.getNorth() + pad,
    ];
    const key = trafficRoadsRequestKey(bbox, zoom);
    if (key === this.lastRoadsKey) return;
    this.lastRoadsKey = key;
    this.roadsController?.abort();
    const controller = new AbortController();
    this.roadsController = controller;
    try {
      const ways = zoom < TRAFFIC_ROAD_SNAP_MIN_ZOOM ? [] : await fetchViewportRoads(bbox, controller.signal);
      if (this.roadsController !== controller || this.map !== map) return;
      this.ways = ways;
      this.applyGeometry();
      if (this.selected) {
        const next = this.stations.get(this.selected.id);
        if (next) this.selectStation(next);
      }
    } catch {
      if (controller.signal.aborted) return;
      if (this.lastRoadsKey === key) this.lastRoadsKey = '';
      this.ways = [];
      this.applyGeometry();
    }
  }

  selectStation(station: RoadTrafficStation) {
    this.selected = station;
    this.selectedMessageId = null;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData({
      type: 'FeatureCollection',
      features: lineFeatures(station, this.network()),
    });
    const messageSelected = this.map?.getSource(MESSAGE_SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    messageSelected?.setData(emptyCollection());
  }

  selectMessage(message: RoadTrafficMessage) {
    this.selectedMessageId = message.id;
    this.selected = null;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData(emptyCollection());
    const messageSelected = this.map?.getSource(MESSAGE_SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    messageSelected?.setData({
      type: 'FeatureCollection',
      features: [...messageLineFeature(message), messagePointFeature(message)],
    });
  }

  clearSelection() {
    this.selected = null;
    this.selectedMessageId = null;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData(emptyCollection());
    const messageSelected = this.map?.getSource(MESSAGE_SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    messageSelected?.setData(emptyCollection());
  }

  selectedStation() {
    return this.selected;
  }

  stationById(id: string) {
    return this.stations.get(id);
  }

  dispose() {
    window.clearTimeout(this.roadsMoveTimer);
    this.roadsMoveTimer = 0;
    this.map?.off('moveend', this.handleMoveEnd);
    this.requestController?.abort();
    this.requestController = null;
    this.roadsController?.abort();
    this.roadsController = null;
    this.map = null;
    this.selected = null;
    this.selectedMessageId = null;
    this.stations.clear();
    this.messages.clear();
    this.ways = [];
    this.lastRoadsKey = '';
    this.ready = false;
  }
}
