import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  Map,
  MapGeoJSONFeature,
  Point,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { PlugZap } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAP_COLORS } from './MapPalette';
import {
  fetchChargingStations,
  type ChargingStation,
  type ChargingStationSelection,
  type ChargingStatusKind,
} from './ChargingStations';

const SOURCE_ID = 'charging-stations';
const SELECTED_SOURCE_ID = 'charging-stations-selected';
const MIN_ZOOM = 9;

const STATUS_COLORS: Record<ChargingStatusKind, string> = {
  operational: MAP_COLORS.chargingOperational,
  limited: MAP_COLORS.chargingLimited,
  unavailable: MAP_COLORS.chargingUnavailable,
  unknown: MAP_COLORS.chargingUnknown,
};

function iconId(kind: ChargingStatusKind) {
  return `charging-station-icon-${kind}`;
}

export const CHARGING_STATION_LAYER_IDS = [
  'charging-stations-dots',
  'charging-stations-hit-targets',
  'charging-stations-selected-halo',
  'charging-stations-icons',
  'charging-stations-selected-icon',
  'charging-stations-labels',
] as const;

export const CHARGING_STATION_INTERACTIVE_LAYER_IDS = [
  'charging-stations-hit-targets',
  'charging-stations-icons',
  'charging-stations-labels',
  'charging-stations-selected-icon',
] as const;

function emptyCollection() {
  return { type: 'FeatureCollection' as const, features: [] };
}

function toFeature(station: ChargingStation) {
  return {
    type: 'Feature' as const,
    id: Number.parseInt(station.id, 10) || undefined,
    geometry: { type: 'Point' as const, coordinates: station.coordinates },
    properties: {
      id: station.id,
      name: station.name,
      operator: station.operator ?? '',
      statusKind: station.statusKind,
      icon: iconId(station.statusKind),
    },
  };
}

async function addStatusIcon(map: Map, kind: ChargingStatusKind) {
  const imageId = iconId(kind);
  if (map.hasImage(imageId)) return;
  const renderedIcon = renderToStaticMarkup(createElement(PlugZap, {
    color: '#ffffff',
    size: 24,
    strokeWidth: 2.4,
  }));
  const svg = renderedIcon.replace(
    /(<svg[^>]*>)/,
    `$1<circle cx="12" cy="12" r="11.25" fill="${STATUS_COLORS[kind]}"/>`,
  );
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to load charging station icon'));
  });
  if (!map.hasImage(imageId)) map.addImage(imageId, image, { pixelRatio: 2 });
}

export function chargingStationFeatureAt(map: Map, point: Point) {
  const layers = CHARGING_STATION_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
  if (!layers.length) return undefined;
  return map.queryRenderedFeatures(point, { layers })[0];
}

function selectionFromFeature(feature: MapGeoJSONFeature, point: Point, map: Map): ChargingStationSelection | undefined {
  const properties = feature.properties ?? {};
  const id = typeof properties.id === 'string'
    ? properties.id
    : typeof properties.id === 'number'
      ? String(properties.id)
      : typeof feature.id === 'number' || typeof feature.id === 'string'
        ? String(feature.id)
        : undefined;
  if (!id) return undefined;
  const coordinates = feature.geometry.type === 'Point'
    ? [Number(feature.geometry.coordinates[0]), Number(feature.geometry.coordinates[1])] as [number, number]
    : map.unproject(point).toArray() as [number, number];
  if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return undefined;
  return {
    id,
    name: typeof properties.name === 'string' && properties.name ? properties.name : 'Charging station',
    coordinates,
  };
}

export class ChargingStationsLayer {
  private map: Map | null = null;
  private requestController: AbortController | null = null;
  private selected: ChargingStationSelection | null = null;
  private stations = new globalThis.Map<string, ChargingStation>();
  private ready = false;
  private lastRequestKey = '';

