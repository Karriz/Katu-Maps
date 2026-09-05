import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  Map,
  MapGeoJSONFeature,
  Point,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { Thermometer } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAP_COLORS } from './MapPalette';
import {
  fetchRoadWeatherStations,
  formatTemperature,
  type RoadWeatherSelection,
  type RoadWeatherStation,
} from './RoadWeather';

const SOURCE_ID = 'road-weather';
const SELECTED_SOURCE_ID = 'road-weather-selected';
const ICON_ID = 'road-weather-icon';
const ICE_ICON_ID = 'road-weather-ice-icon';

export const ROAD_WEATHER_LAYER_IDS = [
  'road-weather-dots',
  'road-weather-hit-targets',
  'road-weather-selected-halo',
  'road-weather-icons',
  'road-weather-selected-icon',
  'road-weather-labels',
] as const;

export const ROAD_WEATHER_INTERACTIVE_LAYER_IDS = [
  'road-weather-hit-targets',
  'road-weather-icons',
  'road-weather-labels',
  'road-weather-selected-icon',
] as const;

function emptyCollection() {
  return { type: 'FeatureCollection' as const, features: [] };
}

const temperatureColor: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'airTemperature'], 10],
  -20, '#1e3a8a',
  -5, '#2563eb',
  0, '#38bdf8',
  10, '#4ade80',
  20, '#facc15',
  30, '#f97316',
  38, '#dc2626',
];

function toFeature(station: RoadWeatherStation) {
  return {
    type: 'Feature' as const,
    id: Number.parseInt(station.id, 10) || undefined,
    geometry: { type: 'Point' as const, coordinates: station.coordinates },
    properties: {
      id: station.id,
      name: station.name,
      municipality: station.municipality ?? '',
      airTemperature: station.airTemperature ?? null,
      temperatureLabel: formatTemperature(station.airTemperature) ?? station.name,
      icy: station.icy ? 1 : 0,
      icon: station.icy ? ICE_ICON_ID : ICON_ID,
    },
  };
}

async function addWeatherIcon(map: Map, imageId: string, fill: string) {
  if (map.hasImage(imageId)) return;
  const renderedIcon = renderToStaticMarkup(createElement(Thermometer, {
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
    image.onerror = () => reject(new Error('Unable to load road weather icon'));
  });
  if (!map.hasImage(imageId)) map.addImage(imageId, image, { pixelRatio: 2 });
}

export function roadWeatherFeatureAt(map: Map, point: Point) {
  const layers = ROAD_WEATHER_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
  if (!layers.length) return undefined;
  return map.queryRenderedFeatures(point, { layers })[0];
}

function selectionFromFeature(feature: MapGeoJSONFeature, point: Point, map: Map): RoadWeatherSelection | undefined {
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
    name: typeof properties.name === 'string' && properties.name ? properties.name : id,
    coordinates,
  };
}

export class RoadWeatherLayer {
  private map: Map | null = null;
  private requestController: AbortController | null = null;
  private selected: RoadWeatherSelection | null = null;
  private stations = new globalThis.Map<string, RoadWeatherStation>();
  private ready = false;

  async install(
    map: Map,
    onStationClick: (station: RoadWeatherStation) => void,
    interactionBlocked: () => boolean = () => false,
  ) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    map.addSource(SELECTED_SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    await Promise.all([
      addWeatherIcon(map, ICON_ID, MAP_COLORS.roadWeather),
      addWeatherIcon(map, ICE_ICON_ID, MAP_COLORS.roadWeatherIce),
    ]);
    if (this.map !== map) return;

    const beforeLayerId = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    const dots: CircleLayerSpecification = {
      id: 'road-weather-dots',
      type: 'circle',
      source: SOURCE_ID,
      minzoom: 5,
      maxzoom: 8,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 5],
        'circle-color': temperatureColor,
        'circle-stroke-color': ['case', ['==', ['get', 'icy'], 1], '#e0f2fe', '#ffffff'],
        'circle-stroke-width': ['case', ['==', ['get', 'icy'], 1], 2.2, 1.2],
        'circle-opacity': 0.92,
      },
    };
    const hitTargets: CircleLayerSpecification = {
      id: 'road-weather-hit-targets',
      type: 'circle',
      source: SOURCE_ID,
      minzoom: 5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 10, 18, 18],
        'circle-color': '#ffffff',
        'circle-opacity': 0.01,
      },
    };
    const selectedHalo: CircleLayerSpecification = {
      id: 'road-weather-selected-halo',
      type: 'circle',
      source: SELECTED_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 12, 18, 20],
        'circle-color': '#ffffff',
        'circle-opacity': 0.98,
        'circle-stroke-color': MAP_COLORS.roadWeather,
        'circle-stroke-width': 3,
      },
    };
    const icons: SymbolLayerSpecification = {
      id: 'road-weather-icons',
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 7,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 1.15, 14, 1.45, 18, 1.7],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const selectedIcon: SymbolLayerSpecification = {
      id: 'road-weather-selected-icon',
      type: 'symbol',
      source: SELECTED_SOURCE_ID,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 1.28, 14, 1.58, 18, 1.82],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const labels: SymbolLayerSpecification = {
      id: 'road-weather-labels',
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 9,
      layout: {
        'text-field': ['get', 'temperatureLabel'],
        'text-font': ['Noto Sans Regular', 'Open Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 16, 12],
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
      const station = this.stations.get(selection.id) ?? { ...selection, collectionStatus: 'GATHERING', icy: false };
      this.selectStation(station);
      onStationClick(station);
    };
    map.on('click', (event) => {
      if (interactionBlocked()) return;
      const layers = ROAD_WEATHER_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
      if (!layers.length) return;
      selectFeature(map.queryRenderedFeatures(event.point, { layers })[0], event.point);
    });
    ROAD_WEATHER_INTERACTIVE_LAYER_IDS.forEach((layerId) => {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });
  }

  async update(options?: { bypassCache?: boolean }) {
    const map = this.map;
    if (!map || !this.ready) return;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    try {
      const stations = await fetchRoadWeatherStations(controller.signal, options);
      if (this.requestController !== controller || this.map !== map) return;
      this.stations = new globalThis.Map(stations.map((station) => [station.id, station]));
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData({
        type: 'FeatureCollection',
        features: stations.map(toFeature),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }
  }

  selectStation(station: RoadWeatherSelection & { icy?: boolean }) {
    this.selected = station;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    const icy = station.icy ?? this.stations.get(station.id)?.icy ?? false;
    selectedSource?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: station.coordinates },
        properties: { id: station.id, name: station.name, icon: icy ? ICE_ICON_ID : ICON_ID, icy: icy ? 1 : 0 },
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
  }
}
