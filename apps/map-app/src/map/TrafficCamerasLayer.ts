import type {
  CircleLayerSpecification,
  GeoJSONSource,
  Map,
  MapGeoJSONFeature,
  Point,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { Camera } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAP_COLORS } from './MapPalette';
import {
  fetchTrafficCameraStations,
  type TrafficCameraSelection,
  type TrafficCameraStation,
} from './TrafficCameras';

const SOURCE_ID = 'traffic-cameras';
const SELECTED_SOURCE_ID = 'traffic-cameras-selected';
const ICON_ID = 'traffic-camera-icon';

export const TRAFFIC_CAMERA_LAYER_IDS = [
  'traffic-cameras-dots',
  'traffic-cameras-hit-targets',
  'traffic-cameras-selected-halo',
  'traffic-cameras-icons',
  'traffic-cameras-selected-icon',
  'traffic-cameras-labels',
] as const;

export const TRAFFIC_CAMERA_INTERACTIVE_LAYER_IDS = [
  'traffic-cameras-hit-targets',
  'traffic-cameras-icons',
  'traffic-cameras-labels',
  'traffic-cameras-selected-icon',
] as const;

function emptyCollection() {
  return { type: 'FeatureCollection' as const, features: [] };
}

function toFeature(station: TrafficCameraStation) {
  return {
    type: 'Feature' as const,
    id: station.id,
    geometry: { type: 'Point' as const, coordinates: station.coordinates },
    properties: {
      id: station.id,
      name: station.name,
      municipality: station.municipality ?? '',
    },
  };
}

async function addCameraIcon(map: Map) {
  if (map.hasImage(ICON_ID)) return;
  const renderedIcon = renderToStaticMarkup(createElement(Camera, {
    color: '#ffffff',
    size: 24,
    strokeWidth: 2.4,
  }));
  const svg = renderedIcon.replace(
    /(<svg[^>]*>)/,
    `$1<circle cx="12" cy="12" r="11.25" fill="${MAP_COLORS.trafficCamera}"/>`,
  );
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to load traffic camera icon'));
  });
  if (!map.hasImage(ICON_ID)) map.addImage(ICON_ID, image, { pixelRatio: 2 });
}

export function trafficCameraFeatureAt(map: Map, point: Point) {
  const layers = TRAFFIC_CAMERA_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
  if (!layers.length) return undefined;
  return map.queryRenderedFeatures(point, { layers })[0];
}

function selectionFromFeature(feature: MapGeoJSONFeature, point: Point, map: Map): TrafficCameraSelection | undefined {
  const properties = feature.properties ?? {};
  const id = typeof properties.id === 'string' ? properties.id : typeof feature.id === 'string' ? feature.id : undefined;
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

export class TrafficCamerasLayer {
  private map: Map | null = null;
  private requestController: AbortController | null = null;
  private selected: TrafficCameraSelection | null = null;
  private ready = false;

  async install(
    map: Map,
    onCameraClick: (camera: TrafficCameraSelection) => void,
    interactionBlocked: () => boolean = () => false,
  ) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    map.addSource(SELECTED_SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    await addCameraIcon(map);
    if (this.map !== map) return;

    const beforeLayerId = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    const dots: CircleLayerSpecification = {
      id: 'traffic-cameras-dots',
      type: 'circle',
      source: SOURCE_ID,
      minzoom: 5,
      maxzoom: 8,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 5],
        'circle-color': MAP_COLORS.trafficCamera,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
        'circle-opacity': 0.92,
      },
    };
    const hitTargets: CircleLayerSpecification = {
      id: 'traffic-cameras-hit-targets',
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
      id: 'traffic-cameras-selected-halo',
      type: 'circle',
      source: SELECTED_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 12, 18, 20],
        'circle-color': '#ffffff',
        'circle-opacity': 0.98,
        'circle-stroke-color': MAP_COLORS.trafficCamera,
        'circle-stroke-width': 3,
      },
    };
    const icons: SymbolLayerSpecification = {
      id: 'traffic-cameras-icons',
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 7,
      layout: {
        'icon-image': ICON_ID,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 1.15, 14, 1.45, 18, 1.7],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const selectedIcon: SymbolLayerSpecification = {
      id: 'traffic-cameras-selected-icon',
      type: 'symbol',
      source: SELECTED_SOURCE_ID,
      layout: {
        'icon-image': ICON_ID,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 1.28, 14, 1.58, 18, 1.82],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const labels: SymbolLayerSpecification = {
      id: 'traffic-cameras-labels',
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 10,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular', 'Open Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 12],
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
      this.selectCamera(selection);
      onCameraClick(selection);
    };
    map.on('click', (event) => {
      if (interactionBlocked()) return;
      const layers = TRAFFIC_CAMERA_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
      if (!layers.length) return;
      selectFeature(map.queryRenderedFeatures(event.point, { layers })[0], event.point);
    });
    TRAFFIC_CAMERA_INTERACTIVE_LAYER_IDS.forEach((layerId) => {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });
  }

  async update() {
    const map = this.map;
    if (!map || !this.ready) return;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    try {
      const stations = await fetchTrafficCameraStations(controller.signal);
      if (this.requestController !== controller || this.map !== map) return;
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

  selectCamera(camera: TrafficCameraSelection) {
    this.selected = camera;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: camera.coordinates },
        properties: { id: camera.id, name: camera.name },
      }],
    });
  }

  clearSelection() {
    this.selected = null;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData(emptyCollection());
  }

  selectedCamera() {
    return this.selected;
  }

  dispose() {
    this.requestController?.abort();
    this.requestController = null;
    this.map = null;
    this.selected = null;
    this.ready = false;
  }
}
