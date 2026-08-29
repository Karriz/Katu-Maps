import type {
  CircleLayerSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  Map,
  MapGeoJSONFeature,
  Point,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { BusFront, TrainFront, TrainFrontTunnel, TramFront } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAP_COLORS } from './MapPalette';
import { rasterizeMapIcon } from './rasterizeMapIcon';
import {
  fetchTransitStops,
  fetchTransitTrip,
  type TransitProviderId,
  type TransitStop,
  type TransitStopSelection,
  type TransitTripLeg,
  type TransitTripPlace,
} from './transit';
import { resolveSelectedTripResult, tripIsDisplayableAt } from './transit/tripTimeline';

const TRANSIT_SOURCE_ID = 'transit-stops';
const SELECTED_STOP_SOURCE_ID = 'transit-selected-stop';
const SELECTED_ROUTES_SOURCE_ID = 'transit-selected-routes';
const ESTIMATED_VEHICLE_SOURCE_ID = 'transit-estimated-vehicle';
const MIN_TRANSIT_ZOOM = 9;

type TransitFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    name: string;
    stopId: string;
    parentId?: string;
    importance: number;
    mode: string;
    provider: TransitProviderId;
  };
};

type EstimatedTripLeg = {
  coordinates: [number, number][];
  cumulativeDistances: number[];
  anchors: Array<{ distance: number; time: number; stopId?: string }>;
  realTime: boolean;
};

type SelectedTrip = {
  tripId: string;
  mode: string;
  color: string;
  showRoute: boolean;
  provider: TransitProviderId;
  serviceDate?: string;
  boardingStop?: { stopId: string; coordinates: [number, number]; departureTime: number; scheduledDeparture?: string };
};

export type TransitVehiclePose = {
  mode: string;
  color: string;
  realTime: boolean;
  parts: Array<{
    coordinates: [number, number];
    heading: number;
  }>;
};

type RouteLineFeature = {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { color: string };
};

export type { TransitStopSelection } from './transit';

const TRANSIT_ICON_IDS = {
  bus: 'transit-bus-icon-v2',
  tram: 'transit-tram-icon-v2',
  metro: 'transit-metro-icon-v2',
  train: 'transit-train-icon-v2',
  vehicle: 'transit-estimated-vehicle-icon-v2',
} as const;

const METRO_COLOR = '#e87524';
export const TRANSIT_ICON_PIXEL_RATIO = 2;
export const TRANSIT_ICON_RASTER_SIZE = 64;
export const TRANSIT_ICON_CONTENT_INSET = 8;

export function transitIconSvg(icon: typeof BusFront, color?: string) {
  const renderedIcon = renderToStaticMarkup(createElement(icon, {
    color: '#ffffff',
    size: 48,
    strokeWidth: 2.5,
  }));
  return color
    ? renderedIcon.replace(
      /(<svg[^>]*>)/,
      `$1<circle cx="12" cy="12" r="12" fill="${color}"/>`,
    )
    : renderedIcon;
}

