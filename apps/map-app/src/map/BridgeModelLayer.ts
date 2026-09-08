import * as maplibregl from 'maplibre-gl';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type FilterSpecification,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import {
  CARTOON_AMBIENT_GROUND_COLOR,
  CARTOON_AMBIENT_SKY_COLOR,
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_COLOR,
  CARTOON_SUN_POLAR_DEGREES,
  sunCartesian,
} from './CartoonLighting';
import { OPENFREEMAP_SOURCE_ID, setDrapedElevatedBridgeLayersVisible } from './GlobalMapStyle';

export const BRIDGE_MODEL_LAYER_ID = 'bridge-models-3d';

const BRIDGE_MIN_ZOOM = 13;
const BRIDGE_HANDOFF_FADE_MS = 220;
const BRIDGE_MAX_VIEWPORT_METERS = 4_000;
const MAX_BRIDGES = 240;
const BRIDGE_VIEW_PADDING_METERS = 600;
// Covers stitching gaps, deck widths and abutment extension without clipping geometry.
const BRIDGE_NEIGHBOUR_METERS = 40;
const MAX_PIERS = 400;
const MAX_ELEVATION_CACHE_ENTRIES = 8_000;
const SAMPLE_SPACING_METERS = 10;
const MAX_CLEARANCE_PROBES = 128;
const CLEARANCE_LIFT_SLOPE = 0.12;
const MIN_BRIDGE_LENGTH_METERS = 6;
const MIN_POLYGON_AREA_METRES = 8;
const MAX_POLYGON_AREA_METRES = 8_000;
const POLYGON_TOUCH_METRES = 1.5;
const LINE_STITCH_METRES = 22;
const LINE_STITCH_LATERAL_METRES = 3.6;
const LINE_CONTINUATION_DOT = 0.82;
const ENDPOINT_SNAP_METRES = 3.2;
const DECK_FRAGMENT_HULL_SLACK = 1.08;
const DECK_FRAGMENT_EXTRA_METRES = 40;
const INTERCHANGE_DECK_AREA_METRES = 3_200;
const MIN_POLYGON_MESH_AREA_METRES = 80;
const PARALLEL_BUNDLE_DOT = 0.9;
const DECK_WATER_CLEARANCE_METRES = 0.7;
const ABUTMENT_EXTEND_METRES = 10;
const POLYGON_SPAN_GAP_METRES = 22;
const MAX_ELONGATED_DECK_AREA_METRES = 50_000;
const ELONGATED_DECK_MIN_SPAN_METRES = 150;
const ELONGATED_DECK_MAX_WIDTH_METRES = 32;
const LAYER_SEPARATION_METERS = 3.8;
const SHORT_BRIDGE_MAX_ARCH_METERS = 2.2;
const BRIDGE_ARCH_STOPS: ReadonlyArray<readonly [number, number]> = [
  [150, SHORT_BRIDGE_MAX_ARCH_METERS], [300, 4], [600, 8], [1000, 12],
];
const ARCH_PER_METRE = 0.016;
const PIER_CLEARANCE_METERS = 5;
const PIER_SPACING_METERS = 28;
const PIER_END_MARGIN = 0.16;
const SHADOW_OFFSET_METERS = 2.8;
const MAX_CANVAS_LONG = 2048;
const MAX_CANVAS_SHORT = 512;
const MAX_CANVAS_PIXELS_PER_METRE = 6;
const MAX_TEXTURE_PIXELS_PER_BRIDGE = MAX_CANVAS_LONG * MAX_CANVAS_SHORT;
const MAX_TEXTURE_SECTIONS = 8;
const TEXTURE_SECTION_METRES = 300;
const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RECENTER_DISTANCE_METERS = 350;

const BRIDGE_FEATURE_FILTER: FilterSpecification = ['==', ['get', 'brunnel'], 'bridge'];

const LINE_BRIDGE_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service',
  'rail', 'transit', 'path', 'track', 'path_construction',
]);

const ROAD_FILL = '#f1efe7';
const RAIL_FILL = '#c8ceca';
const PATH_FILL = '#ded9cd';
const CYCLEWAY_FILL = '#e8ddd6';
const ROAD_EDGE = '#87918d';
const RAIL_EDGE = '#6f7874';
const PATH_EDGE = '#d8d4ca';
const CYCLEWAY_EDGE = '#b99a91';
const PIER_COLOR = new THREE.Color('#a6ada8');

export type BridgeViewState = {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
  pitch: number;
  terrainEnabled: boolean;
};

export type BridgeLineProperties = {
  className: string;
  subclass?: string;
  layer: number;
  ramp: boolean;
  service?: string;
  surface?: string;
};

export type BridgeLine = {
  coordinates: Array<[number, number]>;
  properties: BridgeLineProperties;
};

export type PlanPoint = { east: number; north: number };

export type PlanBounds = {
  minEast: number;
  minNorth: number;
  maxEast: number;
  maxNorth: number;
};

export type PlanOrigin = {
  longitude: number;
  latitude: number;
  cosLat: number;
};

export type BridgeDrawable = {
  kind: 'line' | 'polygon';
  coordinates: Array<[number, number]>;
  plan: PlanPoint[];
  holes?: PlanPoint[][];
  properties: BridgeLineProperties;
  width: number;
};

export type DeckSurface = {
  outer: PlanPoint[];
  holes: PlanPoint[][];
};

type SampledPoint = {
  longitude: number;
  latitude: number;
  ground: number;
  deck: number;
  east: number;
  north: number;
};

export type BridgePaintPart = {
  kind: 'line' | 'polygon';
  plan: PlanPoint[];
  holes?: PlanPoint[][];
  width: number;
  fill: string;
  edge: string;
  properties?: BridgeLineProperties;
};

type SampledBridge = {
  surfaces: DeckSurface[];
  surface: SampledPoint[];
  indices: number[];
  parts: BridgePaintPart[];
  bounds: PlanBounds;
  spanLength: number;
  texturePixelBudget?: number;
  piers?: Array<{ longitude: number; latitude: number; ground: number; deck: number }>;
};

type BridgeResources = {
  deck: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  paintBridge: SampledBridge;
  paintSignature: string;
  shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  origin: maplibregl.LngLat;
  elevation: number;
  heights: string;
};

type LocalPoint = {
  east: number;
  north: number;
  up: number;
};

type SourceFeature = ReturnType<MaplibreMap['querySourceFeatures']>[number];

export function viewportSpanMeters(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}) {
  const midLat = (bounds.south + bounds.north) * 0.5 * DEGREES_TO_RADIANS;
  const xSpan = Math.abs(bounds.east - bounds.west) * Math.cos(midLat) * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS;
  const ySpan = Math.abs(bounds.north - bounds.south) * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS;
  return Math.max(xSpan, ySpan);
}

export function shouldRenderBridgesForView(view: BridgeViewState) {
  if (!view.terrainEnabled || view.zoom < BRIDGE_MIN_ZOOM) return false;
  return viewportSpanMeters(view) <= BRIDGE_MAX_VIEWPORT_METERS;
}

export function bridgeWidthMetres(properties: BridgeLineProperties) {
  const { className, subclass, ramp, service } = properties;
  if (className === 'rail' || className === 'transit') return 5.5;
  if (className === 'track') return 3;
  if (className === 'path_construction') return 2;
  if (className === 'path') {
    if (subclass === 'cycleway') return 2.5;
    if (subclass === 'steps') return 1.6;
    return 1.8;
  }
  if (ramp) {
    if (className === 'motorway') return 7.5;
    if (className === 'trunk') return 7;
    if (className === 'primary') return 6.5;
    if (className === 'secondary') return 6;
    if (className === 'tertiary') return 5.5;
    return 5;
  }
  if (className === 'service') {
    if (service === 'parking_aisle') return 3;
    if (service === 'driveway' || service === 'alley') return 3.2;
    if (service === 'crossover') return 3.5;
    return 4;
  }
  if (className === 'motorway') return 10.5;
  if (className === 'trunk') return 9.5;
  if (className === 'primary') return 9;
  if (className === 'secondary') return 8;
  if (className === 'tertiary') return 7;
  if (className === 'minor') return 5.5;
  return 5;
}

export function bridgePaintColors(properties: BridgeLineProperties) {
  const { className, subclass } = properties;
  if (className === 'rail' || className === 'transit') return { fill: RAIL_FILL, edge: RAIL_EDGE };
  if (className === 'path' && subclass === 'cycleway') return { fill: CYCLEWAY_FILL, edge: CYCLEWAY_EDGE };
  if (className === 'path' || className === 'track' || className === 'path_construction') {
    return { fill: PATH_FILL, edge: PATH_EDGE };
  }
  return { fill: ROAD_FILL, edge: ROAD_EDGE };
}

export function lineLengthMetres(coordinates: Array<[number, number]>) {
  let length = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    length += segmentLengthMetres(coordinates[index - 1], coordinates[index]);
  }
  return length;
}

function planLineLength(plan: PlanPoint[]) {
  let length = 0;
  for (let index = 1; index < plan.length; index += 1) {
    length += Math.hypot(plan[index].east - plan[index - 1].east, plan[index].north - plan[index - 1].north);
  }
  return length;
}

export function densifyLine(coordinates: Array<[number, number]>, spacingMeters: number) {
  if (coordinates.length < 2) return coordinates.slice();
  const densified: Array<[number, number]> = [coordinates[0]];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const length = segmentLengthMetres(start, end);
    const steps = Math.max(1, Math.floor(length / spacingMeters));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      densified.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);
    }
  }
  return densified;
}

export function toPlanPoints(coordinates: Array<[number, number]>): PlanPoint[] {
  if (coordinates.length === 0) return [];
  return lngLatsToPlan(coordinates, planOriginFromLngLat(coordinates[0][0], coordinates[0][1]));
}

export function planOriginFromLngLat(longitude: number, latitude: number): PlanOrigin {
  return {
    longitude,
    latitude,
    cosLat: Math.cos(latitude * DEGREES_TO_RADIANS),
  };
}

export function lngLatsToPlan(coordinates: Array<[number, number]>, origin: PlanOrigin): PlanPoint[] {
  return coordinates.map(([longitude, latitude]) => ({
    east: (longitude - origin.longitude) * origin.cosLat * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS,
    north: (latitude - origin.latitude) * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS,
  }));
}

export function planToLngLat(point: PlanPoint, origin: PlanOrigin): [number, number] {
  return [
    origin.longitude + point.east / (origin.cosLat * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS),
    origin.latitude + point.north / (EARTH_RADIUS_METERS * DEGREES_TO_RADIANS),
  ];
}

export function planBounds(points: PlanPoint[], padding: number): PlanBounds {
  let minEast = Infinity;
  let minNorth = Infinity;
  let maxEast = -Infinity;
  let maxNorth = -Infinity;
  for (const point of points) {
    minEast = Math.min(minEast, point.east);
    minNorth = Math.min(minNorth, point.north);
    maxEast = Math.max(maxEast, point.east);
    maxNorth = Math.max(maxNorth, point.north);
  }
  return {
    minEast: minEast - padding,
    minNorth: minNorth - padding,
    maxEast: maxEast + padding,
    maxNorth: maxNorth + padding,
  };
}

/** Keep whole nearby parts and their neighbours, including offscreen tile continuations. */
export function bridgePartsForView<T extends { coordinates: Array<[number, number]> }>(
  parts: T[],
  view: Pick<BridgeViewState, 'west' | 'south' | 'east' | 'north'>,
): T[] {
  if (parts.length === 0) return [];
  // The downstream pipeline owns world wrapping; be conservative at its seams.
  if (view.west < -180 || view.east > 180 || view.east < view.west) return parts;
  const origin = planOriginFromLngLat((view.west + view.east) / 2, (view.south + view.north) / 2);
  const viewport = planBounds(lngLatsToPlan([
    [view.west, view.south], [view.east, view.north],
  ], origin), BRIDGE_VIEW_PADDING_METERS);
  const bounds = parts.map((part) => planBounds(lngLatsToPlan(part.coordinates, origin), 0));
  // Broad-phase only: generous bounds preserve existing stitch/cluster decisions.
  // A grid avoids comparing every offscreen part with every retained part.
  const grid = new Map<string, number[]>();
  const oversized: number[] = [];
  const cells = (box: PlanBounds): string[] | null => {
    const x0 = Math.floor(box.minEast / 256);
    const x1 = Math.floor(box.maxEast / 256);
    const y0 = Math.floor(box.minNorth / 256);
    const y1 = Math.floor(box.maxNorth / 256);
    if (!Number.isFinite(x0 + x1 + y0 + y1)) return [];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null;
    const keys: string[] = [];
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  };
  const retained = new Set<number>();
  const queue: number[] = [];
  bounds.forEach((box, index) => {
    if (boundsOverlap(box, viewport)) {
      retained.add(index);
      queue.push(index);
    }
    const keys = cells(box);
    if (!keys) {
      oversized.push(index);
      return;
    }
    for (const key of keys) {
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    }
  });
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const box = bounds[queue[cursor]];
    const expanded = {
      minEast: box.minEast - BRIDGE_NEIGHBOUR_METERS,
      minNorth: box.minNorth - BRIDGE_NEIGHBOUR_METERS,
      maxEast: box.maxEast + BRIDGE_NEIGHBOUR_METERS,
      maxNorth: box.maxNorth + BRIDGE_NEIGHBOUR_METERS,
    };
    const keys = cells(expanded);
    const candidates = keys
      ? new Set([...oversized, ...keys.flatMap((key) => grid.get(key) ?? [])])
      : bounds.keys();
    for (const index of candidates) {
      if (retained.has(index) || !boundsOverlap(expanded, bounds[index])) continue;
      retained.add(index);
      queue.push(index);
    }
  }
  // Preserve source order: clustering and painting use it to break ties.
  return parts.filter((_, index) => retained.has(index));
}

export function mergeBridgeLines(lines: BridgeLine[]) {
  const groups = new Map<string, BridgeLine[]>();
  for (const line of lines) {
    if (line.coordinates.length < 2) continue;
    const key = `${line.properties.className}:${line.properties.subclass ?? ''}:${line.properties.layer}:${line.properties.ramp ? 1 : 0}:${line.properties.service ?? ''}`;
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }

  const merged: BridgeLine[] = [];
  for (const group of groups.values()) {
    merged.push(...snapBridgeLineEndpoints(stitchGroup(group)));
  }
  return merged;
}

export function bridgeArchMetres(lengthMetres: number) {
  // Visual estimate: the transportation tiles do not supply measured deck heights.
  // Keep short bridges unchanged and interpolate continuously as tile spans grow.
  if (lengthMetres <= BRIDGE_ARCH_STOPS[0][0]) {
    return Math.min(SHORT_BRIDGE_MAX_ARCH_METERS, Math.max(0.5, lengthMetres * ARCH_PER_METRE));
  }
  for (let index = 1; index < BRIDGE_ARCH_STOPS.length; index += 1) {
    const [endLength, endRise] = BRIDGE_ARCH_STOPS[index];
    if (lengthMetres > endLength) continue;
    const [startLength, startRise] = BRIDGE_ARCH_STOPS[index - 1];
    return startRise + (endRise - startRise) * (lengthMetres - startLength) / (endLength - startLength);
  }
  return BRIDGE_ARCH_STOPS[BRIDGE_ARCH_STOPS.length - 1][1];
}

export function bridgeDeckElevations(ground: number[], layer: number, lengthMetres = 80) {
  if (ground.length === 0) return { deck: [] as number[], maxClearance: 0 };
  const start = ground[0];
  const end = ground[ground.length - 1];
  const arch = bridgeArchMetres(lengthMetres) + layer * LAYER_SEPARATION_METERS;
  const deck = ground.map((groundElevation, index) => {
    const t = ground.length === 1 ? 0 : index / (ground.length - 1);
    return surfaceElevation(t, groundElevation, start, end, arch);
  });
  let maxClearance = 0;
  for (let index = 0; index < ground.length; index += 1) {
    maxClearance = Math.max(maxClearance, deck[index] - ground[index]);
  }
  return { deck, maxClearance };
}

type BridgeClearanceProbe = {
  point: PlanPoint;
  vertices: [number, number, number];
  weights: [number, number, number];
};

