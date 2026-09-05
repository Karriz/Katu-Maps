import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  Map,
  MapGeoJSONFeature,
  Point,
} from 'maplibre-gl';
import {
  fetchRoadTrafficStations,
  stationCongestion,
  trafficSegmentCoordinates,
  TRAFFIC_CONGESTION_COLORS,
  type RoadTrafficSelection,
  type RoadTrafficStation,
} from './RoadTraffic';

const SOURCE_ID = 'road-traffic';
const SELECTED_SOURCE_ID = 'road-traffic-selected';

export const ROAD_TRAFFIC_LAYER_IDS = [
  'road-traffic-dots',
  'road-traffic-casings',
  'road-traffic-lines',
  'road-traffic-hit-targets',
  'road-traffic-selected-halo',
  'road-traffic-selected-line',
] as const;

export const ROAD_TRAFFIC_INTERACTIVE_LAYER_IDS = [
  'road-traffic-hit-targets',
  'road-traffic-lines',
  'road-traffic-dots',
  'road-traffic-selected-line',
] as const;

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

function lineFeatures(station: RoadTrafficStation) {
  return ([1, 2] as const).flatMap((direction) => {
    const reading = direction === 1 ? station.direction1 : station.direction2;
    if (reading.speedKmh === undefined && reading.volumePerHour === undefined) return [];
    const volume = reading.volumePerHour ?? 0;
    return [{
      type: 'Feature' as const,
      id: Number.parseInt(`${station.id}${direction}`, 10) || undefined,
      geometry: {
        type: 'LineString' as const,
        coordinates: trafficSegmentCoordinates(station.coordinates[0], station.coordinates[1], station.bearing, direction),
      },
      properties: {
        id: station.id,
        name: station.name,
        direction,
        congestion: reading.congestion,
        volume,
        lineWidth: Math.min(7.5, 2.2 + volume / 420),
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
      name: station.name,
      congestion: stationCongestion(station),
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
  const coordinates = feature.geometry.type === 'Point'
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
  private selected: RoadTrafficSelection | null = null;
  private stations = new globalThis.Map<string, RoadTrafficStation>();
  private ready = false;

  async install(
    map: Map,
    onStationClick: (station: RoadTrafficStation) => void,
    interactionBlocked: () => boolean = () => false,
  ) {
    this.map = map;
    map.addSource(SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    map.addSource(SELECTED_SOURCE_ID, { type: 'geojson', data: emptyCollection() });
    const beforeLayerId = map.getLayer('global-poi-labels') ? 'global-poi-labels' : undefined;
    const dots: CircleLayerSpecification = {
      id: 'road-traffic-dots',
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      minzoom: 5,
      maxzoom: 8.5,
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
        'line-width': 16,
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

    map.addLayer(dots, beforeLayerId);
    map.addLayer(casings, beforeLayerId);
    map.addLayer(lines, beforeLayerId);
    map.addLayer(hitTargets, beforeLayerId);
    map.addLayer(selectedHalo, beforeLayerId);
    map.addLayer(selectedLine, beforeLayerId);
    this.ready = true;

    const selectFeature = (feature: MapGeoJSONFeature | undefined, point: Point) => {
      const selection = feature ? selectionFromFeature(feature, point, map) : undefined;
      if (!selection) return;
      const station = this.stations.get(selection.id);
      if (!station) return;
      this.selectStation(station);
      onStationClick(station);
    };
    map.on('click', (event) => {
      if (interactionBlocked()) return;
      const layers = ROAD_TRAFFIC_INTERACTIVE_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
      if (!layers.length) return;
      selectFeature(map.queryRenderedFeatures(event.point, { layers })[0], event.point);
    });
    ROAD_TRAFFIC_INTERACTIVE_LAYER_IDS.forEach((layerId) => {
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
      const stations = await fetchRoadTrafficStations(controller.signal, options);
      if (this.requestController !== controller || this.map !== map) return;
      this.stations = new globalThis.Map(stations.map((station) => [station.id, station]));
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData({
        type: 'FeatureCollection',
        features: stations.flatMap((station) => [pointFeature(station), ...lineFeatures(station)]),
      });
      if (this.selected) {
        const next = this.stations.get(this.selected.id);
        if (next) this.selectStation(next);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }
  }

  selectStation(station: RoadTrafficStation) {
    this.selected = station;
    const selectedSource = this.map?.getSource(SELECTED_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData({
      type: 'FeatureCollection',
      features: lineFeatures(station),
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
