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
import {
  fetchTransitStops,
  fetchTransitTrip,
  type TransitProviderId,
  type TransitPositionStatus,
  type TransitStop,
  type TransitStopSelection,
  type TransitTripLeg,
  type TransitTripPlace,
} from './transit';
import { resolveSelectedTripResult, tripIsDisplayableAt } from './transit/tripTimeline';
import {
  beginObservedPositionTransition,
  LIVE_OBSERVATION_FUTURE_TOLERANCE_MS,
  LIVE_OBSERVATION_MAX_AGE_MS,
  matchLiveObservation,
  observedPositionAt,
  vehicleResponseIsCurrent,
  type ObservedPositionTransition,
} from './transit/vehiclePosition';

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

export type TransitVehicleTripSelection = {
  tripId: string;
  mode: string;
  color: string;
  showRoute: boolean;
  provider: TransitProviderId;
  serviceDate?: string;
  boardingStop?: { stopId: string; coordinates: [number, number]; departureTime: number; scheduledDeparture?: string };
};

type SelectedTrip = TransitVehicleTripSelection;

type TrackedTrip = {
  selection: SelectedTrip;
  estimatedLegs: EstimatedTripLeg[];
  routeCoordinates?: [number, number][];
  boardingContextUsable: boolean;
  observedTransition?: ObservedPositionTransition;
  controller?: AbortController;
  lastFetchAt: number;
};

export type TransitVehiclePose = {
  mode: string;
  color: string;
  status: TransitPositionStatus;
  /** Compatibility flag: true only for observed coordinates, never stop-time interpolation. */
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
  bus: 'transit-bus-icon',
  tram: 'transit-tram-icon',
  metro: 'transit-metro-icon',
  train: 'transit-train-icon',
  vehicle: 'transit-estimated-vehicle-icon',
} as const;

const METRO_COLOR = '#e87524';