/** Sample triangle interiors and long edges without adding mesh vertices. */
export function bridgeClearanceProbes(points: PlanPoint[], indices: number[], spanLength: number): BridgeClearanceProbe[] {
  const triangleCount = Math.floor(indices.length / 3);
  const count = Math.min(triangleCount, MAX_CLEARANCE_PROBES / 2, Math.max(1, Math.ceil(spanLength / 20)));
  const probes: BridgeClearanceProbe[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const triangle = count === 1 ? 0 : Math.round(slot * (triangleCount - 1) / (count - 1));
    const vertices = indices.slice(triangle * 3, triangle * 3 + 3) as [number, number, number];
    const corners = vertices.map((index) => points[index]);
    let longest = 0;
    let length = -1;
    for (let edge = 0; edge < 3; edge += 1) {
      const next = (edge + 1) % 3;
      const distance = Math.hypot(corners[edge].east - corners[next].east, corners[edge].north - corners[next].north);
      if (distance > length) {
        longest = edge;
        length = distance;
      }
    }
    const midpoint: [number, number, number] = [0, 0, 0];
    midpoint[longest] = 0.5;
    midpoint[(longest + 1) % 3] = 0.5;
    for (const weights of [[1 / 3, 1 / 3, 1 / 3] as [number, number, number], midpoint]) {
      probes.push({
        vertices, weights,
        point: {
          east: corners.reduce((sum, point, index) => sum + point.east * weights[index], 0),
          north: corners.reduce((sum, point, index) => sum + point.north * weights[index], 0),
        },
      });
    }
  }
  return probes;
}

/** Split triangles at shared parameter stations, reusing edge intersections. */
export function splitBridgeMesh<T extends PlanPoint>(
  source: T[], sourceIndices: number[], cuts: number[], parameter: (point: T) => number,
) {
  const points = source.slice();
  let polygons = Array.from({ length: sourceIndices.length / 3 }, (_, index) => sourceIndices.slice(index * 3, index * 3 + 3));
  // Retain convex clipped polygons until all cuts are complete. Triangulating
  // after each cut creates new diagonals that subsequent cuts split needlessly.
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    const intersections = new Map<string, number>();
    const intersect = (a: number, b: number) => {
      if (Math.abs(parameter(points[a]) - cut) < 1e-10) return a;
      if (Math.abs(parameter(points[b]) - cut) < 1e-10) return b;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const existing = intersections.get(key);
      if (existing !== undefined) return existing;
      const fraction = (cut - parameter(points[a])) / (parameter(points[b]) - parameter(points[a]));
      const point = { ...points[a] };
      for (const name of Object.keys(point) as Array<keyof T>) {
        const start = points[a][name];
        const end = points[b][name];
        if (typeof start === 'number' && typeof end === 'number') {
          point[name] = (start + (end - start) * fraction) as T[keyof T];
        }
      }
      const index = points.length;
      points.push(point);
      intersections.set(key, index);
      return index;
    };
    const next: number[][] = [];
    for (const triangle of polygons) {
      const values = triangle.map((index) => parameter(points[index]));
      if (Math.min(...values) >= cut - 1e-10 || Math.max(...values) <= cut + 1e-10) {
        next.push(triangle);
        continue;
      }
      for (const sign of [-1, 1]) {
        const polygon: number[] = [];
        for (let edge = 0; edge < triangle.length; edge += 1) {
          const a = triangle[edge];
          const b = triangle[(edge + 1) % triangle.length];
          const insideA = sign * (parameter(points[a]) - cut) >= 0;
          const insideB = sign * (parameter(points[b]) - cut) >= 0;
          if (insideA) polygon.push(a);
          if (insideA !== insideB) polygon.push(intersect(a, b));
        }
        const unique = polygon.filter((value, index) => polygon.indexOf(value) === index);
        if (unique.length >= 3) next.push(unique);
      }
    }
    polygons = next;
  }
  const indices: number[] = [];
  for (const polygon of polygons) {
    for (let index = 1; index + 1 < polygon.length; index += 1) {
      indices.push(polygon[0], polygon[index], polygon[index + 1]);
    }
  }
  return { points, indices };
}

export function refineBridgeApproaches(points: PlanPoint[], indices: number[], t: number[], spanLength: number) {
  const approach = Math.min(ABUTMENT_EXTEND_METRES, spanLength / 4);
  const cuts = [0.2, 0.5, 0.8, 1].flatMap((fraction) => {
    const value = fraction * approach / Math.max(1, spanLength);
    return [value, 1 - value];
  }).sort((a, b) => a - b);
  const refined = splitBridgeMesh(points.map((point, index) => ({ ...point, t: t[index] })), indices, cuts, (point) => point.t);
  return { points: refined.points.map(({ east, north }) => ({ east, north })),
    indices: refined.indices, t: refined.points.map((point) => point.t) };
}

/** Polygon triangulation can join opposite ends; cut it before applying the arch. */
export function refineBridgeSpan(points: PlanPoint[], indices: number[], t: number[], spanLength: number) {
  const steps = Math.min(64, Math.max(2, Math.ceil(spanLength / SAMPLE_SPACING_METERS)));
  const cuts = Array.from({ length: steps - 1 }, (_, index) => (index + 1) / steps);
  const refined = splitBridgeMesh(points.map((point, index) => ({ ...point, t: t[index] })), indices, cuts, (point) => point.t);
  return { points: refined.points.map(({ east, north }) => ({ east, north })),
    indices: refined.indices, t: refined.points.map((point) => point.t) };
}

/** Ease the existing approach extension into terrain without changing the main span. */
export function bridgeApproachMix(t: number, spanLength: number) {
  const distance = Math.max(0, Math.min(t, 1 - t)) * spanLength;
  const approach = Math.min(ABUTMENT_EXTEND_METRES, spanLength / 4);
  const u = Math.min(1, distance / Math.max(1, approach));
  return u * u * (3 - 2 * u);
}

export function bridgeSurfaceClearance(t: number, spanLength: number) {
  // A small offset avoids coplanar flicker where the deck meets the draped road.
  return 0.06 + (DECK_WATER_CLEARANCE_METRES - 0.06) * bridgeApproachMix(t, spanLength);
}

/** Raise only obstructed sections, spreading lift along the span without lowering clearance. */
export function terrainClearedDeck(
  t: number[],
  deck: number[],
  ground: number[],
  spanLength: number,
  probes: Array<BridgeClearanceProbe & { ground: number }> = [],
) {
  const required = deck.map((height, index) => Math.max(0, ground[index] + bridgeSurfaceClearance(t[index], spanLength) - height));
  for (const probe of probes) {
    const height = probe.vertices.reduce((sum, vertex, index) => sum + deck[vertex] * probe.weights[index], 0);
    const probeT = probe.vertices.reduce((sum, vertex, index) => sum + t[vertex] * probe.weights[index], 0);
    const lift = Math.max(0, probe.ground + bridgeSurfaceClearance(probeT, spanLength) - height);
    // Applying the deficit to each contributing vertex also clears the interpolated
    // triangle, rather than only lifting a theoretical profile between vertices.
    probe.vertices.forEach((vertex, index) => {
      if (probe.weights[index] > 0) required[vertex] = Math.max(required[vertex], lift);
    });
  }
  if (!required.some((lift) => lift > 1e-6)) return deck;
  const stations = new Map<number, number>();
  const keys = t.map((value) => Math.round(value * 1e6) / 1e6);
  keys.forEach((key, index) => stations.set(key, Math.max(stations.get(key) ?? 0, required[index])));
  const ordered = [...stations.keys()].sort((left, right) => left - right);
  const lifts = ordered.map((key) => stations.get(key)!);
  // A slope-limited upper envelope keeps the correction continuous and leaves
  // unaffected approaches alone. Equal span stations receive equal lift across width.
  for (let index = 1; index < lifts.length; index += 1) {
    const fall = (ordered[index] - ordered[index - 1]) * spanLength * CLEARANCE_LIFT_SLOPE;
    lifts[index] = Math.max(lifts[index], lifts[index - 1] - fall);
  }
  for (let index = lifts.length - 2; index >= 0; index -= 1) {
    const fall = (ordered[index + 1] - ordered[index]) * spanLength * CLEARANCE_LIFT_SLOPE;
    lifts[index] = Math.max(lifts[index], lifts[index + 1] - fall);
  }
  ordered.forEach((key, index) => stations.set(key, lifts[index]));
  return deck.map((height, index) => height + stations.get(keys[index])!);
}

export function surfaceElevation(
  t: number,
  _ground: number,
  start: number,
  end: number,
  arch: number,
) {
  const clamped = Math.min(1, Math.max(0, t));
  const chord = start + (end - start) * clamped;
  return chord + Math.sin(Math.PI * clamped) ** 2 * arch;
}