async function addTransitIcon(
  map: Map,
  id: string,
  icon: typeof BusFront,
  color?: string,
) {
  if (map.hasImage(id)) return;
  const svg = transitIconSvg(icon, color);
  const image = await rasterizeMapIcon(svg, {
    bitmapSize: TRANSIT_ICON_RASTER_SIZE,
    contentInset: TRANSIT_ICON_CONTENT_INSET,
  });
  if (!map.hasImage(id)) {
    map.addImage(id, image, { pixelRatio: TRANSIT_ICON_PIXEL_RATIO });
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toFeature(stop: TransitStop): TransitFeature {
  return {
    type: 'Feature',
    id: `${stop.provider}:${stop.stopId}`,
    geometry: { type: 'Point', coordinates: stop.coordinates },
    properties: {
      name: stop.name,
      stopId: stop.stopId,
      parentId: stop.parentId,
      importance: stop.importance,
      mode: stop.mode,
      provider: stop.provider,
    },
  };
}

function isRailMode(mode: string) {
  return [
    'RAIL', 'SUBURBAN', 'SUBWAY', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL',
  ].includes(mode);
}

function stationNameKey(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
}

function distanceInMeters(first: [number, number], second: [number, number]) {
  const radians = Math.PI / 180;
  const latitudeDelta = (second[1] - first[1]) * radians;
  const longitudeDelta = (second[0] - first[0]) * radians;
  const firstLatitude = first[1] * radians;
  const secondLatitude = second[1] * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

// Digitransit can expose the same physical station through multiple feeds.
// The VR_bussit feed contains coach stops, while digitraffic contains the
// railway timetable data used by the departures query. Prefer the latter when
// choosing the representative for a visually merged station.
function railFeedPriority(feature: TransitFeature) {
  if (feature.properties.provider !== 'digitransit') return 0;
  const stopId = feature.properties.stopId;
  if (stopId.startsWith('digitraffic:')) return 2;
  if (stopId.startsWith('VR_bussit:')) return 1;
  return 1;
}

function groupRailPlatforms(features: TransitFeature[]) {
  const groupedByParent = new globalThis.Map<string, TransitFeature>();
  features.forEach((feature) => {
    const parentId = feature.properties.parentId;
    const key = isRailMode(feature.properties.mode)
      ? `rail-station:${parentId ?? feature.properties.stopId}`
      : `stop:${feature.properties.stopId}`;
    const existing = groupedByParent.get(key);
    const existingIsPlatform = Boolean(existing?.properties.parentId);
    const candidateIsStation = !parentId;
    if (
      !existing
      || (candidateIsStation && existingIsPlatform)
      || (!candidateIsStation && !existingIsPlatform && feature.properties.importance > existing.properties.importance)
    ) {
      groupedByParent.set(key, {
        ...feature,
        properties: {
          ...feature.properties,
          stopId: parentId ?? feature.properties.stopId,
        },
      });
    }
  });

  // The same physical railway station can arrive from more than one national
  // feed, each with a different parent ID. Merge only rail stations whose
  // names match and whose representative points are within the same complex.
  const result: TransitFeature[] = [];
  groupedByParent.forEach((feature) => {
    if (!isRailMode(feature.properties.mode)) {
      result.push(feature);
      return;
    }
    const duplicateIndex = result.findIndex((candidate) => (
      isRailMode(candidate.properties.mode)
      && stationNameKey(candidate.properties.name) === stationNameKey(feature.properties.name)
      && distanceInMeters(candidate.geometry.coordinates, feature.geometry.coordinates) <= 250
    ));
    if (duplicateIndex === -1) {
      result.push(feature);
    } else {
      const existing = result[duplicateIndex];
      const featurePriority = railFeedPriority(feature);
      const existingPriority = railFeedPriority(existing);
      if (
        featurePriority > existingPriority
        || (featurePriority === existingPriority
          && feature.properties.importance > existing.properties.importance)
      ) {
        result[duplicateIndex] = feature;
      }
    }
  });
  return result;
}

function emptyCollection() {
  return { type: 'FeatureCollection' as const, features: [] as TransitFeature[] };
}

function emptyRouteCollection() {
  return { type: 'FeatureCollection' as const, features: [] as RouteLineFeature[] };
}

function routeColor(value: unknown, fallback = '#8554c7') {
  if (typeof value !== 'string') return fallback;
  const color = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function stopColor(mode: string) {
  if (mode === 'TRAM') return '#8554c7';
  if (mode === 'BUS') return MAP_COLORS.transitBlue;
  if (mode === 'SUBWAY') return METRO_COLOR;
  return '#4f9b70';
}

function timestamp(value: unknown) {
  const parsed = typeof value === 'number'
    ? value < 10_000_000_000 ? value * 1000 : value
    : typeof value === 'string' ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function placeCoordinates(place: TransitTripPlace | undefined): [number, number] | undefined {
  return place && isNumber(place.lon) && isNumber(place.lat) ? [place.lon, place.lat] : undefined;
}

function cumulativeDistances(coordinates: [number, number][]) {
  const distances = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    distances.push(distances[index - 1] + distanceInMeters(coordinates[index - 1], coordinates[index]));
  }
  return distances;
}

function nearestPathIndex(
  coordinates: [number, number][],
  point: [number, number],
  startIndex: number,
) {
  let nearestIndex = Math.min(startIndex, coordinates.length - 1);
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = nearestIndex; index < coordinates.length; index += 1) {
    const distance = distanceInMeters(coordinates[index], point);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

export function buildEstimatedTripLeg(leg: TransitTripLeg, inputCoordinates: [number, number][]) {
  let coordinates = inputCoordinates;
  if (coordinates.length < 2) return undefined;
  const intermediateStops = Array.isArray(leg.intermediateStops)
    ? leg.intermediateStops
    : [];
  const places = [leg.from, ...intermediateStops, leg.to];
  // Geometry from different feeds is not guaranteed to use the trip direction.
  // Pick the orientation which best maps the ordered calls without going backwards.
  const mappingError = (candidate: [number, number][]) => {
    let index = 0;
    return places.reduce((sum, place) => {
      const point = placeCoordinates(place);
      if (!point) return sum;
      index = nearestPathIndex(candidate, point, index);
      return sum + distanceInMeters(candidate[index], point);
    }, 0);
  };
  const reversed = [...coordinates].reverse();
  if (mappingError(reversed) < mappingError(coordinates)) coordinates = reversed;
  const distances = cumulativeDistances(coordinates);
  const anchors: Array<{ distance: number; time: number; stopId?: string }> = [];
  let pathIndex = 0;

  places.forEach((place, placeIndex) => {
    const point = placeCoordinates(place);
    if (!point) return;
    pathIndex = nearestPathIndex(coordinates, point, pathIndex);
    const arrival = timestamp(place?.arrival);
    const departure = timestamp(place?.departure);
    const fallback = placeIndex === 0 ? timestamp(leg.startTime) : timestamp(leg.endTime);
    const times = placeIndex === 0
      ? [departure ?? arrival ?? fallback]
      : placeIndex === places.length - 1
        ? [arrival ?? departure ?? fallback]
        : [arrival, departure];
    times.forEach((time) => {
      if (time !== undefined && (anchors.length === 0 || time >= anchors[anchors.length - 1].time)) {
        anchors.push({ distance: distances[pathIndex], time, stopId: place?.stopId });
      }
    });
  });

  if (anchors.length < 2) {
    const start = timestamp(leg.startTime);
    const end = timestamp(leg.endTime);
    if (start === undefined || end === undefined || end <= start) return undefined;
    anchors.splice(0, anchors.length,
      { distance: 0, time: start },
      { distance: distances[distances.length - 1], time: end },
    );
  }

  return {
    coordinates,
    cumulativeDistances: distances,
    anchors,
    realTime: leg.realTime === true,
  } satisfies EstimatedTripLeg;
}

export function estimatedDistance(
  leg: EstimatedTripLeg,
  time: number,
  boardingStop?: SelectedTrip['boardingStop'],
) {
  const { anchors } = leg;
  if (!anchors.length) return undefined;
  const clampedTime = Math.max(anchors[0].time, Math.min(anchors[anchors.length - 1].time, time));
  let nextAnchorIndex = anchors.findIndex((anchor) => anchor.time >= clampedTime);
  if (nextAnchorIndex < 0) nextAnchorIndex = anchors.length - 1;
  const nextAnchor = anchors[nextAnchorIndex];
  const previousAnchor = anchors[Math.max(0, nextAnchorIndex - 1)];
  const duration = nextAnchor.time - previousAnchor.time;
  const progress = duration > 0 ? (clampedTime - previousAnchor.time) / duration : 1;
  const interpolated = previousAnchor.distance
    + (nextAnchor.distance - previousAnchor.distance) * Math.max(0, Math.min(1, progress));
  if (!boardingStop || time >= boardingStop.departureTime) return interpolated;
  const stopAnchor = anchors.find((anchor) => anchor.stopId === boardingStop.stopId);
  const boardingDistance = stopAnchor?.distance ?? leg.cumulativeDistances[
    nearestPathIndex(leg.coordinates, boardingStop.coordinates, 0)
  ];
  return Math.min(interpolated, boardingDistance);
}

function pathPoseAtDistance(leg: EstimatedTripLeg, targetDistance: number) {
  const { coordinates, cumulativeDistances: distances } = leg;
  const clampedDistance = Math.max(0, Math.min(distances[distances.length - 1], targetDistance));
  let coordinateIndex = distances.findIndex((distance) => distance >= clampedDistance);
  if (coordinateIndex <= 0) coordinateIndex = 1;
  if (coordinateIndex < 0) coordinateIndex = coordinates.length - 1;
  const previousDistance = distances[coordinateIndex - 1];
  const nextDistance = distances[coordinateIndex];
  const segmentProgress = nextDistance > previousDistance
    ? (clampedDistance - previousDistance) / (nextDistance - previousDistance)
    : 0;
  const previous = coordinates[coordinateIndex - 1];
  const next = coordinates[coordinateIndex];
  const coordinatesAtDistance = [
    previous[0] + (next[0] - previous[0]) * segmentProgress,
    previous[1] + (next[1] - previous[1]) * segmentProgress,
  ] as [number, number];
  return {
    coordinates: coordinatesAtDistance,
    heading: vehicleHeadingRadians(previous, next),
  };
}

export function vehicleHeadingRadians(from: [number, number], to: [number, number]) {
  const averageLatitude = (from[1] + to[1]) * Math.PI / 360;
  const east = (to[0] - from[0]) * Math.cos(averageLatitude);
  const north = to[1] - from[1];
  return Math.atan2(east, north);
}

function vehiclePartLayout(mode: string) {
  if (mode === 'TRAM') return { count: 3, length: 8.4, gap: 0.8 };
  if (mode === 'SUBWAY') return { count: 5, length: 16, gap: 1 };
  if (isRailMode(mode)) return { count: 5, length: 18, gap: 1.2 };
  return { count: 1, length: 12, gap: 0 };
}

function estimatedVehiclePose(
  leg: EstimatedTripLeg,
  time: number,
  mode: string,
  color: string,
  boardingStop?: SelectedTrip['boardingStop'],
): TransitVehiclePose | undefined {
  const distance = estimatedDistance(leg, time, boardingStop);
  if (distance === undefined) return undefined;
  const layout = vehiclePartLayout(mode);
  const spacing = layout.length + layout.gap;
  const halfLength = spacing * (layout.count - 1) / 2;
  const totalDistance = leg.cumulativeDistances[leg.cumulativeDistances.length - 1];
  const centerDistance = totalDistance > halfLength * 2
    ? Math.max(halfLength, Math.min(totalDistance - halfLength, distance))
    : totalDistance / 2;
  return {
    mode,
    color,
    realTime: leg.realTime,
    parts: Array.from({ length: layout.count }, (_, index) => (
      pathPoseAtDistance(leg, centerDistance + (index - (layout.count - 1) / 2) * spacing)
    )),
  };
}

export class TransitStopsLayer {
  private map: Map | null = null;
  private requestController: AbortController | null = null;
  private tripController: AbortController | null = null;
  private requestGeneration = 0;
  private selectedTrip: SelectedTrip | null = null;
  private estimatedTripLegs: EstimatedTripLeg[] = [];
  private vehicleTimer: number | undefined;
  private tripRefreshTimer: number | undefined;

  constructor(private readonly onVehiclePose?: (pose: TransitVehiclePose | null) => void) {}

  async install(map: Map, onStopClick: (stop: TransitStopSelection) => void) {
    this.map = map;
    map.addSource(TRANSIT_SOURCE_ID, {
      type: 'geojson',
      data: emptyCollection(),
    });
    map.addSource(SELECTED_STOP_SOURCE_ID, {
      type: 'geojson',
      data: emptyCollection(),
    });
    map.addSource(SELECTED_ROUTES_SOURCE_ID, {
      type: 'geojson',
      data: emptyRouteCollection(),
    });
    map.addSource(ESTIMATED_VEHICLE_SOURCE_ID, {
      type: 'geojson',
      data: emptyCollection(),
    });

    // Mutate MapLibre's shared image atlas serially. Concurrent addImage calls
    // have produced cross-icon fragments on high-DPI Android renderers.
    const transitIcons = [
      [TRANSIT_ICON_IDS.bus, BusFront, MAP_COLORS.transitBlue],
      [TRANSIT_ICON_IDS.tram, TramFront, '#8554c7'],
      [TRANSIT_ICON_IDS.metro, TrainFrontTunnel, METRO_COLOR],
      [TRANSIT_ICON_IDS.train, TrainFront, '#4f9b70'],
      [TRANSIT_ICON_IDS.vehicle, BusFront, undefined],
    ] as const;
    for (const [id, icon, color] of transitIcons) {
      await addTransitIcon(map, id, icon, color);
    }
    if (this.map !== map) return;

    const iconLayer = (
      id: string,
      minzoom: number,
      iconImage: string,
      modes: string[],
    ): SymbolLayerSpecification => ({
      id,
      type: 'symbol',
      source: TRANSIT_SOURCE_ID,
      minzoom,
      filter: ['in', ['get', 'mode'], ['literal', modes]],
      layout: {
        'icon-image': iconImage,
        'icon-size': ['step', ['zoom'], 0.575, 14, 0.69, 18, 0.85],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    const icons = [
      // Rail stops carry the city-scale network, so they appear first.
      iconLayer('transit-train-stop-icons', 10, TRANSIT_ICON_IDS.train, [
        'RAIL', 'SUBURBAN', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL',
      ]),
      iconLayer('transit-metro-stop-icons', 10, TRANSIT_ICON_IDS.metro, ['SUBWAY']),
      iconLayer('transit-tram-stop-icons', 12, TRANSIT_ICON_IDS.tram, ['TRAM']),
      iconLayer('transit-bus-stop-icons', 14, TRANSIT_ICON_IDS.bus, ['BUS']),
    ];
    const hitLayer = (
      id: string,
      minzoom: number,
      modes: string[],
    ): CircleLayerSpecification => ({
      id,
      type: 'circle',
      source: TRANSIT_SOURCE_ID,
      minzoom,
      filter: ['in', ['get', 'mode'], ['literal', modes]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 18, 18],
        // Keep the layer rendered and queryable without changing the visual.
        'circle-color': '#ffffff',
        'circle-opacity': 0.01,
      },
    });
    const hitLayers = [
      hitLayer('transit-train-stop-hit-targets', 9, [
        'RAIL', 'SUBURBAN', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL',
      ]),
      hitLayer('transit-metro-stop-hit-targets', 10, ['SUBWAY']),
      hitLayer('transit-tram-stop-hit-targets', 12, ['TRAM']),
      hitLayer('transit-bus-stop-hit-targets', 14, ['BUS']),
    ];
    const labelLayer = (
      id: string,
      minzoom: number,
      modes: string[],
    ): SymbolLayerSpecification => ({
      id,
      type: 'symbol',
      source: TRANSIT_SOURCE_ID,
      minzoom,
      filter: ['in', ['get', 'mode'], ['literal', modes]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular', 'Open Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], minzoom, 10, 18, 12],
        'text-offset': [0, 1.05],
        'text-anchor': 'top',
        'text-padding': 8,
        'text-max-width': 12,
      },
      paint: {
        'text-color': '#385d5d',
        'text-halo-color': '#f7f8f2',
        'text-halo-width': 1.5,
      },
    });
    const labels = [
      labelLayer('transit-train-stop-labels', 11, [
        'RAIL', 'SUBURBAN', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL',
      ]),
      labelLayer('transit-metro-stop-labels', 12, ['SUBWAY']),
      labelLayer('transit-tram-stop-labels', 14, ['TRAM']),
      labelLayer('transit-bus-stop-labels', 16, ['BUS']),
    ];
    // Keep transit symbols below the app's close-zoom POI labels when the
    // style provides that anchor, otherwise let MapLibre append them.
    const beforeLayerId = map.getLayer('global-poi-labels')
      ? 'global-poi-labels'
      : undefined;
    const routeCasing: LineLayerSpecification = {
      id: 'transit-selected-route-casing',
      type: 'line',
      source: SELECTED_ROUTES_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#fffdf8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 18, 10],
        'line-opacity': 0.9,
      },
    };
    const routeLines: LineLayerSpecification = {
      id: 'transit-selected-routes',
      type: 'line',
      source: SELECTED_ROUTES_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 18, 5],
        'line-opacity': 0.88,
      },
    };
    const selectedStopHalo: CircleLayerSpecification = {
      id: 'transit-selected-stop-halo',
      type: 'circle',
      source: SELECTED_STOP_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 13, 18, 20],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.24,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    };
    const selectedStopIcon: SymbolLayerSpecification = {
      id: 'transit-selected-stop-icon',
      type: 'symbol',
      source: SELECTED_STOP_SOURCE_ID,
      layout: {
        'icon-image': [
          'match',
          ['get', 'mode'],
          'BUS', TRANSIT_ICON_IDS.bus,
          'TRAM', TRANSIT_ICON_IDS.tram,
          'SUBWAY', TRANSIT_ICON_IDS.metro,
          TRANSIT_ICON_IDS.train,
        ],
        'icon-size': ['step', ['zoom'], 0.575, 14, 0.665, 18, 0.755],
        'icon-padding': 8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const estimatedVehicleHalo: CircleLayerSpecification = {
      id: 'transit-estimated-vehicle-halo',
      type: 'circle',
      source: ESTIMATED_VEHICLE_SOURCE_ID,
      minzoom: 5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 12, 14, 15, 18, 18],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
        'circle-opacity': 0.96,
      },
    };
    const estimatedVehicleIcon: SymbolLayerSpecification = {
      id: 'transit-estimated-vehicle-icon',
      type: 'symbol',
      source: ESTIMATED_VEHICLE_SOURCE_ID,
      minzoom: 5,
      layout: {
        'icon-image': TRANSIT_ICON_IDS.vehicle,
        'icon-size': ['step', ['zoom'], 0.39, 14, 0.46, 18, 0.53],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    const estimatedVehicleLabel: SymbolLayerSpecification = {
      id: 'transit-estimated-vehicle-label',
      type: 'symbol',
      source: ESTIMATED_VEHICLE_SOURCE_ID,
      minzoom: 13,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular', 'Open Sans Regular'],
        'text-size': 10,
        'text-offset': [0, 1.9],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#334155',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    };
    map.addLayer(routeCasing, beforeLayerId);
    map.addLayer(routeLines, beforeLayerId);
    hitLayers.forEach((layer) => map.addLayer(layer, beforeLayerId));
    map.addLayer(selectedStopHalo, beforeLayerId);
    icons.forEach((layer) => map.addLayer(layer, beforeLayerId));
    map.addLayer(selectedStopIcon, beforeLayerId);
    map.addLayer(estimatedVehicleHalo, beforeLayerId);
    map.addLayer(estimatedVehicleIcon, beforeLayerId);
    map.addLayer(estimatedVehicleLabel, beforeLayerId);
    labels.forEach((layer) => map.addLayer(layer, beforeLayerId));
    const clickableLayerIds = [...hitLayers, ...icons, selectedStopIcon, ...labels].map((layer) => layer.id);
    const selectFeature = (feature: MapGeoJSONFeature | undefined, point: Point) => {
      if (!feature) return;
      const properties = feature.properties ?? {};
      const coordinates = feature.geometry.type === 'Point'
        ? feature.geometry.coordinates as [number, number]
        : map.unproject(point).toArray() as [number, number];
      const selection: TransitStopSelection = {
        stopId: String(properties.stopId ?? feature.id ?? ''),
        name: String(properties.name ?? 'Transit stop'),
        mode: String(properties.mode ?? 'TRANSIT'),
        coordinates,
        provider: properties.provider === 'digitransit' ? 'digitransit' : 'transitous',
      };
      this.selectStop(selection);
      onStopClick(selection);
    };
    map.on('click', (event) => {
      selectFeature(map.queryRenderedFeatures(event.point, { layers: clickableLayerIds })[0], event.point);
    });
    hitLayers.forEach(({ id: layerId }) => {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('mouseenter', selectedStopIcon.id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', selectedStopIcon.id, () => { map.getCanvas().style.cursor = ''; });
  }

  private selectStop(stop: TransitStopSelection) {
    if (!this.map) return;
    const selectedSource = this.map.getSource(SELECTED_STOP_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: stop.coordinates },
        properties: {
          color: stopColor(stop.mode),
          stopId: stop.stopId,
          name: stop.name,
          mode: stop.mode,
          provider: stop.provider,
        },
      }],
    });
    this.clearSelectedTrip();
  }

  selectSearchStop(stop: TransitStopSelection) {
    this.selectStop(stop);
  }

  selectTrip(
    tripId: string,
    mode: string,
    color: string,
    showRoute = true,
    provider: TransitProviderId = 'transitous',
    serviceDate?: string,
    boardingStop?: { stopId: string; coordinates: [number, number]; departure: string; scheduledDeparture?: string },
  ) {
    if (!this.map || !tripId) return;
    this.clearSelectedTrip();
    this.selectedTrip = {
      tripId,
      mode,
      color: mode === 'SUBWAY' ? METRO_COLOR : routeColor(color, stopColor(mode)),
      showRoute,
      provider,
      serviceDate,
      boardingStop: boardingStop ? {
        stopId: boardingStop.stopId,
        coordinates: boardingStop.coordinates,
        departureTime: timestamp(boardingStop.departure) ?? Number.NEGATIVE_INFINITY,
        scheduledDeparture: boardingStop.scheduledDeparture,
      } : undefined,
    };
    void this.loadSelectedTrip();
    this.vehicleTimer = window.setInterval(() => this.updateEstimatedVehicle(), 250);
    this.tripRefreshTimer = window.setInterval(() => void this.loadSelectedTrip(), 60_000);
  }

  private async loadSelectedTrip() {
    const selection = this.selectedTrip;
    if (!this.map || !selection) return;
    this.tripController?.abort();
    const controller = new AbortController();
    this.tripController = controller;

    try {
      const payload = await fetchTransitTrip(
        selection.provider,
        selection.tripId,
        selection.serviceDate,
        controller.signal,
      );
      if (
        controller.signal.aborted
        || !this.map
        || this.selectedTrip?.tripId !== selection.tripId
        || this.selectedTrip.provider !== selection.provider
        || this.selectedTrip.serviceDate !== selection.serviceDate
      ) return;

      const validatesBoardingStop = selection.boardingStop && !selection.boardingStop.stopId.startsWith('route-origin:');
      const resolution = resolveSelectedTripResult(payload, {
        tripId: selection.tripId,
        provider: selection.provider,
        serviceDate: selection.serviceDate,
        boardingStopId: validatesBoardingStop ? selection.boardingStop?.stopId : undefined,
        scheduledDeparture: validatesBoardingStop ? selection.boardingStop?.scheduledDeparture : undefined,
      });
      if (!resolution.ok) console.warn('Selected map trip could not be resolved.', {
        provider: selection.provider, reason: resolution.reason,
      });
      const resolved = resolution.ok ? resolution.trip : undefined;
      const estimatedLegs: EstimatedTripLeg[] = [];
      const features: RouteLineFeature[] = resolved && resolved.leg.coordinates.length >= 2
        ? [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: resolved.leg.coordinates },
          properties: { color: selection.color },
        }] : [];
      if (resolved) {
        const estimatedLeg = buildEstimatedTripLeg(resolved.leg, resolved.leg.coordinates);
        if (estimatedLeg && resolved.vehicleTimelineUsable) estimatedLegs.push(estimatedLeg);
      }
      this.estimatedTripLegs = estimatedLegs;
      const source = this.map.getSource(SELECTED_ROUTES_SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData(selection.showRoute ? { type: 'FeatureCollection', features } : emptyRouteCollection());
      this.updateEstimatedVehicle();
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') {
        console.warn(`${selection.provider} trip lookup failed.`, error);
      }
    }
  }

  private updateEstimatedVehicle() {
    const source = this.map?.getSource(ESTIMATED_VEHICLE_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source || !this.selectedTrip) return;
    const now = Date.now();
    const activeLeg = this.estimatedTripLegs.find((leg) => (
      now >= leg.anchors[0].time && now <= leg.anchors[leg.anchors.length - 1].time
    )) ?? this.estimatedTripLegs.find((leg) => now < leg.anchors[0].time);
    const displayableLeg = activeLeg && tripIsDisplayableAt(activeLeg.anchors.map((anchor) => anchor.time), now)
      ? activeLeg : undefined;
    const pose = displayableLeg
      ? estimatedVehiclePose(
        displayableLeg,
        now,
        this.selectedTrip.mode,
        this.selectedTrip.color,
        this.selectedTrip.boardingStop,
      )
      : undefined;
    if (!displayableLeg || !pose) {
      source.setData(emptyCollection());
      this.onVehiclePose?.(null);
      return;
    }
    const coordinates = pose.parts[Math.floor(pose.parts.length / 2)].coordinates;
    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          color: this.selectedTrip.color,
          label: displayableLeg.realTime ? 'Estimated · realtime' : 'Estimated · schedule',
        },
      }],
    });
    this.onVehiclePose?.(pose);
  }

  private clearSelectedTrip() {
    this.tripController?.abort();
    if (this.vehicleTimer !== undefined) window.clearInterval(this.vehicleTimer);
    if (this.tripRefreshTimer !== undefined) window.clearInterval(this.tripRefreshTimer);
    this.vehicleTimer = undefined;
    this.tripRefreshTimer = undefined;
    this.selectedTrip = null;
    this.estimatedTripLegs = [];
    const routeSource = this.map?.getSource(SELECTED_ROUTES_SOURCE_ID) as GeoJSONSource | undefined;
    const vehicleSource = this.map?.getSource(ESTIMATED_VEHICLE_SOURCE_ID) as GeoJSONSource | undefined;
    routeSource?.setData(emptyRouteCollection());
    vehicleSource?.setData(emptyCollection());
    this.onVehiclePose?.(null);
  }

  clearSelection() {
    this.clearSelectedTrip();
    const selectedSource = this.map?.getSource(SELECTED_STOP_SOURCE_ID) as GeoJSONSource | undefined;
    selectedSource?.setData(emptyCollection());
  }

  clearTrip() {
    this.clearSelectedTrip();
  }

  async update(bounds: { getSouth: () => number; getWest: () => number; getNorth: () => number; getEast: () => number }, zoom: number) {
    if (!this.map || zoom < MIN_TRANSIT_ZOOM) return;

    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    const generation = ++this.requestGeneration;
    const requestBounds = {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    };

    try {
      const stops = await fetchTransitStops(requestBounds, controller.signal);
      if (generation !== this.requestGeneration || !this.map) return;

      const seen = new Set<string>();
      const features = stops
        .map(toFeature)
        .filter((feature) => {
          if (seen.has(feature.id)) return false;
          seen.add(feature.id);
          return true;
        });
      const stationFeatures = groupRailPlatforms(features);
      const source = this.map.getSource(TRANSIT_SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData({ type: 'FeatureCollection', features: stationFeatures });
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') {
        console.warn('Transit stop lookup failed.', error);
      }
    }
  }

  clear() {
    const source = this.map?.getSource(TRANSIT_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(emptyCollection());
  }

  dispose() {
    this.requestController?.abort();
    this.clearSelectedTrip();
    this.requestGeneration += 1;
    this.map = null;
  }
}