async function addTransitIcon(
  map: Map,
  id: string,
  icon: typeof BusFront,
  color?: string,
) {
  if (map.hasImage(id)) return;
  const renderedIcon = renderToStaticMarkup(createElement(icon, {
    color: '#ffffff',
    size: 22,
    strokeWidth: 2.5,
  }));
  const svg = color
    ? renderedIcon.replace(
      /(<svg[^>]*>)/,
      `$1<circle cx="12" cy="12" r="11" fill="${color}"/>`,
    )
    : renderedIcon;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Unable to load ${id}`));
  });
  if (!map.hasImage(id)) {
    map.addImage(id, image, { pixelRatio: 2 });
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
    const arrival = timestamp(place?.arrival) ?? timestamp(place?.scheduledArrival);
    const departure = timestamp(place?.departure) ?? timestamp(place?.scheduledDeparture);
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
  boardingStop?: TransitVehicleTripSelection['boardingStop'],
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
  // Coarse feed geometry can snap a stop to a point tens of metres away. Keep
  // a small approach reserve until the final seconds so the marker does not
  // appear to have reached the stop substantially before its arrival clock.
  const remaining = nextAnchor.time - clampedTime;
  const segmentDistance = nextAnchor.distance - previousAnchor.distance;
  const approachReserve = remaining > 0 && segmentDistance > 0
    ? Math.min(40, segmentDistance * 0.15) * Math.min(1, remaining / 15_000)
    : 0;
  const conservative = Math.min(interpolated, nextAnchor.distance - approachReserve);
  if (!boardingStop || time >= boardingStop.departureTime) return conservative;
  const stopAnchor = anchors.find((anchor) => anchor.stopId === boardingStop.stopId);
  const boardingDistance = stopAnchor?.distance ?? leg.cumulativeDistances[
    nearestPathIndex(leg.coordinates, boardingStop.coordinates, 0)
  ];
  return Math.min(conservative, boardingDistance);
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

export function estimatedVehiclePose(
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
    status: 'estimated',
    realTime: false,
    parts: Array.from({ length: layout.count }, (_, index) => (
      pathPoseAtDistance(leg, centerDistance + (index - (layout.count - 1) / 2) * spacing)
    )),
  };
}

function observedVehiclePose(
  leg: EstimatedTripLeg,
  coordinates: [number, number],
  mode: string,
  color: string,
  headingDegrees?: number,
): TransitVehiclePose {
  const pathIndex = nearestPathIndex(leg.coordinates, coordinates, 0);
  const centerDistance = leg.cumulativeDistances[pathIndex];
  const layout = vehiclePartLayout(mode);
  const spacing = layout.length + layout.gap;
  const centerIndex = Math.floor(layout.count / 2);
  const parts = Array.from({ length: layout.count }, (_, index) => (
    index === centerIndex
      ? {
        coordinates,
        heading: isNumber(headingDegrees)
          ? headingDegrees * Math.PI / 180
          : pathPoseAtDistance(leg, centerDistance).heading,
      }
      : pathPoseAtDistance(leg, centerDistance + (index - centerIndex) * spacing)
  ));
  return { mode, color, status: 'live', realTime: true, parts };
}

export class TransitStopsLayer {
  private map: Map | null = null;
  private requestController: AbortController | null = null;
  private requestGeneration = 0;
  private trackedTrips: { current?: TrackedTrip; next?: TrackedTrip } = {};
  private journeyMode = false;
  private vehicleTimer: number | undefined;
  private tripRefreshTimer: number | undefined;
  private tripGeneration = 0;
  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      Object.values(this.trackedTrips).forEach((tracked) => tracked?.controller?.abort());
      this.stopTripPolling();
      return;
    }
    if (this.trackedTrips.current || this.trackedTrips.next) this.startTripPolling();
  };

  constructor(private readonly onVehiclePose?: (pose: TransitVehiclePose | null) => void) {}

  async install(
    map: Map,
    onStopClick: (stop: TransitStopSelection) => void,
    interactionBlocked: () => boolean = () => false,
    preserveSelectedTrip: () => boolean = () => false,
  ) {
    this.map = map;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
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

    await Promise.all([
      addTransitIcon(map, TRANSIT_ICON_IDS.bus, BusFront, MAP_COLORS.transitBlue),
      addTransitIcon(map, TRANSIT_ICON_IDS.tram, TramFront, '#8554c7'),
      addTransitIcon(map, TRANSIT_ICON_IDS.metro, TrainFrontTunnel, METRO_COLOR),
      addTransitIcon(map, TRANSIT_ICON_IDS.train, TrainFront, '#4f9b70'),
      addTransitIcon(map, TRANSIT_ICON_IDS.vehicle, BusFront),
    ]);
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
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 1.25, 14, 1.5, 18, 1.7],
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
        'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 1.25, 14, 1.45, 18, 1.65],
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
        'circle-opacity': ['case', ['get', 'subdued'], 0.42, 0.96],
      },
    };
    const estimatedVehicleIcon: SymbolLayerSpecification = {
      id: 'transit-estimated-vehicle-icon',
      type: 'symbol',
      source: ESTIMATED_VEHICLE_SOURCE_ID,
      minzoom: 5,
      layout: {
        'icon-image': TRANSIT_ICON_IDS.vehicle,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 0.85, 14, 1, 18, 1.15],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': ['case', ['get', 'subdued'], 0.48, 1],
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
        'text-opacity': ['case', ['get', 'subdued'], 0.62, 1],
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
      this.selectStop(selection, preserveSelectedTrip());
      onStopClick(selection);
    };
    map.on('click', (event) => {
      if (interactionBlocked()) return;
      selectFeature(map.queryRenderedFeatures(event.point, { layers: clickableLayerIds })[0], event.point);
    });
    hitLayers.forEach(({ id: layerId }) => {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('mouseenter', selectedStopIcon.id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', selectedStopIcon.id, () => { map.getCanvas().style.cursor = ''; });
  }

  private selectStop(stop: TransitStopSelection, preserveTrip = false) {
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
    if (!preserveTrip) this.clearSelectedTrip();
  }

  selectSearchStop(stop: TransitStopSelection) {
    this.selectStop(stop);
  }

  selectSearchStopPreservingTrip(stop: TransitStopSelection) {
    this.selectStop(stop, true);
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
    const selectionKey = `${provider}:${tripId}:${serviceDate ?? ''}`;
    // Repeated callbacks (for example while React state is settling) should
    // not tear down and restart the same network request.
    const selected = this.trackedTrips.current?.selection;
    if (!this.journeyMode && selected
      && `${selected.provider}:${selected.tripId}:${selected.serviceDate ?? ''}` === selectionKey) return;
    this.clearSelectedTrip();
    const selection: SelectedTrip = {
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
    this.trackedTrips.current = {
      selection, estimatedLegs: [], boardingContextUsable: false, lastFetchAt: 0,
    };
    this.startTripPolling();
  }

  selectJourneyTrips(current?: TransitVehicleTripSelection, next?: TransitVehicleTripSelection) {
    if (!this.map) return;
    const key = (selection?: TransitVehicleTripSelection) => selection
      ? `${selection.provider}:${selection.tripId}:${selection.serviceDate ?? ''}:${selection.boardingStop?.stopId ?? ''}:${selection.boardingStop?.scheduledDeparture ?? ''}`
      : '';
    if (this.journeyMode
      && key(this.trackedTrips.current?.selection) === key(current)
      && key(this.trackedTrips.next?.selection) === key(next)) return;
    const tracked = (selection: TransitVehicleTripSelection): TrackedTrip => ({
      selection: {
        ...selection,
        color: selection.mode === 'SUBWAY'
          ? METRO_COLOR : routeColor(selection.color, stopColor(selection.mode)),
        showRoute: false,
      },
      estimatedLegs: [],
      boardingContextUsable: false,
      lastFetchAt: 0,
    });
    const previous = this.journeyMode ? this.trackedTrips : {};
    if (!this.journeyMode) this.clearSelectedTrip();
    const retainOrCreate = (role: 'current' | 'next', selection?: TransitVehicleTripSelection) => {
      const existing = previous[role];
      if (!selection) {
        existing?.controller?.abort();
        return undefined;
      }
      if (existing && key(existing.selection) === key(selection)) {
        existing.selection = {
          ...selection,
          color: selection.mode === 'SUBWAY'
            ? METRO_COLOR : routeColor(selection.color, stopColor(selection.mode)),
          showRoute: false,
        };
        return existing;
      }
      existing?.controller?.abort();
      return tracked(selection);
    };
    this.trackedTrips = {
      current: retainOrCreate('current', current),
      next: retainOrCreate('next', next),
    };
    this.journeyMode = true;
    this.updateEstimatedVehicle();
    this.startTripPolling(!previous.current && !previous.next);
  }

  private startTripPolling(force = true) {
    this.stopTripPolling();
    if (typeof document !== 'undefined' && document.hidden) return;
    void this.loadSelectedTrips(force);
    this.vehicleTimer = window.setInterval(() => this.updateEstimatedVehicle(), 250);
    this.tripRefreshTimer = window.setInterval(() => void this.loadSelectedTrips(), 15_000);
  }

  private stopTripPolling() {
    if (this.vehicleTimer !== undefined) window.clearInterval(this.vehicleTimer);
    if (this.tripRefreshTimer !== undefined) window.clearInterval(this.tripRefreshTimer);
    this.vehicleTimer = undefined;
    this.tripRefreshTimer = undefined;
  }

  private async loadSelectedTrips(force = false) {
    const entries = (['current', 'next'] as const).flatMap((role) => {
      const tracked = this.trackedTrips[role];
      return tracked ? [[role, tracked] as const] : [];
    });
    await Promise.all(entries.map(([role, tracked]) => this.loadTrackedTrip(role, tracked, force)));
  }

  private async loadTrackedTrip(role: 'current' | 'next', tracked: TrackedTrip, force: boolean) {
    const { selection } = tracked;
    if (!this.map || this.trackedTrips[role] !== tracked) return;
    if (!force && Date.now() - tracked.lastFetchAt < 10_000) return;
    tracked.lastFetchAt = Date.now();
    tracked.controller?.abort();
    const controller = new AbortController();
    tracked.controller = controller;
    const generation = this.tripGeneration;
    const requestIdentity = {
      generation,
      key: `${role}:${selection.provider}:${selection.tripId}:${selection.serviceDate ?? ''}:${selection.boardingStop?.stopId ?? ''}:${selection.boardingStop?.scheduledDeparture ?? ''}`,
    };

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
        || !vehicleResponseIsCurrent(requestIdentity, {
          generation: this.tripGeneration,
          key: `${role}:${this.trackedTrips[role]?.selection.provider ?? ''}:${this.trackedTrips[role]?.selection.tripId ?? ''}:${this.trackedTrips[role]?.selection.serviceDate ?? ''}:${this.trackedTrips[role]?.selection.boardingStop?.stopId ?? ''}:${this.trackedTrips[role]?.selection.boardingStop?.scheduledDeparture ?? ''}`,
        })
        || this.trackedTrips[role] !== tracked
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
      if (resolved) {
        const estimatedLeg = buildEstimatedTripLeg(resolved.leg, resolved.leg.coordinates);
        if (estimatedLeg && resolved.vehicleTimelineUsable) estimatedLegs.push(estimatedLeg);
      }
      tracked.routeCoordinates = resolved?.leg.coordinates.length
        ? resolved.leg.coordinates : undefined;
      tracked.boardingContextUsable = resolved?.boardingContextUsable ?? false;
      tracked.estimatedLegs = estimatedLegs;
      const observation = resolved?.boardingContextUsable
        ? matchLiveObservation(payload.vehicleObservations ?? [], selection, Date.now())
        : undefined;
      if (observation && observation.recordedAt > (tracked.observedTransition?.observation.recordedAt ?? 0)) {
        const currentCoordinates = tracked.observedTransition
          ? observedPositionAt(tracked.observedTransition, Date.now())
          : undefined;
        tracked.observedTransition = beginObservedPositionTransition(currentCoordinates, observation, Date.now());
      }
      this.updateSelectedRoutes();
      this.updateEstimatedVehicle();
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') {
        console.warn(`${selection.provider} trip lookup failed.`, error);
      }
    }
  }

  private updateSelectedRoutes() {
    const features = Object.values(this.trackedTrips).flatMap((tracked): RouteLineFeature[] => (
      tracked?.selection.showRoute && tracked.routeCoordinates && tracked.routeCoordinates.length >= 2
        ? [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: tracked.routeCoordinates },
          properties: { color: tracked.selection.color },
        }]
        : []
    ));
    const source = this.map?.getSource(SELECTED_ROUTES_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(features.length ? { type: 'FeatureCollection', features } : emptyRouteCollection());
  }

  private poseForTrackedTrip(tracked: TrackedTrip, now: number) {
    const activeLeg = tracked.estimatedLegs.find((leg) => (
      now >= leg.anchors[0].time && now <= leg.anchors[leg.anchors.length - 1].time
    )) ?? tracked.estimatedLegs.find((leg) => now < leg.anchors[0].time);
    const displayableLeg = activeLeg && tripIsDisplayableAt(activeLeg.anchors.map((anchor) => anchor.time), now)
      ? activeLeg : undefined;
    if (!displayableLeg) return undefined;
    const liveUsable = tracked.observedTransition
      && tracked.observedTransition.observation.recordedAt >= now - LIVE_OBSERVATION_MAX_AGE_MS
      && tracked.observedTransition.observation.recordedAt <= now + LIVE_OBSERVATION_FUTURE_TOLERANCE_MS;
    const pose = liveUsable
      ? observedVehiclePose(
        displayableLeg,
        observedPositionAt(tracked.observedTransition!, now),
        tracked.selection.mode,
        tracked.selection.color,
        tracked.observedTransition!.observation.heading,
      )
      : estimatedVehiclePose(
        displayableLeg,
        now,
        tracked.selection.mode,
        tracked.selection.color,
        tracked.boardingContextUsable ? tracked.selection.boardingStop : undefined,
      );
    return pose ? { pose, leg: displayableLeg } : undefined;
  }

  private updateEstimatedVehicle() {
    const source = this.map?.getSource(ESTIMATED_VEHICLE_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    const now = Date.now();
    const current = this.trackedTrips.current
      ? this.poseForTrackedTrip(this.trackedTrips.current, now) : undefined;
    const next = this.trackedTrips.next?.boardingContextUsable
      ? this.poseForTrackedTrip(this.trackedTrips.next, now) : undefined;
    const features = ([['current', current], ['next', next]] as const).flatMap(([role, positioned]) => {
      if (!positioned) return [];
      const tracked = this.trackedTrips[role];
      if (!tracked) return [];
      const coordinates = positioned.pose.parts[Math.floor(positioned.pose.parts.length / 2)].coordinates;
      return [{
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates },
        properties: {
          color: tracked.selection.color,
          subdued: role === 'next',
          label: `${role === 'next' ? 'Next · ' : ''}${positioned.pose.status === 'live'
            ? 'Live'
            : positioned.leg.realTime ? 'Estimated · realtime times' : 'Estimated · schedule'}`,
        },
      }];
    });
    source.setData({
      type: 'FeatureCollection',
      features,
    });
    this.onVehiclePose?.(current?.pose ?? null);
  }

  private clearSelectedTrip() {
    Object.values(this.trackedTrips).forEach((tracked) => tracked?.controller?.abort());
    this.stopTripPolling();
    this.trackedTrips = {};
    this.journeyMode = false;
    this.tripGeneration += 1;
    const routeSource = this.map?.getSource(SELECTED_ROUTES_SOURCE_ID) as GeoJSONSource | undefined;
    const vehicleSource = this.map?.getSource(ESTIMATED_VEHICLE_SOURCE_ID) as GeoJSONSource | undefined;
    routeSource?.setData(emptyRouteCollection());
    vehicleSource?.setData(emptyCollection());
    this.onVehiclePose?.(null);
  }

  clearSelection() {
    this.clearSelectedTrip();
    this.clearStopSelection();
  }

  clearStopSelection() {
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
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.clearSelectedTrip();
    this.requestGeneration += 1;
    this.map = null;
  }
}