function uniquePlanPoints(points: PlanPoint[]) {
  const seen = new Set<string>();
  const unique: PlanPoint[] = [];
  for (const point of points) {
    const key = `${point.east.toFixed(2)}:${point.north.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

function cross(origin: PlanPoint, left: PlanPoint, right: PlanPoint) {
  return (left.east - origin.east) * (right.north - origin.north)
    - (left.north - origin.north) * (right.east - origin.east);
}

function boundsOverlap(left: PlanBounds, right: PlanBounds) {
  return left.minEast <= right.maxEast && left.maxEast >= right.minEast
    && left.minNorth <= right.maxNorth && left.maxNorth >= right.minNorth;
}

export function convexHull(points: PlanPoint[]) {
  const unique = uniquePlanPoints(points);
  if (unique.length <= 2) return unique.slice();
  const sorted = unique.slice().sort((left, right) => (
    left.east === right.east ? left.north - right.north : left.east - right.east
  ));
  const lower: PlanPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: PlanPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function offsetPolyline(points: PlanPoint[], distance: number) {
  if (points.length < 2) return points.slice();
  const left: PlanPoint[] = [];
  const right: PlanPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const east = next.east - previous.east;
    const north = next.north - previous.north;
    const length = Math.hypot(east, north) || 1;
    const normalEast = (-north / length) * distance;
    const normalNorth = (east / length) * distance;
    left.push({ east: points[index].east + normalEast, north: points[index].north + normalNorth });
    right.push({ east: points[index].east - normalEast, north: points[index].north - normalNorth });
  }
  return left.concat(right.reverse());
}

export function spanAxis(points: PlanPoint[], preferred?: PlanPoint) {
  if (preferred && (preferred.east !== 0 || preferred.north !== 0)) {
    const length = Math.hypot(preferred.east, preferred.north) || 1;
    return { east: preferred.east / length, north: preferred.north / length };
  }
  let originEast = 0;
  let originNorth = 0;
  for (const point of points) {
    originEast += point.east;
    originNorth += point.north;
  }
  originEast /= Math.max(1, points.length);
  originNorth /= Math.max(1, points.length);
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.east - originEast;
    const dy = point.north - originNorth;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const next = xx - yy;
  const angle = 0.5 * Math.atan2(2 * xy, next === 0 ? 1e-9 : next);
  return { east: Math.cos(angle), north: Math.sin(angle) };
}

export function projectSpan(point: PlanPoint, origin: PlanPoint, axis: PlanPoint) {
  return (point.east - origin.east) * axis.east + (point.north - origin.north) * axis.north;
}

export function pointInRing(point: PlanPoint, ring: PlanPoint[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const last = ring[previous];
    const intersects = (current.north > point.north) !== (last.north > point.north)
      && point.east < (
        (last.east - current.east) * (point.north - current.north)
        / ((last.north - current.north) || 1e-9)
      ) + current.east;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInFilledPolygon(point: PlanPoint, outer: PlanPoint[], holes: PlanPoint[][] = []) {
  if (!pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

export function densifyPlanLine(points: PlanPoint[], spacingMeters: number) {
  if (points.length < 2) return points.slice();
  const densified: PlanPoint[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.east - start.east, end.north - start.north);
    const steps = Math.max(1, Math.floor(length / spacingMeters));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      densified.push({
        east: start.east + (end.east - start.east) * t,
        north: start.north + (end.north - start.north) * t,
      });
    }
  }
  return densified;
}

export function lineRibbonMesh(plan: PlanPoint[], width: number) {
  const densified = densifyPlanLine(plan, SAMPLE_SPACING_METERS);
  if (densified.length < 2) return { points: [] as PlanPoint[], indices: [] as number[], t: [] as number[] };
  const half = width / 2 + 0.35;
  const points: PlanPoint[] = [];
  const t: number[] = [];
  const indices: number[] = [];
  const totalLength = planLineLength(densified);
  let distance = 0;
  for (let index = 0; index < densified.length; index += 1) {
    if (index > 0) distance += Math.hypot(densified[index].east - densified[index - 1].east,
      densified[index].north - densified[index - 1].north);
    const previous = densified[Math.max(0, index - 1)];
    const next = densified[Math.min(densified.length - 1, index + 1)];
    const east = next.east - previous.east;
    const north = next.north - previous.north;
    const length = Math.hypot(east, north) || 1;
    const normalEast = (-north / length) * half;
    const normalNorth = (east / length) * half;
    points.push(
      { east: densified[index].east + normalEast, north: densified[index].north + normalNorth },
      { east: densified[index].east - normalEast, north: densified[index].north - normalNorth },
    );
    const parameter = totalLength > 0 ? distance / totalLength : 0;
    t.push(parameter, parameter);
    if (index === 0) continue;
    const vertex = points.length - 4;
    indices.push(vertex, vertex + 1, vertex + 3, vertex, vertex + 3, vertex + 2);
  }
  return { points, indices, t };
}

export function parallelBundleRibbon(lines: BridgeDrawable[]) {
  const usable = lines.filter((line) => line.kind === 'line' && line.plan.length >= 2);
  if (usable.length === 0) return { points: [] as PlanPoint[], indices: [] as number[], t: [] as number[] };
  if (usable.length === 1) return lineRibbonMesh(usable[0].plan, usable[0].width);
  const spine = usable.slice().sort((left, right) => (
    lineLengthMetres(right.coordinates) - lineLengthMetres(left.coordinates)
  ))[0];
  const densified = densifyPlanLine(spine.plan, SAMPLE_SPACING_METERS);
  if (densified.length < 2) return lineRibbonMesh(spine.plan, spine.width);
  const points: PlanPoint[] = [];
  const t: number[] = [];
  const indices: number[] = [];
  const totalLength = planLineLength(densified);
  let distance = 0;
  for (let index = 0; index < densified.length; index += 1) {
    if (index > 0) distance += Math.hypot(densified[index].east - densified[index - 1].east,
      densified[index].north - densified[index - 1].north);
    const previous = densified[Math.max(0, index - 1)];
    const next = densified[Math.min(densified.length - 1, index + 1)];
    const east = next.east - previous.east;
    const north = next.north - previous.north;
    const length = Math.hypot(east, north) || 1;
    const normalEast = -north / length;
    const normalNorth = east / length;
    const spinePoint = densified[index];
    let minLateral = -spine.width / 2 - 0.35;
    let maxLateral = spine.width / 2 + 0.35;
    for (const line of usable) {
      const nearest = closestPointOnPolyline(spinePoint, line.plan);
      if (Math.hypot(nearest.east - spinePoint.east, nearest.north - spinePoint.north) > 28) continue;
      const lateral = (nearest.east - spinePoint.east) * normalEast
        + (nearest.north - spinePoint.north) * normalNorth;
      const half = line.width / 2 + 0.35;
      minLateral = Math.min(minLateral, lateral - half);
      maxLateral = Math.max(maxLateral, lateral + half);
    }
    points.push(
      { east: spinePoint.east + normalEast * maxLateral, north: spinePoint.north + normalNorth * maxLateral },
      { east: spinePoint.east + normalEast * minLateral, north: spinePoint.north + normalNorth * minLateral },
    );
    const parameter = totalLength > 0 ? distance / totalLength : 0;
    t.push(parameter, parameter);
    if (index === 0) continue;
    const vertex = points.length - 4;
    indices.push(vertex, vertex + 1, vertex + 3, vertex, vertex + 3, vertex + 2);
  }
  return { points, indices, t };
}

function ribbonToRing(ribbon: { points: PlanPoint[] }) {
  const left: PlanPoint[] = [];
  const right: PlanPoint[] = [];
  for (let index = 0; index + 1 < ribbon.points.length; index += 2) {
    left.push(ribbon.points[index]);
    right.push(ribbon.points[index + 1]);
  }
  if (left.length < 2) return [];
  return left.concat(right.reverse());
}

function closestPointOnPolyline(point: PlanPoint, line: PlanPoint[]) {
  if (line.length === 0) return point;
  if (line.length === 1) return line[0];
  let best = line[0];
  let bestDistance = Infinity;
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    const east = end.east - start.east;
    const north = end.north - start.north;
    const lengthSquared = east * east + north * north;
    const mix = lengthSquared < 1e-9 ? 0 : Math.min(1, Math.max(0, (
      (point.east - start.east) * east + (point.north - start.north) * north
    ) / lengthSquared));
    const candidate = { east: start.east + east * mix, north: start.north + north * mix };
    const distance = Math.hypot(point.east - candidate.east, point.north - candidate.north);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function densifyRing(points: PlanPoint[], spacingMeters: number) {
  if (points.length < 2) return points.slice();
  const densified: PlanPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    densified.push(start);
    const length = Math.hypot(end.east - start.east, end.north - start.north);
    const steps = Math.max(1, Math.floor(length / spacingMeters));
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      densified.push({
        east: start.east + (end.east - start.east) * t,
        north: start.north + (end.north - start.north) * t,
      });
    }
  }
  return densified;
}

function isInsideHoleOnly(inner: BridgeDrawable, outer: BridgeDrawable) {
  if (outer.kind !== 'polygon' || !outer.holes?.length || inner.plan.length === 0) return false;
  return inner.plan.every((point) => (
    !pointInFilledPolygon(point, outer.plan, outer.holes)
    && outer.holes!.some((hole) => pointInRing(point, hole))
  ));
}

function polylineSeparation(
  left: PlanPoint[],
  right: PlanPoint[],
  leftClosed = false,
  rightClosed = false,
) {
  if (left.length === 0 || right.length === 0) return Infinity;
  let min = Infinity;
  for (const point of left) min = Math.min(min, pointToPolyline(point, right, rightClosed));
  for (const point of right) min = Math.min(min, pointToPolyline(point, left, leftClosed));
  return min;
}

function pointToPolyline(point: PlanPoint, line: PlanPoint[], closed = false) {
  if (line.length === 0) return Infinity;
  if (line.length === 1) {
    return Math.hypot(point.east - line[0].east, point.north - line[0].north);
  }
  let min = Infinity;
  const segments = closed ? line.length : line.length - 1;
  for (let index = 0; index < segments; index += 1) {
    min = Math.min(min, pointToSegment(point, line[index], line[(index + 1) % line.length]));
  }
  return min;
}

function pointToSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint) {
  const east = end.east - start.east;
  const north = end.north - start.north;
  const lengthSquared = east * east + north * north;
  if (lengthSquared < 1e-9) {
    return Math.hypot(point.east - start.east, point.north - start.north);
  }
  const t = Math.min(1, Math.max(0, (
    (point.east - start.east) * east + (point.north - start.north) * north
  ) / lengthSquared));
  return Math.hypot(point.east - (start.east + east * t), point.north - (start.north + north * t));
}

function polygonsTouch(left: BridgeDrawable, right: BridgeDrawable) {
  if (left.kind !== 'polygon' || right.kind !== 'polygon') return false;
  if (isInsideHoleOnly(left, right) || isInsideHoleOnly(right, left)) return false;
  if (left.plan.some((point) => pointInFilledPolygon(point, right.plan, right.holes))) return true;
  if (right.plan.some((point) => pointInFilledPolygon(point, left.plan, left.holes))) return true;
  return polylineSeparation(left.plan, right.plan, true, true) <= POLYGON_TOUCH_METRES;
}

export function lineBelongsToPolygon(line: BridgeDrawable, polygon: BridgeDrawable) {
  if (line.kind !== 'line' || polygon.kind !== 'polygon' || line.plan.length === 0) return false;
  if (isInsideHoleOnly(line, polygon)) return false;
  const samples = line.plan.length <= 12 ? line.plan : densifyPlanLine(line.plan, 20);
  const reach = line.width / 2 + 1.5;
  const hits = samples.filter((point) => coveredByPolygon(point, polygon, reach));
  return hits.length >= Math.max(1, Math.ceil(samples.length * 0.12))
    || coveredByPolygon(line.plan[0], polygon, reach)
    || coveredByPolygon(line.plan[line.plan.length - 1], polygon, reach);
}

function coveredByPolygon(point: PlanPoint, polygon: BridgeDrawable, reach: number) {
  return pointInFilledPolygon(point, polygon.plan, polygon.holes)
    || pointToPolyline(point, polygon.plan, true) <= reach;
}

export function clusterBridgeDrawables(drawables: BridgeDrawable[]) {
  if (drawables.length === 0) return [] as BridgeDrawable[][];
  const polygons = drawables.filter((drawable) => drawable.kind === 'polygon');
  const lines = drawables.filter((drawable) => drawable.kind === 'line');
  const parent = polygons.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]);
    return parent[index];
  };
  for (let left = 0; left < polygons.length; left += 1) {
    for (let right = left + 1; right < polygons.length; right += 1) {
      if (!polygonsFormOneSpan(polygons[left], polygons[right])) continue;
      const rootLeft = find(left);
      const rootRight = find(right);
      if (rootLeft !== rootRight) parent[rootRight] = rootLeft;
    }
  }
  const polygonGroups = new Map<number, BridgeDrawable[]>();
  polygons.forEach((polygon, index) => {
    const root = find(index);
    const group = polygonGroups.get(root);
    if (group) group.push(polygon);
    else polygonGroups.set(root, [polygon]);
  });

  const assigned = new Set<BridgeDrawable>();
  const groups: BridgeDrawable[][] = [];
  for (const polygonGroup of polygonGroups.values()) {
    const members = [...polygonGroup];
    for (const line of lines) {
      if (assigned.has(line)) continue;
      if (!polygonGroup.some((polygon) => lineBelongsToPolygon(line, polygon))) continue;
      members.push(line);
      assigned.add(line);
    }
    groups.push(members);
  }
  for (const line of lines) {
    if (!assigned.has(line)) groups.push([line]);
  }
  return regroupCompactPathJunctions(
    regroupParallelLineClusters(groups.flatMap(splitInterchangeCluster)),
  ).filter(keepDeckGroup);
}

function isPathClass(className: string) {
  return className === 'path' || className === 'track' || className === 'path_construction';
}

function lineHeading(plan: PlanPoint[]) {
  const start = plan[0];
  const end = plan[plan.length - 1];
  const length = Math.hypot(end.east - start.east, end.north - start.north) || 1;
  return {
    east: (end.east - start.east) / length,
    north: (end.north - start.north) / length,
  };
}

function linesDiverge(lines: BridgeDrawable[]) {
  const headings = lines
    .filter((line) => line.kind === 'line' && line.plan.length >= 2)
    .map((line) => lineHeading(line.plan));
  for (let left = 0; left < headings.length; left += 1) {
    for (let right = left + 1; right < headings.length; right += 1) {
      const dot = Math.abs(
        headings[left].east * headings[right].east + headings[left].north * headings[right].north,
      );
      if (dot < LINE_CONTINUATION_DOT) return true;
    }
  }
  return false;
}

export function linesFormParallelBundle(left: BridgeDrawable, right: BridgeDrawable) {
  if (left.kind !== 'line' || right.kind !== 'line') return false;
  if (left.properties.layer !== right.properties.layer) return false;
  if (left.plan.length < 2 || right.plan.length < 2) return false;
  const headingLeft = lineHeading(left.plan);
  const headingRight = lineHeading(right.plan);
  if (Math.abs(headingLeft.east * headingRight.east + headingLeft.north * headingRight.north) < PARALLEL_BUNDLE_DOT) {
    return false;
  }
  const origin = left.plan[0];
  const leftSpan = left.plan.map((point) => projectSpan(point, origin, headingLeft));
  const rightSpan = right.plan.map((point) => projectSpan(point, origin, headingLeft));
  const overlap = Math.min(Math.max(...leftSpan), Math.max(...rightSpan))
    - Math.max(Math.min(...leftSpan), Math.min(...rightSpan));
  const shorter = Math.min(
    Math.max(...leftSpan) - Math.min(...leftSpan),
    Math.max(...rightSpan) - Math.min(...rightSpan),
  );
  if (overlap < Math.max(12, shorter * 0.45)) return false;
  const samples = left.plan.length <= 10 ? left.plan : densifyPlanLine(left.plan, 24);
  let total = 0;
  let count = 0;
  for (const point of samples) {
    const distance = pointToPolyline(point, right.plan);
    if (distance > 40) continue;
    total += distance;
    count += 1;
  }
  if (count < 2) return false;
  return (total / count) <= (left.width + right.width) / 2 + 5;
}

function regroupParallelLineClusters(groups: BridgeDrawable[][]) {
  const withPolygons = groups.filter((group) => group.some((drawable) => drawable.kind === 'polygon'));
  const lineGroups = groups.filter((group) => (
    group.length > 0 && group.every((drawable) => drawable.kind === 'line')
  ));
  if (lineGroups.length <= 1) return groups;
  return [...withPolygons, ...unionDrawableGroups(lineGroups, (left, right) => (
    left.some((first) => right.some((second) => linesFormParallelBundle(first, second)))
  ))];
}

function regroupCompactPathJunctions(groups: BridgeDrawable[][]) {
  return unionDrawableGroups(groups, pathClustersFormCompactJunction);
}

function unionDrawableGroups(
  groups: BridgeDrawable[][],
  shouldMerge: (left: BridgeDrawable[], right: BridgeDrawable[]) => boolean,
) {
  if (groups.length <= 1) return groups;
  const parent = groups.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]);
    return parent[index];
  };
  for (let left = 0; left < groups.length; left += 1) {
    for (let right = left + 1; right < groups.length; right += 1) {
      if (!shouldMerge(groups[left], groups[right])) continue;
      const rootLeft = find(left);
      const rootRight = find(right);
      if (rootLeft !== rootRight) parent[rootRight] = rootLeft;
    }
  }
  const merged = new Map<number, BridgeDrawable[]>();
  groups.forEach((group, index) => {
    const root = find(index);
    const current = merged.get(root);
    if (current) current.push(...group);
    else merged.set(root, [...group]);
  });
  return [...merged.values()];
}

function drawableArea(drawable: BridgeDrawable) {
  if (drawable.kind !== 'polygon') return 0;
  const holes = drawable.holes ?? [];
  return polygonAreaMetres(drawable.plan) - holes.reduce((sum, hole) => sum + polygonAreaMetres(hole), 0);
}

function polygonsFormOneSpan(left: BridgeDrawable, right: BridgeDrawable) {
  if (polygonsTouch(left, right)) return true;
  if (left.kind !== 'polygon' || right.kind !== 'polygon') return false;
  if (isInsideHoleOnly(left, right) || isInsideHoleOnly(right, left)) return false;
  const separation = polylineSeparation(left.plan, right.plan, true, true);
  if (separation > POLYGON_SPAN_GAP_METRES) return false;
  const axis = spanAxis([...left.plan, ...right.plan]);
  const origin = left.plan[0];
  const leftSpan = left.plan.map((point) => projectSpan(point, origin, axis));
  const rightSpan = right.plan.map((point) => projectSpan(point, origin, axis));
  const leftMin = Math.min(...leftSpan);
  const leftMax = Math.max(...leftSpan);
  const rightMin = Math.min(...rightSpan);
  const rightMax = Math.max(...rightSpan);
  const overlap = Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin);
  if (overlap > 6) return false;
  const gap = overlap < 0 ? -overlap : 0;
  return gap <= POLYGON_SPAN_GAP_METRES;
}

function splitInterchangeCluster(group: BridgeDrawable[]): BridgeDrawable[][] {
  const polygons = group.filter((drawable) => drawable.kind === 'polygon');
  const lines = group.filter((drawable) => drawable.kind === 'line');
  const roads = lines.filter((line) => !isPathClass(line.properties.className));
  if (polygons.length === 0) return [group];
  const area = polygons.reduce((sum, polygon) => sum + drawableArea(polygon), 0);
  const explode = area > INTERCHANGE_DECK_AREA_METRES && roads.length >= 2 && linesDiverge(roads);
  if (!explode) return [group];
  return lines.map((line) => [line]);
}

function polygonCoveredByLine(polygon: BridgeDrawable, line: BridgeDrawable) {
  if (polygon.kind !== 'polygon' || line.kind !== 'line' || polygon.plan.length < 3) return false;
  const samples = densifyRing(polygon.plan, 18);
  const reach = Math.max(4, line.width / 2 + 3);
  const hits = samples.filter((point) => pointToPolyline(point, line.plan) <= reach);
  return hits.length >= Math.max(3, Math.ceil(samples.length * 0.55));
}

function keepDeckGroup(group: BridgeDrawable[], _index: number, groups: BridgeDrawable[][]) {
  const polygons = group.filter((drawable) => drawable.kind === 'polygon');
  const lines = group.filter((drawable) => drawable.kind === 'line');
  if (polygons.length === 0 || lines.length > 0) return true;
  const otherLines = groups.flatMap((other) => other.filter((drawable) => drawable.kind === 'line'));
  if (polygonLooksLikeWideDeck(polygons, otherLines)) return true;
  return !polygons.every((polygon) => otherLines.some((line) => polygonCoveredByLine(polygon, line)));
}

function deckSurfaceFromPolygon(polygon: BridgeDrawable): DeckSurface {
  return {
    outer: polygon.plan,
    holes: (polygon.holes ?? []).filter((hole) => hole.length >= 3),
  };
}

function mergeDeckFragments(polygons: BridgeDrawable[]): DeckSurface[] {
  if (polygons.length === 1) return [deckSurfaceFromPolygon(polygons[0])];
  const holes = polygons.flatMap((polygon) => (polygon.holes ?? []).filter((hole) => hole.length >= 3));
  const hull = convexHull(polygons.flatMap((polygon) => polygon.plan));
  if (hull.length >= 3) {
    const hullArea = polygonAreaMetres(hull);
    const sumArea = polygons.reduce((sum, polygon) => sum + drawableArea(polygon), 0);
    if (deckAreaAllowed(hull, holes)
      && (hullArea <= sumArea * DECK_FRAGMENT_HULL_SLACK || hullArea - sumArea <= DECK_FRAGMENT_EXTRA_METRES)) {
      return [{ outer: hull, holes }];
    }
  }
  return polygons.map(deckSurfaceFromPolygon);
}

export function clusterSurfaces(drawables: BridgeDrawable[]): DeckSurface[] {
  const polygons = drawables.filter((drawable) => drawable.kind === 'polygon' && drawable.plan.length >= 3);
  const lines = drawables.filter((drawable) => drawable.kind === 'line' && drawable.plan.length >= 2);
  if (polygons.length > 0 && polygonLooksLikeWideDeck(polygons, lines)) {
    return mergeDeckFragments(polygons);
  }
  const pathDeck = compactPathJunctionSurface(drawables);
  if (pathDeck) return [pathDeck];
  if (lines.length >= 2 && !linesDiverge(lines)) {
    const ribbon = parallelBundleRibbon(lines);
    const outer = ribbonToRing(ribbon);
    if (outer.length >= 3) return [{ outer, holes: [] }];
  }
  if (polygons.length > 0) {
    return mergeDeckFragments(polygons);
  }
  return lines
    .map((line) => ({
      outer: offsetPolyline(line.plan, line.width / 2 + 0.4),
      holes: [],
    }))
    .filter((surface) => surface.outer.length >= 3);
}

function polygonWidthMetres(outer: PlanPoint[]) {
  if (outer.length < 2) return 0;
  const axis = spanAxis(outer);
  const perp = { east: -axis.north, north: axis.east };
  const projections = outer.map((point) => point.east * perp.east + point.north * perp.north);
  return Math.max(...projections) - Math.min(...projections);
}

function lineMostlyCoveredByPolygons(line: BridgeDrawable, polygons: BridgeDrawable[]) {
  const samples = densifyPlanLine(line.plan, SAMPLE_SPACING_METERS);
  if (samples.length === 0) return false;
  const reach = Math.max(2, line.width / 2 + 1.5);
  const covered = samples.filter((point) => (
    polygons.some((polygon) => coveredByPolygon(point, polygon, reach))
  )).length;
  return covered >= Math.ceil(samples.length * 0.8);
}

function polygonLooksLikeWideDeck(polygons: BridgeDrawable[], lines: BridgeDrawable[]) {
  const area = polygons.reduce((sum, polygon) => sum + drawableArea(polygon), 0);
  if (area < MIN_POLYGON_MESH_AREA_METRES) return false;
  if (lines.length > 0 && lines.every((line) => lineMostlyCoveredByPolygons(line, polygons))) return true;
  const width = Math.max(...polygons.map((polygon) => polygonWidthMetres(polygon.plan)));
  const polygonSpan = surfaceSpanLength(polygons.map(deckSurfaceFromPolygon));
  const lineSpan = lines.length > 0
    ? Math.max(...lines.map((line) => lineLengthMetres(line.coordinates)))
    : 0;
  if (lineSpan > polygonSpan + 30 && lineSpan > polygonSpan * 1.2) return false;
  if (width >= 14) return true;
  if (width >= 8 && (lines.length === 0 || lineSpan <= polygonSpan * 1.45)) return true;
  return false;
}

function isPathOnlyCluster(drawables: BridgeDrawable[]) {
  return drawables.length > 0
    && drawables.every((drawable) => isPathClass(drawable.properties.className));
}

function linesConnectAtJunction(lines: BridgeDrawable[]) {
  const usable = lines.filter((line) => line.kind === 'line' && line.plan.length >= 2);
  for (let left = 0; left < usable.length; left += 1) {
    for (let right = left + 1; right < usable.length; right += 1) {
      const first = usable[left].plan;
      const second = usable[right].plan;
      const ends = [first[0], first[first.length - 1]];
      const otherEnds = [second[0], second[second.length - 1]];
      if (ends.some((end) => otherEnds.some((other) => (
        Math.hypot(end.east - other.east, end.north - other.north) <= 8
      )))) {
        return true;
      }
      if (polylineSeparation(first, second) <= 4) return true;
    }
  }
  return false;
}

function pathClustersFormCompactJunction(left: BridgeDrawable[], right: BridgeDrawable[]) {
  if (!isPathOnlyCluster(left) || !isPathOnlyCluster(right)) return false;
  const merged = [...left, ...right];
  const lines = merged.filter((drawable) => drawable.kind === 'line');
  const polygons = merged.filter((drawable) => drawable.kind === 'polygon');
  const decksTouch = polygons.some((first) => (
    polygons.some((second) => first !== second && polygonsFormOneSpan(first, second))
  ));
  if (lines.length >= 2 && !linesConnectAtJunction(lines) && !decksTouch) return false;
  if (lines.length < 2 && !decksTouch && polygons.length < 2) return false;
  return compactPathJunctionSurface(merged) !== null;
}

function compactPathJunctionSurface(drawables: BridgeDrawable[]): DeckSurface | null {
  if (!isPathOnlyCluster(drawables)) return null;
  const lines = drawables.filter((drawable) => drawable.kind === 'line' && drawable.plan.length >= 2);
  const polygons = drawables.filter((drawable) => drawable.kind === 'polygon' && drawable.plan.length >= 3);
  if (lines.length + polygons.length < 2) return null;
  if (lines.length >= 2 && !linesDiverge(lines) && polygons.length < 2) return null;
  if (lines.length >= 2 && !linesConnectAtJunction(lines) && polygons.length < 2) return null;
  const points = [
    ...polygons.flatMap((polygon) => polygon.plan),
    ...lines.flatMap((line) => offsetPolyline(line.plan, line.width / 2 + 0.4)),
  ];
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  const hullArea = polygonAreaMetres(hull);
  const partArea = polygons.reduce((sum, polygon) => sum + drawableArea(polygon), 0)
    + lines.reduce((sum, line) => sum + planLineLength(line.plan) * line.width, 0);
  if (hullArea < MIN_POLYGON_MESH_AREA_METRES) return null;
  if (hullArea > INTERCHANGE_DECK_AREA_METRES) return null;
  if (!deckAreaAllowed(hull)) return null;
  if (partArea > 0 && (hullArea > partArea * 5 || hullArea - partArea > 1_800)) return null;
  return { outer: hull, holes: [] };
}

export function clusterOutline(drawables: BridgeDrawable[]) {
  return clusterSurfaces(drawables)[0]?.outer ?? [];
}

export function triangulateDeckSurface(surface: DeckSurface, densifyBoundary = true) {
  const boundary = (ring: PlanPoint[]) => uniquePlanPoints(densifyBoundary
    ? densifyRing(ring, SAMPLE_SPACING_METERS) : ring);
  const outer = orientedRing(boundary(surface.outer), false);
  const holes = surface.holes
    .filter((hole) => hole.length >= 3)
    .map((hole) => orientedRing(boundary(hole), true));
  if (outer.length < 3) return null;
  const contour = outer.map((point) => new THREE.Vector2(point.east, point.north));
  const holeContours = holes.map((hole) => hole.map((point) => new THREE.Vector2(point.east, point.north)));
  let faces: number[][] = [];
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holeContours);
  } catch {
    return null;
  }
  const points = [...outer, ...holes.flat()];
  const indices: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    indices.push(face[0], face[1], face[2]);
  }
  if (indices.length < 3) return null;
  return { points, indices };
}

function signedRingArea(points: PlanPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].east * next.north - next.east * points[index].north;
  }
  return area / 2;
}

function orientedRing(points: PlanPoint[], clockwise: boolean) {
  const isClockwise = signedRingArea(points) < 0;
  return isClockwise === clockwise ? points.slice() : points.slice().reverse();
}

export function bridgeSurfaceStrip(outline: PlanPoint[], axis: PlanPoint, steps = 16, holes: PlanPoint[][] = []) {
  if (outline.length < 3) return { points: [] as PlanPoint[], indices: [] as number[], t: [] as number[] };
  const origin = outline[0];
  const projections = outline.map((point) => projectSpan(point, origin, axis));
  const minT = Math.min(...projections);
  const maxT = Math.max(...projections);
  const spanRange = Math.max(1, maxT - minT);
  const rings = [outline, ...holes.filter((hole) => hole.length >= 3)];
  const sections: Array<Array<{ left: PlanPoint; right: PlanPoint; t: number }>> = [];
  const count = Math.max(4, steps);
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const span = minT + spanRange * t;
    const hits = rings.flatMap((ring) => sectionHits(ring, origin, axis, span));
    const perp = { east: -axis.north, north: axis.east };
    hits.sort((left, right) => (
      (left.east * perp.east + left.north * perp.north)
      - (right.east * perp.east + right.north * perp.north)
    ));
    const uniqueHits: PlanPoint[] = [];
    for (const hit of hits) {
      const previous = uniqueHits[uniqueHits.length - 1];
      if (previous && Math.hypot(hit.east - previous.east, hit.north - previous.north) < 0.2) continue;
      uniqueHits.push(hit);
    }
    const intervals: Array<{ left: PlanPoint; right: PlanPoint; t: number }> = [];
    for (let hit = 0; hit + 1 < uniqueHits.length; hit += 2) {
      intervals.push({ left: uniqueHits[hit], right: uniqueHits[hit + 1], t });
    }
    if (intervals.length > 0) sections.push(intervals);
  }
  if (sections.length < 2) return { points: [] as PlanPoint[], indices: [] as number[], t: [] as number[] };
  const points: PlanPoint[] = [];
  const t: number[] = [];
  const indices: number[] = [];
  const appendInterval = (interval: { left: PlanPoint; right: PlanPoint; t: number }) => {
    const vertex = points.length;
    points.push(interval.left, interval.right);
    t.push(interval.t, interval.t);
    return vertex;
  };
  let previous = sections[0];
  let previousVertices = previous.map(appendInterval);
  for (let index = 1; index < sections.length; index += 1) {
    const current = sections[index];
    const currentVertices = current.map(appendInterval);
    for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) {
      const match = bestOverlappingInterval(previous[previousIndex], current, axis);
      if (match < 0) continue;
      const start = previousVertices[previousIndex];
      const end = currentVertices[match];
      indices.push(start, start + 1, end + 1, start, end + 1, end);
    }
    previous = current;
    previousVertices = currentVertices;
  }
  return { points, indices, t };
}

function bestOverlappingInterval(
  previous: { left: PlanPoint; right: PlanPoint },
  next: Array<{ left: PlanPoint; right: PlanPoint }>,
  axis: PlanPoint,
) {
  const perp = { east: -axis.north, north: axis.east };
  const project = (point: PlanPoint) => point.east * perp.east + point.north * perp.north;
  const prevMin = Math.min(project(previous.left), project(previous.right));
  const prevMax = Math.max(project(previous.left), project(previous.right));
  let best = -1;
  let bestOverlap = 0;
  next.forEach((interval, index) => {
    const min = Math.min(project(interval.left), project(interval.right));
    const max = Math.max(project(interval.left), project(interval.right));
    const overlap = Math.min(prevMax, max) - Math.max(prevMin, min);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = index;
    }
  });
  return bestOverlap > 0.5 ? best : -1;
}

function sectionHits(outline: PlanPoint[], origin: PlanPoint, axis: PlanPoint, span: number) {
  const perp = { east: -axis.north, north: axis.east };
  const hits: PlanPoint[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index];
    const end = outline[(index + 1) % outline.length];
    const startSpan = projectSpan(start, origin, axis);
    const endSpan = projectSpan(end, origin, axis);
    if ((startSpan - span) * (endSpan - span) > 0) continue;
    if (startSpan === endSpan) {
      if (Math.abs(startSpan - span) < 0.05) hits.push(start);
      continue;
    }
    const mix = (span - startSpan) / (endSpan - startSpan);
    hits.push({
      east: start.east + (end.east - start.east) * mix,
      north: start.north + (end.north - start.north) * mix,
    });
  }
  hits.sort((left, right) => (
    (left.east * perp.east + left.north * perp.north)
    - (right.east * perp.east + right.north * perp.north)
  ));
  return hits;
}

function averageOr(values: number[], fallback: number) {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clusterSpanLength(cluster: BridgeDrawable[]) {
  const lines = cluster.filter((drawable) => drawable.kind === 'line');
  if (lines.length > 0) {
    return Math.max(...lines.map((line) => lineLengthMetres(line.coordinates)));
  }
  return surfaceSpanLength(clusterSurfaces(cluster));
}

function surfaceSpanLength(surfaces: DeckSurface[]) {
  let span = 0;
  for (const surface of surfaces) {
    if (surface.outer.length < 2) continue;
    const axis = spanAxis(surface.outer);
    const projections = surface.outer.map((point) => projectSpan(point, surface.outer[0], axis));
    span = Math.max(span, Math.max(...projections) - Math.min(...projections));
  }
  return span;
}

function remapSpanParameter(points: PlanPoint[], origin: PlanPoint, axis: PlanPoint) {
  const projections = points.map((point) => projectSpan(point, origin, axis));
  const minT = Math.min(...projections);
  const maxT = Math.max(...projections);
  const spanRange = Math.max(1, maxT - minT);
  return projections.map((value) => (value - minT) / spanRange);
}

function lineOverhangsDeck(line: BridgeDrawable, polygons: BridgeDrawable[]) {
  if (line.plan.length < 2 || polygons.length === 0) return false;
  const reach = Math.max(3, line.width / 2 + 2);
  const covered = (point: PlanPoint) => polygons.some((polygon) => (
    pointInFilledPolygon(point, polygon.plan, polygon.holes)
    || pointToPolyline(point, polygon.plan, true) <= reach
  ));
  return !covered(line.plan[0]) || !covered(line.plan[line.plan.length - 1]);
}

export function extendPlanAbutments(plan: PlanPoint[], metres = ABUTMENT_EXTEND_METRES) {
  return extendPlanEnds(plan, true, true, metres);
}

export function shouldMeshClusterLines(
  lines: BridgeDrawable[],
  polygons: BridgeDrawable[],
  surfaces: DeckSurface[],
) {
  if (lines.length === 0) return false;
  if (polygonLooksLikeWideDeck(polygons, lines)) return false;
  if (compactPathJunctionSurface([...polygons, ...lines])) return false;
  if (polygons.length === 0) return true;
  if (lines.length >= 2 && !linesDiverge(lines)) return true;
  const lineSpan = Math.max(...lines.map((line) => lineLengthMetres(line.coordinates)));
  const polygonSpan = surfaceSpanLength(surfaces);
  if (lineSpan > polygonSpan + 30 && lineSpan > polygonSpan * 1.2) return true;
  const area = polygons.reduce((sum, polygon) => sum + drawableArea(polygon), 0);
  if (area >= MIN_POLYGON_MESH_AREA_METRES) return false;
  return lineSpan > polygonSpan * 1.2 || lines.some((line) => lineOverhangsDeck(line, polygons));
}

export function lineOverhangStubs(line: BridgeDrawable, polygons: BridgeDrawable[]) {
  if (line.kind !== 'line' || line.plan.length < 2 || polygons.length === 0) return [] as PlanPoint[][];
  const reach = Math.max(3, line.width / 2 + 2);
  const covered = (point: PlanPoint) => polygons.some((polygon) => (
    pointInFilledPolygon(point, polygon.plan, polygon.holes)
    || pointToPolyline(point, polygon.plan, true) <= reach
  ));
  const span = spanAxis(polygons.flatMap((polygon) => polygon.plan));
  const stubs: PlanPoint[][] = [];
  if (!covered(line.plan[0])) {
    const stub: PlanPoint[] = [line.plan[0]];
    for (let index = 1; index < line.plan.length; index += 1) {
      stub.push(line.plan[index]);
      if (covered(line.plan[index])) break;
    }
    if (isLongitudinalStub(stub, span)) stubs.push(overlapStubIntoDeck(stub, true));
  }
  if (!covered(line.plan[line.plan.length - 1])) {
    const stub: PlanPoint[] = [line.plan[line.plan.length - 1]];
    for (let index = line.plan.length - 2; index >= 0; index -= 1) {
      stub.push(line.plan[index]);
      if (covered(line.plan[index])) break;
    }
    stub.reverse();
    if (isLongitudinalStub(stub, span)) stubs.push(overlapStubIntoDeck(stub, false));
  }
  return stubs;
}

function isLongitudinalStub(stub: PlanPoint[], span: PlanPoint) {
  if (stub.length < 2) return false;
  const heading = lineHeading(stub);
  const along = Math.abs(heading.east * span.east + heading.north * span.north);
  if (along < 0.72) return false;
  const length = stub.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(point.east - stub[index].east, point.north - stub[index].north)
  ), 0);
  return length >= 2;
}

function overlapStubIntoDeck(stub: PlanPoint[], fromStart: boolean) {
  if (stub.length < 2) return stub;
  const inner = fromStart ? stub[stub.length - 1] : stub[0];
  const outer = fromStart ? stub[stub.length - 2] : stub[1];
  const length = Math.hypot(inner.east - outer.east, inner.north - outer.north) || 1;
  const extra = {
    east: inner.east + ((inner.east - outer.east) / length) * 2.5,
    north: inner.north + ((inner.north - outer.north) / length) * 2.5,
  };
  return fromStart ? [...stub, extra] : [extra, ...stub];
}

export function extendPlanEnds(
  plan: PlanPoint[],
  extendStart: boolean,
  extendEnd: boolean,
  metres = ABUTMENT_EXTEND_METRES,
) {
  if (plan.length < 2 || metres <= 0 || (!extendStart && !extendEnd)) return plan.slice();
  const next = plan.slice();
  if (extendStart) {
    const start = next[0];
    const startNext = next[1];
    const startLength = Math.hypot(start.east - startNext.east, start.north - startNext.north) || 1;
    next.unshift({
      east: start.east + ((start.east - startNext.east) / startLength) * metres,
      north: start.north + ((start.north - startNext.north) / startLength) * metres,
    });
  }
  if (extendEnd) {
    const end = next[next.length - 1];
    const endPrev = next[next.length - 2];
    const endLength = Math.hypot(end.east - endPrev.east, end.north - endPrev.north) || 1;
    next.push({
      east: end.east + ((end.east - endPrev.east) / endLength) * metres,
      north: end.north + ((end.north - endPrev.north) / endLength) * metres,
    });
  }
  return next;
}

export function extendClusterAbutments(cluster: BridgeDrawable[], origin: PlanOrigin) {
  const lines = cluster.filter((drawable) => drawable.kind === 'line' && drawable.plan.length >= 2);
  const polygons = cluster.filter((drawable) => drawable.kind === 'polygon');
  const axisSource = polygons.length > 0
    ? polygons.flatMap((polygon) => polygon.plan)
    : lines.flatMap((line) => line.plan);
  if (axisSource.length < 2) return cluster;
  const longest = lines
    .slice()
    .sort((left, right) => lineLengthMetres(right.coordinates) - lineLengthMetres(left.coordinates))[0];
  const preferred = longest
    ? {
      east: longest.plan[longest.plan.length - 1].east - longest.plan[0].east,
      north: longest.plan[longest.plan.length - 1].north - longest.plan[0].north,
    }
    : undefined;
  const axis = spanAxis(axisSource, preferred);
  const spanOrigin = axisSource[0];
  const projections = axisSource.map((point) => projectSpan(point, spanOrigin, axis));
  const minT = Math.min(...projections);
  const maxT = Math.max(...projections);
  const range = Math.max(1, maxT - minT);
  const atAbutment = (point: PlanPoint) => {
    const t = (projectSpan(point, spanOrigin, axis) - minT) / range;
    return t <= 0.16 || t >= 0.84;
  };
  return cluster.map((drawable) => {
    if (drawable.kind !== 'line' || drawable.plan.length < 2) return drawable;
    if (polygons.length > 0 && isPathClass(drawable.properties.className)) return drawable;
    const extendStart = atAbutment(drawable.plan[0]);
    const extendEnd = atAbutment(drawable.plan[drawable.plan.length - 1]);
    if (!extendStart && !extendEnd) return drawable;
    const plan = extendPlanEnds(drawable.plan, extendStart, extendEnd);
    return {
      ...drawable,
      plan,
      coordinates: plan.map((point) => planToLngLat(point, origin)),
    };
  });
}

export function bridgePierDistances(length: number, limit = 32) {
  if (length < PIER_SPACING_METERS * 1.4 || limit < 1) return [];
  const margin = Math.min(PIER_SPACING_METERS, Math.max(ABUTMENT_EXTEND_METRES, length * PIER_END_MARGIN));
  const previousCount = Math.min(limit, Math.max(1, Math.round((length - 2 * margin) / PIER_SPACING_METERS) + 1));
  const count = Math.ceil(previousCount / 2);
  return Array.from({ length: count }, (_, index) => count === 1 ? length / 2
    : margin + (length - 2 * margin) * index / (count - 1));
}

/** Interpolate the actual rendered triangle, independent of vertex ordering. */
export function bridgeDeckHeightAt(point: PlanPoint, points: PlanPoint[], indices: number[], heights: number[]) {
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3);
    const denominator = (points[b].north - points[c].north) * (points[a].east - points[c].east)
      + (points[c].east - points[b].east) * (points[a].north - points[c].north);
    if (Math.abs(denominator) < 1e-10) continue;
    const u = ((points[b].north - points[c].north) * (point.east - points[c].east)
      + (points[c].east - points[b].east) * (point.north - points[c].north)) / denominator;
    const v = ((points[c].north - points[a].north) * (point.east - points[c].east)
      + (points[a].east - points[c].east) * (point.north - points[c].north)) / denominator;
    const w = 1 - u - v;
    if (Math.min(u, v, w) >= -1e-8) return heights[a] * u + heights[b] * v + heights[c] * w;
  }
  return undefined;
}

export function bridgePierLocations(lines: PlanPoint[][], surfaces: DeckSurface[], points: PlanPoint[],
  indices: number[], heights: number[], limit = 32) {
  const candidates: PlanPoint[] = [];
  for (const line of lines) {
    const length = planLineLength(line);
    const distances = bridgePierDistances(length, limit);
    let offset = 0;
    let segment = 1;
    for (const distance of distances) {
      while (segment < line.length) {
        const a = line[segment - 1];
        const b = line[segment];
        const span = Math.hypot(b.east - a.east, b.north - a.north);
        if (offset + span >= distance && span > 0) {
          const t = (distance - offset) / span;
          candidates.push({ east: a.east + (b.east - a.east) * t, north: a.north + (b.north - a.north) * t });
          break;
        }
        offset += span;
        segment += 1;
      }
    }
  }
  if (!lines.length) {
    for (const surface of surfaces) {
      const axis = spanAxis(surface.outer);
      const origin = surface.outer[0];
      if (!origin) continue;
      const spans = surface.outer.map((point) => projectSpan(point, origin, axis));
      const start = Math.min(...spans);
      const perp = { east: -axis.north, north: axis.east };
      for (const distance of bridgePierDistances(Math.max(...spans) - start, limit)) {
        const hits = [surface.outer, ...surface.holes].flatMap((ring) => sectionHits(ring, origin, axis, start + distance))
          .sort((a, b) => (a.east - b.east) * perp.east + (a.north - b.north) * perp.north);
        for (let index = 1; index < hits.length; index += 1) {
          const a = hits[index - 1];
          const b = hits[index];
          const point = { east: (a.east + b.east) / 2, north: (a.north + b.north) / 2 };
          if (pointInFilledPolygon(point, surface.outer, surface.holes)) candidates.push(point);
        }
      }
    }
  }
  const result: Array<PlanPoint & { deck: number }> = [];
  for (const point of candidates) {
    if (result.length >= limit) break;
    if (result.some((other) => Math.hypot(point.east - other.east, point.north - other.north) < PIER_SPACING_METERS / 2)) continue;
    const footprint = [point, ...[-0.675, 0.675].flatMap((east) => [-0.675, 0.675].map((north) => ({
      east: point.east + east, north: point.north + north,
    })))];
    if (surfaces.length && footprint.some((sample) => !surfaces.some((surface) =>
      pointInFilledPolygon(sample, surface.outer, surface.holes)))) continue;
    // A small hole can fit between the footprint samples; keep its boundary
    // outside the support's circumscribed radius as well.
    if (surfaces.some((surface) => surface.holes.some((hole) =>
      pointToPolyline(point, hole, true) < Math.SQRT2 * 0.675))) continue;
    const deck = footprint.map((sample) => bridgeDeckHeightAt(sample, points, indices, heights));
    if (deck.some((height) => height === undefined)) continue;
    result.push({ ...point, deck: Math.min(...deck as number[]) });
  }
  return result;
}

export function deckAreaAllowed(outer: PlanPoint[], holes: PlanPoint[][] = []) {
  const area = polygonAreaMetres(outer) - holes.reduce((sum, hole) => sum + polygonAreaMetres(hole), 0);
  if (area < MIN_POLYGON_AREA_METRES) return false;
  if (area <= MAX_POLYGON_AREA_METRES) return true;
  if (area > MAX_ELONGATED_DECK_AREA_METRES || outer.length < 3) return false;
  const axis = spanAxis(outer);
  const projections = outer.map((point) => projectSpan(point, outer[0], axis));
  const span = Math.max(...projections) - Math.min(...projections);
  const width = area / Math.max(span, 1);
  return span >= ELONGATED_DECK_MIN_SPAN_METRES && width <= ELONGATED_DECK_MAX_WIDTH_METRES;
}

export function polygonAreaMetres(points: PlanPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].east * next.north - next.east * points[index].north;
  }
  return Math.abs(area) * 0.5;
}

function createBridgeCanvas(bounds: PlanBounds, pixelBudget = MAX_TEXTURE_PIXELS_PER_BRIDGE) {
  const spanEast = Math.max(1, bounds.maxEast - bounds.minEast);
  const spanNorth = Math.max(1, bounds.maxNorth - bounds.minNorth);
  const longSpan = Math.max(spanEast, spanNorth);
  const shortSpan = Math.min(spanEast, spanNorth);
  const scale = Math.min(
    MAX_CANVAS_LONG / longSpan,
    MAX_CANVAS_SHORT / shortSpan,
    MAX_CANVAS_PIXELS_PER_METRE,
    Math.sqrt(pixelBudget / (spanEast * spanNorth)),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.floor(spanEast * scale));
  canvas.height = Math.max(2, Math.floor(spanNorth * scale));
  // Integer texture dimensions must match UV normalization exactly at joins.
  canvas.getContext('2d')?.setTransform(
    canvas.width / (spanEast * scale), 0, 0, canvas.height / (spanNorth * scale), 0, 0,
  );
  return { canvas, scale, spanEast, spanNorth };
}

function canvasPoint(east: number, north: number, bounds: PlanBounds, scale: number) {
  return {
    x: (east - bounds.minEast) * scale,
    y: (bounds.maxNorth - north) * scale,
  };
}

function strokePlanLine(
  context: CanvasRenderingContext2D,
  points: PlanPoint[],
  bounds: PlanBounds,
  scale: number,
  widthMetres: number,
  fillColor: string,
  edgeColor: string,
) {
  if (points.length < 2) return;
  const start = canvasPoint(points[0].east, points[0].north, bounds, scale);
  context.lineJoin = 'round';
  context.lineCap = 'butt';
  context.beginPath();
  context.moveTo(start.x, start.y);
  for (let index = 1; index < points.length; index += 1) {
    const next = canvasPoint(points[index].east, points[index].north, bounds, scale);
    context.lineTo(next.x, next.y);
  }
  context.strokeStyle = edgeColor;
  context.lineWidth = Math.max(2, (widthMetres + 1.1) * scale);
  context.stroke();
  context.strokeStyle = fillColor;
  context.lineWidth = Math.max(1, widthMetres * scale);
  context.stroke();
}

function fillPlanPolygon(
  context: CanvasRenderingContext2D,
  points: PlanPoint[],
  bounds: PlanBounds,
  scale: number,
  fillColor: string,
  edgeColor: string,
  edgeMetres = 1.15,
  holes: PlanPoint[][] = [],
) {
  if (points.length < 3) return;
  context.beginPath();
  tracePlanRing(context, points, bounds, scale);
  for (const hole of holes) {
    if (hole.length >= 3) tracePlanRing(context, hole, bounds, scale);
  }
  context.fillStyle = fillColor;
  context.fill('evenodd');
  context.strokeStyle = edgeColor;
  context.lineJoin = 'round';
  context.lineWidth = Math.max(1.4, edgeMetres * scale);
  context.stroke();
}

function tracePlanRing(
  context: CanvasRenderingContext2D,
  ring: PlanPoint[],
  bounds: PlanBounds,
  scale: number,
) {
  const start = canvasPoint(ring[0].east, ring[0].north, bounds, scale);
  context.moveTo(start.x, start.y);
  for (let index = 1; index < ring.length; index += 1) {
    const next = canvasPoint(ring[index].east, ring[index].north, bounds, scale);
    context.lineTo(next.x, next.y);
  }
  context.closePath();
}

export function paintBridgeCanvas(
  points: PlanPoint[],
  bounds: PlanBounds,
  widthMetres: number,
  fillColor: string,
  edgeColor: string,
) {
  const { canvas, scale } = createBridgeCanvas(bounds);
  const context = canvas.getContext('2d');
  if (context) strokePlanLine(context, points, bounds, scale, widthMetres, fillColor, edgeColor);
  return canvas;
}

export function paintBridgePolygonCanvas(
  points: PlanPoint[],
  bounds: PlanBounds,
  fillColor: string,
  edgeColor: string,
) {
  const { canvas, scale } = createBridgeCanvas(bounds);
  const context = canvas.getContext('2d');
  if (context) fillPlanPolygon(context, points, bounds, scale, fillColor, edgeColor);
  return canvas;
}

/** Two schematic rails follow the OSM track centerline, including bounded corner joins. */
export function bridgeRailLines(plan: PlanPoint[]) {
  const points = plan.filter((point, index) => index === 0
    || Math.hypot(point.east - plan[index - 1].east, point.north - plan[index - 1].north) > 1e-6);
  if (points.length < 2) return [];
  const normals = points.slice(1).map((point, index) => {
    const east = point.east - points[index].east;
    const north = point.north - points[index].north;
    const length = Math.hypot(east, north);
    return { east: -north / length, north: east / length };
  });
  return [-1, 1].map((side) => points.map((point, index) => {
    const incoming = normals[Math.max(0, index - 1)];
    const outgoing = normals[Math.min(normals.length - 1, index)];
    const length = Math.hypot(incoming.east + outgoing.east, incoming.north + outgoing.north);
    const normal = length > 1e-6 ? { east: (incoming.east + outgoing.east) / length,
      north: (incoming.north + outgoing.north) / length } : outgoing;
    const offset = side * 0.75 / Math.max(0.5, normal.east * outgoing.east + normal.north * outgoing.north);
    return { east: point.east + normal.east * offset, north: point.north + normal.north * offset };
  }));
}

export function paintBridgeCluster(
  surfaces: DeckSurface[],
  parts: BridgePaintPart[],
  bounds: PlanBounds,
  resolve: (part: BridgePaintPart) => { fill: string; edge: string; rail?: string } = (part) => part,
  pixelBudget = MAX_TEXTURE_PIXELS_PER_BRIDGE,
) {
  const { canvas, scale } = createBridgeCanvas(bounds, pixelBudget);
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const baseColors = clusterBaseColors(parts);
  const basePart = parts.find((part) => part.fill === baseColors.fill);
  const base = basePart ? resolve(basePart) : baseColors;
  const paintFilledDecks = parts.some((part) => part.kind === 'polygon');
  if (paintFilledDecks) {
    for (const surface of surfaces) {
      fillPlanPolygon(context, surface.outer, bounds, scale, base.fill, base.edge, 1.35, surface.holes);
    }
  }
  const polygons = parts.filter((part) => part.kind === 'polygon');
  const lines = parts.filter((part) => part.kind === 'line')
    .slice()
    .sort((left, right) => right.width - left.width);
  for (const part of polygons) {
    const colors = resolve(part);
    fillPlanPolygon(context, part.plan, bounds, scale, colors.fill, colors.edge, 1.15, part.holes ?? []);
  }
  for (const part of lines) {
    const clipToDeck = paintFilledDecks && (part.fill === PATH_FILL || part.fill === CYCLEWAY_FILL);
    if (clipToDeck) {
      context.save();
      context.beginPath();
      for (const surface of surfaces) {
        tracePlanRing(context, surface.outer, bounds, scale);
      }
      context.clip();
    }
    const colors = resolve(part);
    strokePlanLine(context, part.plan, bounds, scale, part.width, colors.fill, colors.edge);
    if (clipToDeck) context.restore();
  }
  // Paint from complete centerlines so section boundaries never restart the rails.
  for (const part of lines) {
    if (part.properties?.className !== 'rail' && part.properties?.className !== 'transit') continue;
    const colors = resolve(part);
    context.save();
    context.globalCompositeOperation = 'source-atop';
    context.strokeStyle = colors.rail ?? part.edge;
    context.lineWidth = Math.max(1, 0.18 * scale);
    context.lineJoin = 'round';
    context.lineCap = 'butt';
    for (const rail of bridgeRailLines(part.plan)) {
      context.beginPath();
      rail.forEach((point, index) => {
        const pixel = canvasPoint(point.east, point.north, bounds, scale);
        if (index === 0) context.moveTo(pixel.x, pixel.y);
        else context.lineTo(pixel.x, pixel.y);
      });
      context.stroke();
    }
    context.restore();
  }
  return canvas;
}

function clusterBaseColors(parts: BridgePaintPart[]) {
  const hasRoad = parts.some((part) => part.fill === ROAD_FILL);
  const hasRail = parts.some((part) => part.fill === RAIL_FILL);
  if (hasRoad) return { fill: ROAD_FILL, edge: ROAD_EDGE };
  if (hasRail) return { fill: RAIL_FILL, edge: RAIL_EDGE };
  const cycleway = parts.find((part) => part.fill === CYCLEWAY_FILL);
  if (cycleway) return { fill: CYCLEWAY_FILL, edge: CYCLEWAY_EDGE };
  return { fill: PATH_FILL, edge: PATH_EDGE };
}

function lngLatDelta(start: [number, number], end: [number, number]) {
  const midLat = (start[1] + end[1]) * 0.5 * DEGREES_TO_RADIANS;
  return {
    east: (end[0] - start[0]) * Math.cos(midLat) * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS,
    north: (end[1] - start[1]) * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS,
  };
}

function segmentLengthMetres(start: [number, number], end: [number, number]) {
  const delta = lngLatDelta(start, end);
  return Math.hypot(delta.east, delta.north);
}

function isLongitudinalGap(
  from: [number, number],
  to: [number, number],
  heading: { east: number; north: number },
  maxMetres: number,
) {
  const delta = lngLatDelta(from, to);
  const distance = Math.hypot(delta.east, delta.north);
  if (distance > maxMetres) return false;
  const along = delta.east * heading.east + delta.north * heading.north;
  const lateral = Math.abs(delta.east * -heading.north + delta.north * heading.east);
  if (lateral > LINE_STITCH_LATERAL_METRES && lateral > Math.abs(along) * 0.5) return false;
  return along >= -2;
}

function lineSignature(coordinates: Array<[number, number]>) {
  return coordinates.map((coordinate) => `${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`).join(';');
}

function lngLatHeading(from: [number, number], to: [number, number]) {
  const midLat = (from[1] + to[1]) * 0.5 * DEGREES_TO_RADIANS;
  const east = (to[0] - from[0]) * Math.cos(midLat) * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS;
  const north = (to[1] - from[1]) * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS;
  const length = Math.hypot(east, north) || 1;
  return { east: east / length, north: north / length };
}

function headingDot(
  left: { east: number; north: number },
  right: { east: number; north: number },
) {
  return left.east * right.east + left.north * right.north;
}

function lineEndHeading(coordinates: Array<[number, number]>, atStart: boolean) {
  if (coordinates.length < 2) return { east: 1, north: 0 };
  if (atStart) return lngLatHeading(coordinates[0], coordinates[1]);
  return lngLatHeading(coordinates[coordinates.length - 2], coordinates[coordinates.length - 1]);
}

type StitchMode = 'append-start' | 'append-end' | 'prepend-end' | 'prepend-start';

function stitchMatch(current: BridgeLine, candidate: BridgeLine, maxMetres: number) {
  if (current.coordinates.length < 2 || candidate.coordinates.length < 2) return null;
  const currentStart = current.coordinates[0];
  const currentEnd = current.coordinates[current.coordinates.length - 1];
  const candidateStart = candidate.coordinates[0];
  const candidateEnd = candidate.coordinates[candidate.coordinates.length - 1];
  const currentStartHeading = lineEndHeading(current.coordinates, true);
  const currentEndHeading = lineEndHeading(current.coordinates, false);
  const candidateStartHeading = lineEndHeading(candidate.coordinates, true);
  const candidateEndHeading = lineEndHeading(candidate.coordinates, false);
  const options: Array<{ mode: StitchMode; distance: number; aligned: boolean }> = [
    {
      mode: 'append-start',
      distance: segmentLengthMetres(currentEnd, candidateStart),
      aligned: headingDot(currentEndHeading, candidateStartHeading) >= LINE_CONTINUATION_DOT
        && isLongitudinalGap(currentEnd, candidateStart, currentEndHeading, maxMetres),
    },
    {
      mode: 'append-end',
      distance: segmentLengthMetres(currentEnd, candidateEnd),
      aligned: headingDot(currentEndHeading, {
        east: -candidateEndHeading.east,
        north: -candidateEndHeading.north,
      }) >= LINE_CONTINUATION_DOT
        && isLongitudinalGap(currentEnd, candidateEnd, currentEndHeading, maxMetres),
    },
    {
      mode: 'prepend-end',
      distance: segmentLengthMetres(currentStart, candidateEnd),
      aligned: headingDot(candidateEndHeading, currentStartHeading) >= LINE_CONTINUATION_DOT
        && isLongitudinalGap(candidateEnd, currentStart, candidateEndHeading, maxMetres),
    },
    {
      mode: 'prepend-start',
      distance: segmentLengthMetres(currentStart, candidateStart),
      aligned: headingDot({
        east: -candidateStartHeading.east,
        north: -candidateStartHeading.north,
      }, currentStartHeading) >= LINE_CONTINUATION_DOT
        && isLongitudinalGap(candidateStart, currentStart, {
          east: -candidateStartHeading.east,
          north: -candidateStartHeading.north,
        }, maxMetres),
    },
  ];
  let best: { mode: StitchMode; distance: number } | null = null;
  for (const option of options) {
    if (!option.aligned || option.distance > maxMetres) continue;
    if (!best || option.distance < best.distance) best = option;
  }
  return best;
}

function applyStitch(current: BridgeLine, candidate: BridgeLine, mode: StitchMode) {
  const skipDuplicate = (first: [number, number], second: [number, number]) => (
    segmentLengthMetres(first, second) < 0.4
  );
  if (mode === 'append-start') {
    const drop = skipDuplicate(current.coordinates[current.coordinates.length - 1], candidate.coordinates[0]);
    current.coordinates.push(...candidate.coordinates.slice(drop ? 1 : 0));
    return;
  }
  if (mode === 'append-end') {
    const reversed = candidate.coordinates.slice().reverse();
    const drop = skipDuplicate(current.coordinates[current.coordinates.length - 1], reversed[0]);
    current.coordinates.push(...reversed.slice(drop ? 1 : 0));
    return;
  }
  if (mode === 'prepend-end') {
    const drop = skipDuplicate(candidate.coordinates[candidate.coordinates.length - 1], current.coordinates[0]);
    current.coordinates.unshift(...candidate.coordinates.slice(0, drop ? -1 : undefined));
    return;
  }
  const reversed = candidate.coordinates.slice().reverse();
  const drop = skipDuplicate(reversed[reversed.length - 1], current.coordinates[0]);
  current.coordinates.unshift(...reversed.slice(0, drop ? -1 : undefined));
}

function stitchGroup(lines: BridgeLine[], maxMetres = LINE_STITCH_METRES) {
  const unused = lines.map((line) => ({
    ...line,
    coordinates: line.coordinates.slice(),
  }));
  const result: BridgeLine[] = [];

  while (unused.length > 0) {
    const current = unused.pop()!;
    let changed = true;
    while (changed) {
      changed = false;
      let bestIndex = -1;
      let bestMode: StitchMode | null = null;
      let bestDistance = maxMetres;
      for (let index = unused.length - 1; index >= 0; index -= 1) {
        const match = stitchMatch(current, unused[index], maxMetres);
        if (!match) continue;
        if (match.distance <= bestDistance) {
          bestDistance = match.distance;
          bestIndex = index;
          bestMode = match.mode;
        }
      }
      if (bestIndex < 0 || !bestMode) break;
      applyStitch(current, unused[bestIndex], bestMode);
      unused.splice(bestIndex, 1);
      changed = true;
    }
    result.push(current);
  }
  return result;
}

function snapBridgeLineEndpoints(lines: BridgeLine[], metres = ENDPOINT_SNAP_METRES) {
  type Node = { line: number; atStart: boolean; coordinate: [number, number] };
  const nodes: Node[] = [];
  lines.forEach((line, lineIndex) => {
    if (line.coordinates.length < 2) return;
    nodes.push({ line: lineIndex, atStart: true, coordinate: line.coordinates[0] });
    nodes.push({
      line: lineIndex,
      atStart: false,
      coordinate: line.coordinates[line.coordinates.length - 1],
    });
  });
  const parent = nodes.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]);
    return parent[index];
  };
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (nodes[left].line === nodes[right].line) continue;
      if (segmentLengthMetres(nodes[left].coordinate, nodes[right].coordinate) > metres) continue;
      const rootLeft = find(left);
      const rootRight = find(right);
      if (rootLeft !== rootRight) parent[rootRight] = rootLeft;
    }
  }
  const clusters = new Map<number, Node[]>();
  nodes.forEach((node, index) => {
    const root = find(index);
    const cluster = clusters.get(root);
    if (cluster) cluster.push(node);
    else clusters.set(root, [node]);
  });
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    const linesInCluster = new Set(cluster.map((node) => node.line));
    if (linesInCluster.size < 2) continue;
    const centroid: [number, number] = [
      cluster.reduce((sum, node) => sum + node.coordinate[0], 0) / cluster.length,
      cluster.reduce((sum, node) => sum + node.coordinate[1], 0) / cluster.length,
    ];
    for (const node of cluster) {
      const coordinates = lines[node.line].coordinates;
      if (node.atStart) coordinates[0] = centroid;
      else coordinates[coordinates.length - 1] = centroid;
    }
  }
  return lines;
}

export function linePartsFromGeometry(geometry: { type?: string; coordinates?: unknown } | null | undefined) {
  if (!geometry) return [] as Array<Array<[number, number]>>;
  if (geometry.type === 'LineString') {
    const line = parseLngLatLine(geometry.coordinates);
    return line.length >= 2 ? [line] : [];
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((part) => parseLngLatLine(part))
      .filter((line) => line.length >= 2);
  }
  return [];
}

function parseLngLatLine(points: unknown): Array<[number, number]> {
  if (!Array.isArray(points)) return [];
  const coordinates: Array<[number, number]> = [];
  for (const point of points) {
    const lngLat = asLngLat(point);
    if (lngLat) coordinates.push(lngLat);
  }
  return coordinates;
}

function asLngLat(point: unknown): [number, number] | null {
  if (!Array.isArray(point) || point.length < 2) return null;
  const longitude = Number(point[0]);
  const latitude = Number(point[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [longitude, latitude];
}

function parseLngLatRing(ring: unknown): Array<[number, number]> {
  if (!Array.isArray(ring)) return [];
  const coordinates: Array<[number, number]> = [];
  for (const point of ring) {
    const lngLat = asLngLat(point);
    if (lngLat) coordinates.push(lngLat);
  }
  if (coordinates.length >= 2) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) coordinates.pop();
  }
  return coordinates;
}

function polygonPartsFromFeature(feature: SourceFeature): Array<{
  outer: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
}> {
  const geometry = feature.geometry;
  const polygons: unknown[] = [];
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    polygons.push(geometry.coordinates);
  } else if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    polygons.push(...geometry.coordinates);
  }
  const parts: Array<{ outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }> = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    const outer = parseLngLatRing(polygon[0]);
    if (outer.length < 3) continue;
    const holes = polygon.slice(1).map(parseLngLatRing).filter((hole) => hole.length >= 3);
    parts.push({ outer, holes });
  }
  return parts;
}

function propertiesFromFeature(feature: SourceFeature): BridgeLineProperties {
  const properties = feature.properties ?? {};
  const layer = Number(properties.layer);
  return {
    className: String(properties.class ?? ''),
    subclass: typeof properties.subclass === 'string' ? properties.subclass : undefined,
    layer: Number.isFinite(layer) ? layer : 0,
    ramp: properties.ramp === 1 || properties.ramp === true,
    service: typeof properties.service === 'string' ? properties.service : undefined,
    surface: typeof properties.surface === 'string' ? properties.surface : undefined,
  };
}

export class BridgeModelLayer implements CustomLayerInterface {
  readonly id = BRIDGE_MODEL_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly decks = new THREE.Group();
  private readonly transformHelper = new THREE.Object3D();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private sceneOrigin = new maplibregl.LngLat(23.7609, 61.4981);
  private sceneOriginElevation = 0;
  private readonly elevationCache = new Map<string, number>();
  private sampledBridges: SampledBridge[] = [];
  private drapedVisible = true;
  private drapedHandoff?: { frames: number; fadeStarted?: number };
  private bridgeOpacity = 1;
  private pendingElevation = false;
  private hemisphereLight?: THREE.HemisphereLight;
  private sunlight?: THREE.DirectionalLight;
  private pierMesh?: THREE.InstancedMesh;
  private darkMode = false;
  private nightMix = 0;
  private sunAzimuth = CARTOON_SUN_AZIMUTH_DEGREES;
  private sunPolar = CARTOON_SUN_POLAR_DEGREES;
  private lastUpdateSignature?: string;
  private terrainSignature?: string;
  private readonly bridgeResources = new Map<string, BridgeResources>();
  private pierOrigin = this.sceneOrigin;
  private pierOriginElevation = 0;
  private readonly performanceStats = { updates: 0, built: 0, reused: 0, heightUpdates: 0, recenters: 0, lastUpdateMs: 0, sourceParts: 0, retainedParts: 0 };

  getPerformanceStats() {
    return { ...this.performanceStats, cachedBridges: this.bridgeResources.size };
  }

  constructor(private readonly sourceId = OPENFREEMAP_SOURCE_ID) {}

  invalidateSource() {
    this.lastUpdateSignature = undefined;
  }

  invalidateTerrain() {
    this.invalidateSource();
    this.elevationCache.clear();
    this.pendingElevation = true;
  }

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    this.applyLighting();
    this.map?.triggerRepaint();
  }

  setDayNightLighting(lighting: {
    azimuth: number;
    polar: number;
    nightMix: number;
  } | null) {
    const azimuth = lighting?.azimuth ?? CARTOON_SUN_AZIMUTH_DEGREES;
    const polar = lighting?.polar ?? CARTOON_SUN_POLAR_DEGREES;
    const nightMix = lighting?.nightMix ?? 0;
    if (this.sunAzimuth === azimuth && this.sunPolar === polar && this.nightMix === nightMix) return;
    this.sunAzimuth = azimuth;
    this.sunPolar = polar;
    this.nightMix = nightMix;
    const position = sunCartesian(azimuth, polar);
    this.sunlight?.position.set(position.x, position.y, position.z);
    this.applyLighting();
    this.map?.triggerRepaint();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.hemisphereLight = new THREE.HemisphereLight(
      CARTOON_AMBIENT_SKY_COLOR,
      CARTOON_AMBIENT_GROUND_COLOR,
      1.8,
    );
    this.scene.add(this.hemisphereLight);
    this.sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR, 2.4);
    const sunPosition = sunCartesian(this.sunAzimuth, this.sunPolar);
    this.sunlight.position.set(sunPosition.x, sunPosition.y, sunPosition.z);
    this.scene.add(this.sunlight);
    this.decks.frustumCulled = false;
    this.scene.add(this.decks);

    this.pierMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.35, 1, 1.7),
      new THREE.MeshLambertMaterial({ color: PIER_COLOR, flatShading: true, transparent: true }),
      MAX_PIERS,
    );
    this.pierMesh.count = 0;
    this.pierMesh.frustumCulled = false;
    this.pierMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.pierMesh);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.applyLighting();
  }

  updateBridges() {
    const map = this.map;
    if (!map) return;

    const terrainSignature = JSON.stringify(map.getTerrain());
    if (terrainSignature !== this.terrainSignature) {
      this.invalidateTerrain();
      this.terrainSignature = terrainSignature;
    }
    const view = this.currentView(map);
    const visible = shouldRenderBridgesForView(view);
    const signature = visible ? JSON.stringify(view) : 'hidden';
    if (signature === this.lastUpdateSignature) return;
    // Record attempts too: missing terrain is retried when source data arrives,
    // rather than creating an idle/repaint retry loop.
    this.lastUpdateSignature = signature;
    if (!visible) {
      this.pendingElevation = false;
      if (view.terrainEnabled && this.sampledBridges.length > 0) {
        this.beginDrapedHandoff();
      } else {
        this.finishDrapedHandoff();
      }
      map.triggerRepaint();
      return;
    }

    this.cancelDrapedHandoff();
    const started = performance.now();
    this.performanceStats.updates += 1;
    const sampled = this.sampleVisibleBridges(map, view);
    if (sampled.pending) {
      this.pendingElevation = true;
      this.performanceStats.lastUpdateMs = performance.now() - started;
      if (this.sampledBridges.length === 0) this.setDrapedVisible(true);
      return;
    }
    this.pendingElevation = false;
    this.sampledBridges = sampled.bridges;

    this.sceneOrigin = map.getCenter();
    this.sceneOriginElevation = map.queryTerrainElevation(this.sceneOrigin) ?? 0;
    this.writeMeshes();
    this.performanceStats.lastUpdateMs = performance.now() - started;
    this.setDrapedVisible(this.sampledBridges.length === 0);
    map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer) return;
    const view = this.currentView(map);
    if (!view.terrainEnabled || this.sampledBridges.length === 0) return;
    if (!shouldRenderBridgesForView(view)) {
      this.beginDrapedHandoff();
      if (!this.advanceDrapedHandoff(performance.now())) return;
    } else {
      this.cancelDrapedHandoff();
    }
    this.refreshDeckPaint();

    const center = map.getCenter();
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const centerMercator = maplibregl.MercatorCoordinate.fromLngLat(center);
    const units = originMercator.meterInMercatorCoordinateUnits();
    const drift = Math.hypot(
      (centerMercator.x - originMercator.x) / units,
      (centerMercator.y - originMercator.y) / units,
    );
    if (drift > RECENTER_DISTANCE_METERS) {
      this.sceneOrigin = center;
      this.sceneOriginElevation = map.queryTerrainElevation(center) ?? this.sceneOriginElevation;
      this.positionResources();
      this.performanceStats.recenters += 1;
    }

    const origin = maplibregl.MercatorCoordinate.fromLngLat(
      this.sceneOrigin,
      this.sceneOriginElevation,
    );
    const scale = origin.meterInMercatorCoordinateUnits();
    this.sceneScale.set(scale, -scale, scale);
    this.sceneTransform.makeTranslation(origin.x, origin.y, origin.z).scale(this.sceneScale);
    this.projectionMatrix
      .fromArray(options.defaultProjectionData.mainMatrix)
      .multiply(this.sceneTransform);
    this.camera.projectionMatrix.copy(this.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.projectionMatrix).invert();

    renderer.resetState();
    renderer.render(this.scene, this.camera);
  }

  onRemove() {
    this.drapedHandoff = undefined;
    this.setDrapedVisible(true);
    this.clearMeshes();
    this.pierMesh?.geometry.dispose();
    const pierMaterial = this.pierMesh?.material;
    const materials = Array.isArray(pierMaterial) ? pierMaterial : [pierMaterial];
    materials.forEach((material) => material?.dispose());
    this.scene.clear();
    this.elevationCache.clear();
    this.sampledBridges = [];
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
    this.lastUpdateSignature = undefined;
    this.terrainSignature = undefined;
  }

  needsElevationRetry() {
    return this.pendingElevation;
  }

  private currentView(map: MaplibreMap): BridgeViewState {
    const bounds = map.getBounds();
    return {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      terrainEnabled: Boolean(map.getTerrain()),
    };
  }

  private cachedElevation(key: string) {
    const elevation = this.elevationCache.get(key);
    if (elevation === undefined) return undefined;
    this.elevationCache.delete(key);
    this.elevationCache.set(key, elevation);
    return elevation;
  }

  private cacheElevation(key: string, elevation: number) {
    this.elevationCache.delete(key);
    this.elevationCache.set(key, elevation);
    while (this.elevationCache.size > MAX_ELEVATION_CACHE_ENTRIES) {
      const oldestKey = this.elevationCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.elevationCache.delete(oldestKey);
    }
  }

  private sampleElevation(map: MaplibreMap, longitude: number, latitude: number, terrainZoomBucket: number) {
    const key = `${terrainZoomBucket}:${longitude.toFixed(5)}:${latitude.toFixed(5)}`;
    const cached = this.cachedElevation(key);
    if (cached !== undefined) return cached;
    const sampled = map.queryTerrainElevation(new maplibregl.LngLat(longitude, latitude));
    if (typeof sampled !== 'number' || !Number.isFinite(sampled)) return null;
    this.cacheElevation(key, sampled);
    return sampled;
  }

  private sampleVisibleBridges(map: MaplibreMap, view: BridgeViewState) {
    if (!map.getSource(this.sourceId)) return { bridges: [] as SampledBridge[], pending: false };
    let features: SourceFeature[] = [];
    try {
      features = map.querySourceFeatures(this.sourceId, {
        sourceLayer: 'transportation',
        filter: BRIDGE_FEATURE_FILTER,
      });
    } catch (error) {
      console.warn('Could not query bridge features', error);
      return { bridges: [], pending: false };
    }

    const uniqueLines = new Map<string, BridgeLine>();
    const uniquePolygons = new Map<string, {
      coordinates: Array<[number, number]>;
      holes: Array<Array<[number, number]>>;
      properties: BridgeLineProperties;
    }>();
    for (const feature of features) {
      const properties = propertiesFromFeature(feature);
      if (properties.className === 'pier') continue;
      const polygonParts = polygonPartsFromFeature(feature);
      if (polygonParts.length > 0) {
        for (const part of polygonParts) {
          const forward = lineSignature(part.outer);
          const reverse = lineSignature(part.outer.slice().reverse());
          if (uniquePolygons.has(forward) || uniquePolygons.has(reverse)) continue;
          uniquePolygons.set(forward, { coordinates: part.outer, holes: part.holes, properties });
        }
        continue;
      }
      if (!LINE_BRIDGE_CLASSES.has(properties.className)) continue;
      for (const coordinates of linePartsFromGeometry(feature.geometry)) {
        const forward = lineSignature(coordinates);
        const reverse = lineSignature(coordinates.slice().reverse());
        if (uniqueLines.has(forward) || uniqueLines.has(reverse)) continue;
        uniqueLines.set(forward, { coordinates, properties });
      }
    }

    const parts = [...uniqueLines.values(), ...uniquePolygons.values()];
    const retained = new Set(bridgePartsForView(parts, view));
    this.performanceStats.sourceParts = parts.length;
    this.performanceStats.retainedParts = retained.size;
    const mergedLines = mergeBridgeLines([...uniqueLines.values()].filter((line) => retained.has(line)))
      .filter((line) => lineLengthMetres(line.coordinates) >= MIN_BRIDGE_LENGTH_METERS);
    const polygons = [...uniquePolygons.values()].filter((polygon) => {
      if (!retained.has(polygon)) return false;
      const outer = toPlanPoints(polygon.coordinates);
      const holes = polygon.holes.map((hole) => toPlanPoints(hole));
      return deckAreaAllowed(outer, holes);
    });

    const seed = mergedLines[0]?.coordinates[0] ?? polygons[0]?.coordinates[0];
    if (!seed) return { bridges: [], pending: false };
    const origin = planOriginFromLngLat(seed[0], seed[1]);
    const drawables: BridgeDrawable[] = [
      ...mergedLines.map((line) => ({
        kind: 'line' as const,
        coordinates: line.coordinates,
        plan: lngLatsToPlan(line.coordinates, origin),
        properties: line.properties,
        width: bridgeWidthMetres(line.properties),
      })),
      ...polygons.map((polygon) => ({
        kind: 'polygon' as const,
        coordinates: polygon.coordinates,
        plan: lngLatsToPlan(polygon.coordinates, origin),
        holes: polygon.holes.map((hole) => lngLatsToPlan(hole, origin)),
        properties: polygon.properties,
        width: 0,
      })),
    ];

    const clusters = clusterBridgeDrawables(drawables)
      .map((members) => {
        // Tile enumeration may change the shared plan origin. Build each cluster
        // in its own coordinates so unrelated tile arrivals do not change its mesh.
        const anchor = members[0].coordinates[0];
        const clusterOrigin = planOriginFromLngLat(anchor[0], anchor[1]);
        const localMembers = members.map((drawable) => ({
          ...drawable,
          plan: lngLatsToPlan(drawable.coordinates, clusterOrigin),
          holes: drawable.holes?.map((hole) => lngLatsToPlan(
            hole.map((point) => planToLngLat(point, origin)), clusterOrigin,
          )),
        }));
        const cluster = extendClusterAbutments(localMembers, clusterOrigin);
        return {
          origin: clusterOrigin,
          cluster,
          surfaces: clusterSurfaces(cluster),
          span: clusterSpanLength(cluster),
        };
      })
      .filter((entry) => entry.span >= MIN_BRIDGE_LENGTH_METERS)
      .sort((left, right) => right.span - left.span)
      .slice(0, MAX_BRIDGES);

    const terrainZoomBucket = Math.floor(view.zoom + 1e-6);
    const bridges: SampledBridge[] = [];
    this.pendingElevation = false;
    let remainingPiers = MAX_PIERS;
    for (const entry of clusters) {
      const sampled = this.sampleCluster(map, entry.origin, entry.cluster, entry.surfaces, entry.span, terrainZoomBucket,
        Math.min(32, remainingPiers));
      if (sampled) {
        bridges.push(sampled);
        remainingPiers -= sampled.piers.length;
      }
    }
    return { bridges, pending: this.pendingElevation };
  }

  private sampleCluster(
    map: MaplibreMap,
    origin: PlanOrigin,
    cluster: BridgeDrawable[],
    surfaces: DeckSurface[],
    spanLength: number,
    terrainZoomBucket: number,
    pierLimit = 32,
  ) {
    const lines = cluster.filter((drawable) => drawable.kind === 'line');
    const polygons = cluster.filter((drawable) => drawable.kind === 'polygon');
    const longest = lines
      .slice()
      .sort((left, right) => lineLengthMetres(right.coordinates) - lineLengthMetres(left.coordinates))[0];
    const preferred = longest
      ? {
        east: longest.plan[longest.plan.length - 1].east - longest.plan[0].east,
        north: longest.plan[longest.plan.length - 1].north - longest.plan[0].north,
      }
      : undefined;
    const meshLines = shouldMeshClusterLines(lines, polygons, surfaces);
    const axisSource = !meshLines
      ? (surfaces.flatMap((surface) => surface.outer).length > 0
        ? surfaces.flatMap((surface) => surface.outer)
        : (longest?.plan ?? []))
      : (longest?.plan ?? surfaces.flatMap((surface) => surface.outer));
    const axis = spanAxis(axisSource, preferred);
    const spanOrigin = axisSource[0] ?? { east: 0, north: 0 };
    const meshPoints: PlanPoint[] = [];
    const meshT: number[] = [];
    const meshIndices: number[] = [];
    const appendMesh = (points: PlanPoint[], indices: number[], t: number[]) => {
      if (points.length < 3 || indices.length < 3) return;
      const offset = meshPoints.length;
      meshPoints.push(...points);
      meshT.push(...t);
      meshIndices.push(...indices.map((index) => index + offset));
    };

    if (meshLines) {
      if (lines.length >= 2 && !linesDiverge(lines)) {
        const ribbon = parallelBundleRibbon(lines);
        appendMesh(ribbon.points, ribbon.indices, ribbon.t);
      } else {
        for (const line of lines) {
          const ribbon = lineRibbonMesh(line.plan, line.width);
          appendMesh(ribbon.points, ribbon.indices, ribbon.t);
        }
      }
    } else {
      for (const surface of surfaces) {
        // Span slicing supplies the height samples; densifying the outline first
        // creates redundant long diagonals and multiplies the resulting triangles.
        const triangulated = triangulateDeckSurface(surface, false);
        if (triangulated) {
          appendMesh(
            triangulated.points,
            triangulated.indices,
            remapSpanParameter(triangulated.points, spanOrigin, axis),
          );
          continue;
        }
        const steps = Math.max(8, Math.round(spanLength / SAMPLE_SPACING_METERS));
        const strip = bridgeSurfaceStrip(surface.outer, axis, steps, surface.holes);
        if (strip.indices.length >= 6) {
          appendMesh(strip.points, strip.indices, strip.t);
        }
      }
      if (meshPoints.length < 3 && lines.length > 0) {
        if (lines.length >= 2 && !linesDiverge(lines)) {
          const ribbon = parallelBundleRibbon(lines);
          appendMesh(ribbon.points, ribbon.indices, ribbon.t);
        } else {
          for (const line of lines) {
            const ribbon = lineRibbonMesh(line.plan, line.width);
            appendMesh(ribbon.points, ribbon.indices, ribbon.t);
          }
        }
      }
      for (const line of lines) {
        for (const stub of lineOverhangStubs(line, polygons)) {
          const ribbon = lineRibbonMesh(stub, line.width);
          appendMesh(ribbon.points, ribbon.indices, ribbon.t);
        }
      }
    }
    if (meshPoints.length < 3 || meshIndices.length < 3) return null;
    if (!meshLines) {
      const remapped = remapSpanParameter(meshPoints, spanOrigin, axis);
      for (let index = 0; index < meshT.length; index += 1) meshT[index] = remapped[index];
    }

    const spanMesh = meshLines ? { points: meshPoints, indices: meshIndices, t: meshT }
      : refineBridgeSpan(meshPoints, meshIndices, meshT, spanLength);
    const refined = refineBridgeApproaches(spanMesh.points, spanMesh.indices, spanMesh.t, spanLength);
    meshPoints.splice(0, meshPoints.length, ...refined.points);
    meshIndices.splice(0, meshIndices.length, ...refined.indices);
    meshT.splice(0, meshT.length, ...refined.t);

    const coordinates = meshPoints.map((point) => planToLngLat(point, origin));
    const ground = this.sampleGround(map, coordinates, terrainZoomBucket);
    if (ground === null) {
      this.pendingElevation = true;
      return null;
    }
    if (ground.length < 3) return null;

    const startSamples = meshT.flatMap((t, index) => (t <= 0.08 ? [ground[index]] : []));
    const endSamples = meshT.flatMap((t, index) => (t >= 0.92 ? [ground[index]] : []));
    const startGround = averageOr(startSamples, ground[0]);
    const endGround = averageOr(endSamples, ground[ground.length - 1]);
    const arch = bridgeArchMetres(spanLength);
    const baseDeck = meshT.map((t, index) => {
      const spanHeight = surfaceElevation(t, startGround, startGround, endGround, arch);
      const mix = bridgeApproachMix(t, spanLength);
      return ground[index] + (spanHeight - ground[index]) * mix + bridgeSurfaceClearance(t, spanLength);
    });
    const probes = bridgeClearanceProbes(meshPoints, meshIndices, spanLength);
    const probeGround = this.sampleGround(map, probes.map((probe) => planToLngLat(probe.point, origin)), terrainZoomBucket);
    if (probeGround === null) {
      this.pendingElevation = true;
      return null;
    }
    const deck = terrainClearedDeck(meshT, baseDeck, ground, spanLength,
      probes.map((probe, index) => ({ ...probe, ground: probeGround[index] })));
    const pierLocations = bridgePierLocations(lines.map((line) => line.plan), surfaces, meshPoints, meshIndices, deck, pierLimit);
    const piers = this.sampleBridgePiers(map, pierLocations, origin, terrainZoomBucket);
    if (piers === null) {
      this.pendingElevation = true;
      return null;
    }
    const allPlan = [
      ...meshPoints,
      ...cluster.flatMap((drawable) => drawable.plan),
      ...surfaces.flatMap((surface) => surface.holes.flat()),
    ];

    return {
      surfaces,
      surface: meshPoints.map((point, index) => ({
        longitude: coordinates[index][0],
        latitude: coordinates[index][1],
        ground: ground[index],
        deck: deck[index],
        east: point.east,
        north: point.north,
      })),
      indices: meshIndices,
      parts: cluster.map((drawable) => {
        const colors = bridgePaintColors(drawable.properties);
        return {
          kind: drawable.kind,
          properties: drawable.properties,
          plan: drawable.plan,
          holes: drawable.holes,
          width: drawable.width,
          fill: colors.fill,
          edge: colors.edge,
        };
      }),
      bounds: planBounds(allPlan, 2),
      spanLength,
      piers,
    };
  }

  private sampleBridgePiers(map: MaplibreMap, locations: Array<PlanPoint & { deck: number }>, origin: PlanOrigin, terrainZoomBucket: number) {
    const coordinates = locations.map((point) => planToLngLat(point, origin));
    const ground = this.sampleGround(map, coordinates, terrainZoomBucket);
    if (ground === null) return null;
    return locations.flatMap((point, index) => point.deck - ground[index] >= PIER_CLEARANCE_METERS
      ? [{ longitude: coordinates[index][0], latitude: coordinates[index][1], ground: ground[index], deck: point.deck }] : []);
  }

  private sampleGround(map: MaplibreMap, coordinates: Array<[number, number]>, terrainZoomBucket: number) {
    const ground: number[] = [];
    for (const [longitude, latitude] of coordinates) {
      const elevation = this.sampleElevation(map, longitude, latitude, terrainZoomBucket);
      if (elevation == null) return null;
      ground.push(elevation);
    }
    return ground;
  }

  private toLocal(longitude: number, latitude: number, elevation: number): LocalPoint {
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(
      this.sceneOrigin,
      this.sceneOriginElevation,
    );
    const pointMercator = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: longitude, lat: latitude },
      elevation,
    );
    const units = originMercator.meterInMercatorCoordinateUnits();
    return {
      east: (pointMercator.x - originMercator.x) / units,
      north: (originMercator.y - pointMercator.y) / units,
      up: elevation - this.sceneOriginElevation,
    };
  }

  private writeMeshes() {
    const pierMesh = this.pierMesh;
    if (!pierMesh) return;
    this.decks.clear();
    // Sections share the existing mesh/texture cache budget; never drop a whole
    // bridge just to increase the resolution of another one.
    let spareSections = Math.max(0, MAX_BRIDGES - this.sampledBridges.length);
    const entries = this.sampledBridges.flatMap((bridge) => {
      const sections = bridgeTextureSections(bridge, Math.min(MAX_TEXTURE_SECTIONS, spareSections + 1));
      spareSections -= sections.length - 1;
      return sections.map((section) => ({ ...section, key: bridgeResourceKey(section.bridge) }));
    });
    const activeKeys = new Set(entries.map((entry) => entry.key));
    const missing = [...activeKeys].filter((key) => !this.bridgeResources.has(key)).length;
    // Evict before allocating so tile replacement does not double texture memory.
    for (const [key, resource] of this.bridgeResources) {
      if (this.bridgeResources.size + missing <= MAX_BRIDGES) break;
      if (activeKeys.has(key)) continue;
      this.disposeResource(resource);
      this.bridgeResources.delete(key);
    }
    this.pierOrigin = this.sceneOrigin;
    this.pierOriginElevation = this.sceneOriginElevation;
    pierMesh.position.set(0, 0, 0);
    pierMesh.scale.set(1, 1, 1);

    const night = Math.max(this.darkMode ? 0.45 : 0, this.nightMix);
    const azimuth = CARTOON_SUN_AZIMUTH_DEGREES * DEGREES_TO_RADIANS;
    const shadowEast = -Math.sin(azimuth) * SHADOW_OFFSET_METERS;
    const shadowNorth = -Math.cos(azimuth) * SHADOW_OFFSET_METERS;
    let pierCount = 0;

    for (const { bridge, paintBridge, key } of entries) {
      const heights = JSON.stringify(bridge.surface.map((point) => [point.ground, point.deck]));
      let resource = this.bridgeResources.get(key);
      if (resource) {
        this.bridgeResources.delete(key);
        this.bridgeResources.set(key, resource);
        this.performanceStats.reused += 1;
        if (resource.heights !== heights) {
          const deckPositions = resource.deck.geometry.getAttribute('position') as THREE.BufferAttribute;
          const shadowPositions = resource.shadow.geometry.getAttribute('position') as THREE.BufferAttribute;
          bridge.surface.forEach((point, index) => {
            deckPositions.setY(index, point.deck - resource!.elevation);
            shadowPositions.setY(index, point.ground - resource!.elevation + 0.12);
          });
          deckPositions.needsUpdate = true;
          shadowPositions.needsUpdate = true;
          resource.deck.geometry.computeVertexNormals();
          resource.heights = heights;
          this.performanceStats.heightUpdates += 1;
        }
      } else {
        const canvas = this.paintDeck(paintBridge);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = Math.min(8, this.renderer?.capabilities.getMaxAnisotropy() ?? 1);
        texture.needsUpdate = true;

        const deckPoints = bridge.surface.map((point) => this.toLocal(point.longitude, point.latitude, point.deck));
        const groundPoints = bridge.surface.map((point) => this.toLocal(
          point.longitude,
          point.latitude,
          point.ground,
        )).map((point) => ({
          east: point.east + shadowEast,
          north: point.north + shadowNorth,
          up: point.up + 0.12,
        }));
        const plan = paintBridge.surface;

        const deckGeometry = texturedIndexedGeometry(deckPoints, plan, paintBridge.bounds, bridge.indices);
        const shadowGeometry = texturedIndexedGeometry(groundPoints, plan, paintBridge.bounds, bridge.indices);
        if (!deckGeometry || !shadowGeometry) {
          deckGeometry?.dispose();
          shadowGeometry?.dispose();
          texture.dispose();
          continue;
        }

        const deckMaterial = new THREE.MeshBasicMaterial({
          toneMapped: false,
          map: texture,
          transparent: true,
          alphaTest: 0.2,
          side: THREE.DoubleSide,
          forceSinglePass: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        });

        const deckMesh = new THREE.Mesh(deckGeometry, deckMaterial);
        deckMesh.frustumCulled = false;
        const shadowMaterial = new THREE.MeshBasicMaterial({
          map: texture,
          color: CARTOON_SHADOW_COLOR,
          transparent: true,
          opacity: 0.32 * (1 - night * 0.65),
          alphaTest: 0.2,
          depthWrite: false,
          side: THREE.DoubleSide,
          forceSinglePass: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        });
        const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
        shadowMesh.frustumCulled = false;

        resource = {
          paintBridge,
          paintSignature: this.paintSignature,
          deck: deckMesh, shadow: shadowMesh, origin: this.sceneOrigin,
          elevation: this.sceneOriginElevation, heights,
        };
        this.bridgeResources.set(key, resource);
        this.performanceStats.built += 1;
      }
      this.decks.add(resource.deck, resource.shadow);
    }

    // Piers belong to the original span, not individual texture sections.
    for (const bridge of this.sampledBridges) {
      for (const pier of bridge.piers ?? []) {
        if (pierCount >= MAX_PIERS) break;
        const local = this.toLocal(pier.longitude, pier.latitude, pier.ground);
        const height = pier.deck - pier.ground;
        this.transformHelper.position.set(local.east, local.up + height / 2, local.north);
        this.transformHelper.rotation.set(0, 0, 0);
        this.transformHelper.scale.set(1, height, 1);
        this.transformHelper.updateMatrix();
        pierMesh.setMatrixAt(pierCount, this.transformHelper.matrix);
        pierCount += 1;
      }
    }

    this.positionResources();
    this.applyLighting();
    pierMesh.count = pierCount;
    pierMesh.instanceMatrix.needsUpdate = true;
    pierMesh.visible = pierCount > 0;
  }

  private positionResources() {
    const units = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin).meterInMercatorCoordinateUnits();
    const position = (object: THREE.Object3D, origin: maplibregl.LngLat, elevation: number) => {
      const local = this.toLocal(origin.lng, origin.lat, elevation);
      const scale = maplibregl.MercatorCoordinate.fromLngLat(origin).meterInMercatorCoordinateUnits() / units;
      object.position.set(local.east, local.up, local.north);
      object.scale.set(scale, 1, scale);
    };
    for (const resource of this.bridgeResources.values()) {
      position(resource.deck, resource.origin, resource.elevation);
      position(resource.shadow, resource.origin, resource.elevation);
    }
    if (this.pierMesh) position(this.pierMesh, this.pierOrigin, this.pierOriginElevation);
  }

  private disposeResource(resource: BridgeResources) {
    resource.deck.geometry.dispose();
    resource.shadow.geometry.dispose();
    resource.deck.material.map?.dispose();
    resource.deck.material.dispose();
    resource.shadow.material.dispose();
  }

  private clearDeckGroup() {
    this.decks.clear();
    this.bridgeResources.forEach((resource) => this.disposeResource(resource));
    this.bridgeResources.clear();
  }

  private clearMeshes() {
    this.clearDeckGroup();
    if (this.pierMesh) {
      this.pierMesh.count = 0;
      this.pierMesh.visible = false;
      this.pierMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private beginDrapedHandoff() {
    if (this.drapedHandoff) return;
    this.drapedHandoff = { frames: 0 };
    this.setDrapedVisible(true);
  }

  private cancelDrapedHandoff() {
    if (!this.drapedHandoff) return;
    this.drapedHandoff = undefined;
    this.bridgeOpacity = 1;
    this.applyLighting();
    this.setDrapedVisible(false);
  }

  private finishDrapedHandoff() {
    if (this.sampledBridges.length > 0) this.lastUpdateSignature = undefined;
    this.drapedHandoff = undefined;
    this.bridgeOpacity = 1;
    this.sampledBridges = [];
    this.clearMeshes();
    this.setDrapedVisible(true);
  }

  private advanceDrapedHandoff(now: number) {
    const handoff = this.drapedHandoff!;
    const map = this.map!;
    handoff.frames += 1;
    // Visibility changes rebuild MapLibre buckets asynchronously. Allow complete
    // map frames after restoring them, and retain the mesh while tiles are pending.
    const ready = (map.isStyleLoaded?.() ?? true) && (map.isSourceLoaded?.(this.sourceId) ?? true);
    if (handoff.frames < 3 || !ready) {
      if (!ready && handoff.fadeStarted !== undefined) {
        handoff.fadeStarted = undefined;
        this.bridgeOpacity = 1;
        this.applyLighting();
      }
      if (handoff.frames < 3) map.triggerRepaint();
      return true;
    }
    handoff.fadeStarted ??= now;
    const progress = Math.min(1, (now - handoff.fadeStarted) / BRIDGE_HANDOFF_FADE_MS);
    if (progress >= 1) {
      this.finishDrapedHandoff();
      return false;
    }
    this.bridgeOpacity = 1 - progress * progress * (3 - 2 * progress);
    this.applyLighting();
    map.triggerRepaint();
    return true;
  }

  private setDrapedVisible(visible: boolean) {
    if (this.drapedVisible === visible) return;
    const map = this.map;
    if (!map) return;
    setDrapedElevatedBridgeLayersVisible(map, visible);
    this.drapedVisible = visible;
  }

  private paintSignature = '';
  private paintValues = new Map<string, unknown>();
  private paintExpressions = new Map<string, ReturnType<typeof createExpression>>();

  private refreshDeckPaint() {
    const map = this.map;
    if (!map?.getPaintProperty) return;
    const ids = ['global-roads', 'global-road-casing', 'global-railways',
      'global-railway-bed', 'global-footways', 'global-path-casing',
      'global-cycleways', 'global-cycleway-casing', 'global-tracks', 'global-bridge-decks'];
    const values = ids.map((id) => [id, map.getLayer(id)
      ? map.getPaintProperty(id, id === 'global-bridge-decks' ? 'fill-color' : 'line-color') : undefined] as const);
    const signature = JSON.stringify(values);
    if (signature !== this.paintSignature) {
      this.paintSignature = signature;
      this.paintValues = new Map(values);
      this.paintExpressions.clear();
    }
    for (const resource of this.bridgeResources.values()) {
      if (resource.paintSignature === signature) continue;
      const texture = resource.deck.material.map!;
      texture.image = this.paintDeck(resource.paintBridge);
      texture.needsUpdate = true;
      resource.paintSignature = signature;
    }
  }

  private paintDeck(bridge: SampledBridge) {
    return paintBridgeCluster(bridge.surfaces, bridge.parts, bridge.bounds, (part) => {
      const properties = part.properties;
      if (!properties) return part;
      const rail = properties.className === 'rail' || properties.className === 'transit';
      const path = isPathClass(properties.className);
      const cycle = properties.subclass === 'cycleway';
      const fillLayer = part.kind === 'polygon' ? 'global-bridge-decks'
        : rail ? 'global-railways' : path
          ? properties.className === 'track' ? 'global-tracks' : cycle ? 'global-cycleways' : 'global-footways'
          : 'global-roads';
      const edgeLayer = rail ? 'global-railway-bed' : path
        ? cycle ? 'global-cycleway-casing' : 'global-path-casing'
        : 'global-road-casing';
      const color = (id: string, fallback: string) => {
        const value = this.paintValues.get(id);
        if (typeof value === 'string') return value;
        if (!Array.isArray(value)) return fallback;
        let compiled = this.paintExpressions.get(id);
        if (!compiled) {
          compiled = createExpression(value, 'bridge-color');
          this.paintExpressions.set(id, compiled);
        }
        if (compiled.result !== 'success') return fallback;
        const result = compiled.value.evaluate({ zoom: this.map?.getZoom() ?? 16 }, {
          type: part.kind === 'polygon' ? 'Polygon' : 'LineString',
          properties: { ...properties, class: properties.className, brunnel: 'bridge' },
        });
        return typeof result === 'string' ? result : fallback;
      };
      const fill = color(fillLayer, part.fill);
      // Keep the active rail palette tint, but give the broad deck a light gray surface.
      const deckFill = rail
        ? `#${new THREE.Color(fill).lerp(new THREE.Color('#dedede'), 0.65).getHexString()}`
        : fill;
      return { fill: deckFill, edge: color(edgeLayer, part.edge), rail: rail ? fill : undefined };
    }, bridge.texturePixelBudget);
  }

  private applyLighting() {
    const night = Math.max(this.darkMode ? 0.75 : 0, this.nightMix);
    if (this.hemisphereLight) this.hemisphereLight.intensity = 0.55 + (1 - night) * 1.25;
    if (this.sunlight) {
      this.sunlight.intensity = 0.5 + (1 - night) * 1.9;
      this.sunlight.color.set(night > 0.65 ? 0xc8d4f0 : CARTOON_SUN_COLOR);
    }
    if (this.pierMesh) {
      const materials = Array.isArray(this.pierMesh.material) ? this.pierMesh.material : [this.pierMesh.material];
      for (const material of materials) material.opacity = this.bridgeOpacity;
    }
    const deckNight = Math.max(this.darkMode ? 0.45 : 0, this.nightMix);
    for (const child of this.decks.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const material = child.material;
      if (material instanceof THREE.MeshBasicMaterial && !material.depthWrite) {
        material.opacity = 0.32 * (1 - deckNight * 0.65) * this.bridgeOpacity;
      } else if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = this.bridgeOpacity;
      }
    }
  }
}