  async install(
    map: Map,
    onStationClick: (station: ChargingStation) => void,
    interactionBlocked: () => boolean = () => false,
  ) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    map.addSource(SELECTED_SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    await Promise.all((Object.keys(STATUS_COLORS) as ChargingStatusKind[]).map((kind) => addStatusIcon(map, kind)));
    if (this.map !== map) return;

    const beforeLayerId = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    const statusColor: ExpressionSpecification = [
      'match',
      ['get', 'statusKind'],
      'operational', STATUS_COLORS.operational,
      'limited', STATUS_COLORS.limited,
      'unavailable', STATUS_COLORS.unavailable,
      STATUS_COLORS.unknown,
    ];
    const dots: CircleLayerSpecification = {
      id: 'charging-stations-dots',
      type: 'circle',
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      maxzoom: 11,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.4, 11, 5],
        'circle-color': statusColor,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
        'circle-opacity': 0.92,
      },
    };
    const hitTargets: CircleLayerSpecification = {
      id: 'charging-stations-hit-targets',
      type: 'circle',
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 18, 18],
        'circle-color': '#ffffff',
        'circle-opacity': 0.01,
      },
    };
    const selectedHalo: CircleLayerSpecification = {
      id: 'charging-stations-selected-halo',
      type: 'circle',
      source: SELECTED_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 18, 20],
        'circle-color': '#ffffff',
        'circle-opacity': 0.98,
        'circle-stroke-color': MAP_COLORS.chargingStation,
        'circle-stroke-width': 3,
      },
    };
    const icons: SymbolLayerSpecification = {
      id: 'charging-stations-icons',
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 10,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 1.15, 14, 1.45, 18, 1.7],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const selectedIcon: SymbolLayerSpecification = {
      id: 'charging-stations-selected-icon',
      type: 'symbol',
      source: SELECTED_SOURCE_ID,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 1.28, 14, 1.58, 18, 1.82],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const labels: SymbolLayerSpecification = {
      id: 'charging-stations-labels',
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 13,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular', 'Open Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
        'text-offset': [0, 1.15],
        'text-anchor': 'top',
        'text-padding': 6,
        'text-max-width': 12,
        'text-optional': true,
      },
      paint: {
        'text-color': '#385d5d',
        'text-halo-color': '#f7f8f2',
        'text-halo-width': 1.5,
      },
    };

    map.addLayer(dots, beforeLayerId);
    map.addLayer(hitTargets, beforeLayerId);
    map.addLayer(selectedHalo, beforeLayerId);
    map.addLayer(icons, beforeLayerId);
    map.addLayer(selectedIcon, beforeLayerId);
    map.addLayer(labels, beforeLayerId);
    this.ready = true;

    const selectFeature = (feature: MapGeoJSONFeature | undefined, point: Point) => {
      const selection = feature ? selectionFromFeature(feature, point, map) : undefined;
      if (!selection) return;
      const station = this.stations.get(selection.id) ?? {
        ...selection,
        status: 'Unknown',
        statusKind: 'unknown' as const,
        connectors: [],
      };
      this.selectStation(station);
      onStationClick(station);
    };
    map.on('click', (event) => {
      if (interactionBlocked()) return;
      const layers = CHARGING_STATION_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
      if (!layers.length) return;
      selectFeature(map.queryRenderedFeatures(event.point, { layers })[0], event.point);
    });
    CHARGING_STATION_INTERACTIVE_LAYER_IDS.forEach((layerId) => {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });
  }

  async update(bounds: { getNorth(): number; getSouth(): number; getWest(): number; getEast(): number }, zoom: number) {
    const map = this.map;
    if (!map || !this.ready) return;
    if (zoom < MIN_ZOOM) {
      this.lastRequestKey = '';
      this.stations.clear();
      (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(emptyCollection());
      return;
    }
    const zoomBucket = Math.max(MIN_ZOOM, Math.floor(zoom));
    const key = [zoomBucket, bounds.getSouth().toFixed(3), bounds.getWest().toFixed(3), bounds.getNorth().toFixed(3), bounds.getEast().toFixed(3)].join(':');
    if (key === this.lastRequestKey) return;
    this.lastRequestKey = key;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    try {
      const stations = await fetchChargingStations(bounds, zoom, controller.signal);
      if (this.requestController !== controller || this.map !== map) return;
      this.stations = new globalThis.Map(stations.map((station) => [station.id, station]));
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData({
        type: 'FeatureCollection',
        features: stations.map(toFeature),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (this.lastRequestKey === key) this.lastRequestKey = '';
      throw error;
    }
  }

  selectStation(station: ChargingStationSelection & { statusKind?: ChargingStatusKind }) {
    this.selected = station;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    const statusKind = station.statusKind ?? this.stations.get(station.id)?.statusKind ?? 'unknown';
    selectedSource?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: station.coordinates },
        properties: { id: station.id, name: station.name, icon: iconId(statusKind), statusKind },
      }],
    });
  }

  clearSelection() {
    this.selected = null;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData(emptyCollection());
  }

  selectedStation() {
    return this.selected;
  }

  stationById(id: string) {
    return this.stations.get(id);
  }

  dispose() {
    this.requestController?.abort();
    this.requestController = null;
    this.map = null;
    this.selected = null;
    this.stations.clear();
    this.ready = false;
    this.lastRequestKey = '';
  }
}