/** Spend the texture budget along the span, independent of compass bearing. */
export function bridgeTexturePlan(bridge: SampledBridge): SampledBridge {
  const points = bridge.surfaces.flatMap((surface) => surface.outer);
  if (!points.length) return bridge;
  const axis = spanAxis(points);
  const origin = points[0];
  const project = <T extends PlanPoint>(point: T): T => {
    const east = point.east - origin.east;
    const north = point.north - origin.north;
    return { ...point, east: east * axis.east + north * axis.north,
      north: -east * axis.north + north * axis.east };
  };
  const surface = bridge.surface.map(project);
  const surfaces = bridge.surfaces.map((part) => ({
    outer: part.outer.map(project), holes: part.holes.map((hole) => hole.map(project)),
  }));
  const parts = bridge.parts.map((part) => ({ ...part, plan: part.plan.map(project),
    holes: part.holes?.map((hole) => hole.map(project)) }));
  return { ...bridge, surface, surfaces, parts,
    bounds: planBounds([...surface, ...surfaces.flatMap((part) => part.outer)], 2) };
}

/** Clip mesh triangles only; retain the full drawing so paint continues across joins. */
export function bridgeTextureSections(bridge: SampledBridge, maxSections = MAX_TEXTURE_SECTIONS) {
  const paintBridge = bridgeTexturePlan(bridge);
  const { minEast, maxEast } = paintBridge.bounds;
  const length = maxEast - minEast;
  const count = length <= 512 ? 1 : Math.min(maxSections, Math.ceil(length / TEXTURE_SECTION_METRES));
  if (count <= 1) return [{ bridge, paintBridge }];
  const cuts = Array.from({ length: count - 1 }, (_, index) => minEast + length * (index + 1) / count);
  const split = splitBridgeMesh(paintBridge.surface.map((point, index) => ({
    ...point, worldEast: bridge.surface[index].east, worldNorth: bridge.surface[index].north,
  })), bridge.indices, cuts, (point) => point.east);
  const groups: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < split.indices.length; i += 3) {
    const triangle = split.indices.slice(i, i + 3);
    const center = triangle.reduce((sum, index) => sum + split.points[index].east, 0) / 3;
    const section = Math.max(0, Math.min(count - 1, Math.floor((center - minEast) / length * count)));
    groups[section].push(...triangle);
  }
  return groups.flatMap((indices, section) => {
    if (!indices.length) return [];
    const vertices = [...new Set(indices)];
    const remap = new Map(vertices.map((index, local) => [index, local]));
    const localIndices = indices.map((index) => remap.get(index)!);
    const projected = vertices.map((index) => split.points[index]);
    const surface = projected.map(({ worldEast, worldNorth, ...point }) => ({ ...point,
      east: worldEast, north: worldNorth }));
    // Padding supplies neighboring paint for linear filtering at the shared edge.
    const padding = 2 / MAX_CANVAS_PIXELS_PER_METRE;
    const bounds = { ...paintBridge.bounds,
      minEast: minEast + length * section / count - padding,
      maxEast: minEast + length * (section + 1) / count + padding };
    const texturePixelBudget = Math.floor(MAX_TEXTURE_PIXELS_PER_BRIDGE / count);
    return [{ bridge: { ...bridge, surface, indices: localIndices, bounds: planBounds(surface, 2), texturePixelBudget },
      paintBridge: { ...paintBridge, surface: projected, indices: localIndices, bounds, texturePixelBudget } }];
  });
}

function texturedIndexedGeometry(
  points: LocalPoint[],
  plan: PlanPoint[],
  bounds: PlanBounds,
  indices: number[],
) {
  if (points.length < 3 || plan.length !== points.length || indices.length < 3) return null;
  const spanEast = Math.max(1, bounds.maxEast - bounds.minEast);
  const spanNorth = Math.max(1, bounds.maxNorth - bounds.minNorth);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    positions.push(points[index].east, points[index].up, points[index].north);
    uvs.push(
      (plan[index].east - bounds.minEast) / spanEast,
      (bounds.maxNorth - plan[index].north) / spanNorth,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Millimetre plan precision avoids cache misses from floating-point origin shifts. */
function bridgeResourceKey(bridge: SampledBridge) {
  const anchor = bridge.surface[0];
  const relative = (point: PlanPoint) => [
    Number((point.east - anchor.east).toFixed(3)),
    Number((point.north - anchor.north).toFixed(3)),
  ];
  return JSON.stringify({
    coordinates: bridge.surface.map((point) => [Number(point.longitude.toFixed(9)), Number(point.latitude.toFixed(9))]),
    plan: bridge.surface.map(relative),
    indices: bridge.indices,
    surfaces: bridge.surfaces.map((surface) => [surface.outer.map(relative), surface.holes.map((hole) => hole.map(relative))]),
    parts: bridge.parts.map((part) => ({ ...part, plan: part.plan.map(relative), holes: part.holes?.map((hole) => hole.map(relative)) })),
    bounds: [relative({ east: bridge.bounds.minEast, north: bridge.bounds.minNorth }), relative({ east: bridge.bounds.maxEast, north: bridge.bounds.maxNorth })],
  });
}
