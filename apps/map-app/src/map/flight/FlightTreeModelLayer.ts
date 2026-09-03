import * as maplibregl from 'maplibre-gl';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';
import {
  CARTOON_AMBIENT_GROUND_COLOR,
  CARTOON_AMBIENT_SKY_COLOR,
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_COLOR,
  CARTOON_SUN_POLAR_DEGREES,
} from '../CartoonLighting';


const TREE_MIN_ZOOM = 12;
const TREE_MAX_VIEWPORT_METERS = 4_000;
// Flight keeps trees within a fixed radius of the aircraft instead of using
// the viewport-span cutoff above (see metricBoundsAroundPoint for why).
const FLIGHT_TREE_RADIUS_METERS = 2_500;
// New procedural trees may only spawn outside this radius so they do not pop
// in under the nose. Trees restored from the retention cache are exempt.
const FLIGHT_NEW_TREE_MIN_RADIUS_METERS = 1_200;
// Cap how many new far-ring trees a single scan may queue. Admission spreads
// them across later frames so they do not appear as one sudden batch.
const FLIGHT_MAX_NEW_TREES_PER_UPDATE = 120;
const FLIGHT_PENDING_TREE_LIMIT = 360;
const FLIGHT_TREES_ADMIT_PER_FRAME = 6;
const FLIGHT_TREE_GROWTH_DURATION_MS = 1_100;
const FLIGHT_GROWTH_MESH_WRITE_MS = 50;
const FLIGHT_ORIGIN_REBASE_METERS = 4_000;
const FLIGHT_UPDATE_MIN_INTERVAL_MS = 200;
const FLIGHT_UPDATE_MOVE_METERS = 300;
const FLIGHT_STALE_REFRESH_MS = 3_000;
const MAX_TREE_COUNT = 8000;
const MAX_RETAINED_TREE_COUNT = MAX_TREE_COUNT;
const MAX_ELEVATION_CACHE_ENTRIES = MAX_TREE_COUNT * 2;
const FOREST_TREE_SPACING_METERS = 26;
const PARK_TREE_SPACING_METERS = 30;
const SHRUB_SPACING_METERS = 20;
const ORCHARD_TREE_SPACING_METERS = 24;
const MAPPED_TREE_CLEARANCE_METERS = 9;
const TRUNK_CANOPY_OVERLAP_METERS = 0.25;
const TREE_GROWTH_DURATION_MS = 600;
const MAX_GRID_CELLS_PER_POLYGON = 100_000;
// Skip only rings that are both huge and geographically vast. Detailed local
// forest outlines can exceed a few thousand points without being dangerous.
const MAX_POLYGON_RING_POINTS = 12_000;
const MAX_POLYGON_RING_SPAN_DEGREES = 0.2;
const SUN_AZIMUTH_RADIANS = CARTOON_SUN_AZIMUTH_DEGREES * Math.PI / 180;
const SUN_POLAR_RADIANS = CARTOON_SUN_POLAR_DEGREES * Math.PI / 180;
const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const MIN_LONGITUDE_SCALE = Math.cos(85 * DEGREES_TO_RADIANS);

export type TreeSourceConfig = {
  sourceId: string;
  waterLayers: string[];
  vegetationLayers: string[];
  mappedTreeLayer?: string;
};

type SourceFeature = ReturnType<MaplibreMap['querySourceFeatures']>[number];

type VegetationType = 'broadleaf' | 'conifer' | 'shrub';

type TreeInstance = {
  longitude: number;
  latitude: number;
  height: number;
  leafType: string;
  vegetationType: VegetationType;
  rotation: number;
  widthScale: number;
  colorVariation: number;
};

type MetricPoint = [number, number];

type MetricBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type MetricPolygon = {
  rings: MetricPoint[][];
  bounds: MetricBounds;
};

type ProceduralTreeCandidate = TreeInstance & {
  priority: number;
};

type DisplayedTree = {
  tree: TreeInstance;
  elevation: number;
  mercatorX: number;
  mercatorY: number;
  east: number;
  north: number;
  up: number;
  growthStart: number;
  growthDuration: number;
};

function featureCoordinates(feature: SourceFeature): number[][] {
  const geometry = feature.geometry;
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates.map(Number)];
  }
  if (geometry?.type === 'MultiPoint' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map((coordinates) => coordinates.map(Number));
  }
  return [];
}

function coordinateSeed(longitude: number, latitude: number) {
  const longitudeKey = Math.round((longitude + 180) * 1_000_000);
  const latitudeKey = Math.round((latitude + 90) * 1_000_000);
  return (Math.imul(longitudeKey, 73_856_093) ^ Math.imul(latitudeKey, 19_349_663)) >>> 0;
}

function seededUnit(seed: number, salt: number) {
  let value = Math.imul(seed ^ salt, 2_246_822_519);
  value ^= value >>> 13;
  value = Math.imul(value, 3_266_489_917);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_295;
}

function treeInstance(
  longitude: number,
  latitude: number,
  seed: number,
  leafType: string,
  height: number,
  vegetationType?: VegetationType,
): TreeInstance {
  const normalizedLeafType = leafType.toLowerCase();
  return {
    longitude,
    latitude,
    height,
    leafType,
    vegetationType: vegetationType ?? (
      normalizedLeafType.includes('needle')
        ? 'conifer'
        : 'broadleaf'
    ),
    rotation: seededUnit(seed, 23) * Math.PI * 2,
    widthScale: 0.82 + seededUnit(seed, 37) * 0.36,
    colorVariation: seededUnit(seed, 51),
  };
}

function collectTreeInstances(sourceFeatures: SourceFeature[]) {
  const trees: TreeInstance[] = [];
  const seen = new Set<string>();

  for (const feature of sourceFeatures) {
    for (const coordinates of featureCoordinates(feature)) {
      if (coordinates.length < 2 || trees.length >= MAX_TREE_COUNT) continue;
      const [longitude, latitude] = coordinates;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;

      const key = `${longitude.toFixed(6)}:${latitude.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const properties = feature.properties ?? {};
      const seed = coordinateSeed(longitude, latitude);
      const taggedHeight = Number(properties.height);
      const height = Number.isFinite(taggedHeight) && taggedHeight > 3
        ? Math.min(taggedHeight, 24)
        : 9 + seededUnit(seed, 11) * 6;

      trees.push(treeInstance(
        longitude,
        latitude,
        seed,
        String(properties.leaf_type ?? 'broadleaved'),
        height,
      ));
    }
  }

  return trees;
}

function toMetricPoint(coordinates: number[]): MetricPoint | undefined {
  if (coordinates.length < 2) return undefined;
  const [longitude, latitude] = coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  return [
    longitude * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS,
    latitude * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS,
  ];
}

function fromMetricPoint([x, y]: MetricPoint) {
  return new maplibregl.LngLat(
    x / EARTH_RADIUS_METERS * RADIANS_TO_DEGREES,
    y / EARTH_RADIUS_METERS * RADIANS_TO_DEGREES,
  );
}

function longitudeScaleAtMetricY(y: number) {
  return Math.max(MIN_LONGITUDE_SCALE, Math.cos(y / EARTH_RADIUS_METERS));
}

function horizontalGridSpacing(cellY: number, spacing: number) {
  const rowCenterY = (cellY + 0.5) * spacing;
  return spacing / longitudeScaleAtMetricY(rowCenterY);
}

function metricDistanceSquared(first: MetricPoint, second: MetricPoint) {
  const averageY = (first[1] + second[1]) * 0.5;
  const eastWest = (first[0] - second[0]) * longitudeScaleAtMetricY(averageY);
  const northSouth = first[1] - second[1];
  return eastWest ** 2 + northSouth ** 2;
}

function sourceFeatures(
  map: MaplibreMap,
  sourceId: string,
  sourceLayers: string[],
): SourceFeature[] {
  const validLayers = [...new Set(sourceLayers.filter(Boolean))];
  if (!validLayers.length || !map.getSource(sourceId)) return [];
  return validLayers.flatMap((sourceLayer) => {
    try {
      return map.querySourceFeatures(sourceId, { sourceLayer });
    } catch (error) {
      console.warn(`Could not query optional source layer ${sourceLayer}`, error);
      return [];
    }
  });
}

export function treeViewportSignature(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  pitch: number,
  terrainSourceId: string,
  terrainEnabled: boolean,
  terrainZoomBucket: number,
) {
  const zoomBucket = Math.round(zoom * 2) / 2;
  const pitchBucket = Math.round(pitch / 5) * 5;
  const normalizedBounds = {
    west: Number(bounds.west.toFixed(4)),
    south: Number(bounds.south.toFixed(4)),
    east: Number(bounds.east.toFixed(4)),
    north: Number(bounds.north.toFixed(4)),
  };
  return [
    terrainSourceId,
    terrainEnabled ? '1' : '0',
    terrainZoomBucket,
    zoomBucket.toFixed(2),
    pitchBucket,
    normalizedBounds.west,
    normalizedBounds.south,
    normalizedBounds.east,
    normalizedBounds.north,
  ].join(':');
}

function visibleMetricBounds(
  map: MaplibreMap,
  paddingMeters = 0,
): MetricBounds {
  const bounds = map.getBounds();
  const southWest = toMetricPoint([bounds.getWest(), bounds.getSouth()])!;
  const northEast = toMetricPoint([bounds.getEast(), bounds.getNorth()])!;
  const centerY = (southWest[1] + northEast[1]) * 0.5;
  const horizontalPadding = paddingMeters
    / longitudeScaleAtMetricY(centerY);
  return {
    minX: Math.min(southWest[0], northEast[0]) - horizontalPadding,
    minY: Math.min(southWest[1], northEast[1]) - paddingMeters,
    maxX: Math.max(southWest[0], northEast[0]) + horizontalPadding,
    maxY: Math.max(southWest[1], northEast[1]) + paddingMeters,
  };
}

// map.getBounds() unprojects the screen's corners to find the visible area,
// which breaks down under flight's combined steep pitch and roll: a corner
// can rotate to no longer intersect the ground at all, and the resulting
// bounds shrink on that side - visually still-in-view far trees get culled,
// then reappear once the aircraft levels out. A fixed radius around the
// aircraft's own ground position is immune to that per-corner degeneracy.
function metricBoundsAroundPoint(center: MetricPoint, radiusMeters: number): MetricBounds {
  const horizontalRadius = radiusMeters / longitudeScaleAtMetricY(center[1]);
  return {
    minX: center[0] - horizontalRadius,
    minY: center[1] - radiusMeters,
    maxX: center[0] + horizontalRadius,
    maxY: center[1] + radiusMeters,
  };
}

function displayedTreeKey(tree: TreeInstance) {
  // Identity is geographic, not visual. A vector-tile refresh can classify
  // the same procedural point as broadleaf/conifer (or shrub) when overlapping
  // landuse features arrive in a different order. Keeping the key tied only
  // to the rounded world position prevents that refresh from removing and
  // re-adding the tree during a zoom.
  return `${tree.longitude.toFixed(6)}:${tree.latitude.toFixed(6)}`;
}

function treeShadowOpacity(zoom: number) {
  if (zoom <= 14) return 0.1 + Math.max(0, zoom - TREE_MIN_ZOOM) * 0.04;
  return Math.min(0.27, 0.18 + (zoom - 14) * 0.045);
}

function treeGrowth(start: number, now: number, duration = TREE_GROWTH_DURATION_MS) {
  const progress = Math.min(1, Math.max(0, (now - start) / duration));
  return 1 - (1 - progress) ** 3;
}

function viewportSpanMeters(
  bounds: { west: number; south: number; east: number; north: number },
) {
  const southWest = toMetricPoint([bounds.west, bounds.south]);
  const northEast = toMetricPoint([bounds.east, bounds.north]);
  if (!southWest || !northEast) return Number.POSITIVE_INFINITY;
  const averageY = (southWest[1] + northEast[1]) * 0.5;
  // toMetricPoint's x axis ignores latitude compression (see its comment-free
  // equirectangular math above); apply the same longitude scale used
  // elsewhere in this file so the span is a real-world metre distance rather
  // than one inflated by 1/cos(latitude) at higher latitudes.
  const xSpan = Math.abs(northEast[0] - southWest[0]) * longitudeScaleAtMetricY(averageY);
  const ySpan = Math.abs(northEast[1] - southWest[1]);
  return Math.max(xSpan, ySpan);
}

export function shouldRenderTreesForViewport(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  maxViewportMeters = TREE_MAX_VIEWPORT_METERS,
) {
  if (zoom < TREE_MIN_ZOOM) return false;
  return viewportSpanMeters(bounds) <= maxViewportMeters;
}

function visibleTrees(
  map: MaplibreMap,
  sources: TreeSourceConfig,
  maxViewportMeters = TREE_MAX_VIEWPORT_METERS,
  boundsOverride?: MetricBounds,
) {
  if (!boundsOverride) {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    if (!shouldRenderTreesForViewport({
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    }, zoom, maxViewportMeters)) return [];
  }
  const budget = MAX_TREE_COUNT;
  const samplingBounds = boundsOverride ?? visibleMetricBounds(map);
  const waterFeatures = sourceFeatures(map, sources.sourceId, sources.waterLayers);
  const waterPolygons = collectMetricPolygons(waterFeatures, samplingBounds);
  const waterIndex = createSpatialPolygonIndex(waterPolygons, 400, samplingBounds);
  const mappedTreeFeatures = sources.mappedTreeLayer
    ? sourceFeatures(map, sources.sourceId, [sources.mappedTreeLayer])
    : [];
  const mappedTrees = collectTreeInstances(mappedTreeFeatures)
    .filter((tree) => withinTreeBounds(tree, samplingBounds))
    .filter((tree) => {
      const point = toMetricPoint([tree.longitude, tree.latitude]);
      return point !== undefined && !pointInIndexedPolygons(point, waterIndex);
    })
    .sort((first, second) => (
      coordinateSeed(first.longitude, first.latitude)
      - coordinateSeed(second.longitude, second.latitude)
    ))
    .slice(0, budget);
  const landuseFeatures = sourceFeatures(
    map,
    sources.sourceId,
    sources.vegetationLayers,
  );
  const proceduralTrees = collectProceduralTrees(
    landuseFeatures,
    waterIndex,
    samplingBounds,
    mappedTrees,
    Math.max(0, budget - mappedTrees.length),
  ).filter((tree) => withinTreeBounds(tree, samplingBounds));
  return [...mappedTrees, ...proceduralTrees].slice(0, budget);
}

function withinTreeBounds(tree: TreeInstance, bounds: MetricBounds) {
  const point = toMetricPoint([tree.longitude, tree.latitude]);
  if (!point) return false;
  return point[0] >= bounds.minX && point[0] <= bounds.maxX
    && point[1] >= bounds.minY && point[1] <= bounds.maxY;
}

function featurePolygons(feature: SourceFeature): number[][][][] {
  const geometry = feature.geometry;
  if (geometry?.type === 'Polygon') return [geometry.coordinates as number[][][]];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates as number[][][][];
  return [];
}

function metricPolygon(rings: number[][][]) {
  return rings
    .map((ring) => ring
      .map((coordinates) => toMetricPoint(coordinates))
      .filter((point): point is MetricPoint => point !== undefined))
    .filter((ring) => ring.length >= 3);
}

function pointInRing([x, y]: MetricPoint, ring: MetricPoint[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];
    const crosses = (currentY > y) !== (previousY > y)
      && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: MetricPoint, rings: MetricPoint[][]) {
  if (!rings[0] || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

function polygonBounds(rings: MetricPoint[][]): MetricBounds | undefined {
  const outerRing = rings[0];
  if (!outerRing) return undefined;
  const bounds: MetricBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const [x, y] of outerRing) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}

function boundsOverlap(first: MetricBounds, second: MetricBounds) {
  return first.minX <= second.maxX && first.maxX >= second.minX
    && first.minY <= second.maxY && first.maxY >= second.minY;
}

function lngLatBoundsOverlap(
  first: { west: number; south: number; east: number; north: number },
  second: { west: number; south: number; east: number; north: number },
) {
  return first.west <= second.east && first.east >= second.west
    && first.south <= second.north && first.north >= second.south;
}

function metricBoundsToLngLat(bounds: MetricBounds) {
  const southWest = fromMetricPoint([bounds.minX, bounds.minY]);
  const northEast = fromMetricPoint([bounds.maxX, bounds.maxY]);
  return {
    west: Math.min(southWest.lng, northEast.lng),
    south: Math.min(southWest.lat, northEast.lat),
    east: Math.max(southWest.lng, northEast.lng),
    north: Math.max(southWest.lat, northEast.lat),
  };
}

function ringSpanDegrees(bounds: { west: number; south: number; east: number; north: number }) {
  return Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
}

function isExpensivePolygonRing(ring: number[][], outerBounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}) {
  return ring.length > MAX_POLYGON_RING_POINTS
    && ringSpanDegrees(outerBounds) > MAX_POLYGON_RING_SPAN_DEGREES;
}

function ringLngLatBounds(ring: number[][]) {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const coordinates of ring) {
    if (coordinates.length < 2) continue;
    const [longitude, latitude] = coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    found = true;
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  }
  return found ? { west, south, east, north } : undefined;
}

function collectMetricPolygons(
  features: SourceFeature[],
  clipBounds?: MetricBounds,
): MetricPolygon[] {
  const clipLngLat = clipBounds ? metricBoundsToLngLat(clipBounds) : undefined;
  return features.flatMap((feature) => featurePolygons(feature).flatMap((sourcePolygon) => {
    // Low-zoom tiles expose country-scale water/landuse rings. Reject anything
    // that cannot touch the sampling window before paying for metric conversion.
    if (clipLngLat) {
      const outerBounds = ringLngLatBounds(sourcePolygon[0] ?? []);
      if (!outerBounds || !lngLatBoundsOverlap(outerBounds, clipLngLat)) return [];
      if (isExpensivePolygonRing(sourcePolygon[0] ?? [], outerBounds)) return [];
    }
    const rings = metricPolygon(sourcePolygon);
    const bounds = polygonBounds(rings);
    if (!bounds) return [];
    if (clipBounds && !boundsOverlap(bounds, clipBounds)) return [];
    return [{ rings, bounds }];
  }));
}

type SpatialPolygonIndex = {
  grid: Map<string, MetricPolygon[]>;
  cellSize: number;
};

// Cap unique cells so a missed clip cannot OOM the process. A 5 km flight
// window at 400 m cells needs <200; this is a hard safety ceiling.
const MAX_SPATIAL_INDEX_CELLS = 8_000;

function createSpatialPolygonIndex(
  polygons: MetricPolygon[],
  cellSize = 400,
  clipBounds?: MetricBounds,
): SpatialPolygonIndex {
  const grid = new Map<string, MetricPolygon[]>();
  for (const polygon of polygons) {
    let minX = polygon.bounds.minX;
    let maxX = polygon.bounds.maxX;
    let minY = polygon.bounds.minY;
    let maxY = polygon.bounds.maxY;
    if (clipBounds) {
      if (!boundsOverlap(polygon.bounds, clipBounds)) continue;
      minX = Math.max(minX, clipBounds.minX);
      maxX = Math.min(maxX, clipBounds.maxX);
      minY = Math.max(minY, clipBounds.minY);
      maxY = Math.min(maxY, clipBounds.maxY);
    }
    const minCellX = Math.floor(minX / cellSize);
    const maxCellX = Math.floor(maxX / cellSize);
    const minCellY = Math.floor(minY / cellSize);
    const maxCellY = Math.floor(maxY / cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        if (grid.size >= MAX_SPATIAL_INDEX_CELLS && !grid.has(`${cellX}:${cellY}`)) {
          return { grid, cellSize };
        }
        const key = `${cellX}:${cellY}`;
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push(polygon);
      }
    }
  }
  return { grid, cellSize };
}

function pointInIndexedPolygons(point: MetricPoint, index: SpatialPolygonIndex) {
  const cellX = Math.floor(point[0] / index.cellSize);
  const cellY = Math.floor(point[1] / index.cellSize);
  const polygons = index.grid.get(`${cellX}:${cellY}`);
  if (!polygons) return false;
  return polygons.some(({ rings, bounds }) => (
    point[0] >= bounds.minX && point[0] <= bounds.maxX
    && point[1] >= bounds.minY && point[1] <= bounds.maxY
    && pointInPolygon(point, rings)
  ));
}

function pointInAnyPolygon(point: MetricPoint, polygons: MetricPolygon[]) {
  return polygons.some(({ rings, bounds }) => (
    point[0] >= bounds.minX && point[0] <= bounds.maxX
    && point[1] >= bounds.minY && point[1] <= bounds.maxY
    && pointInPolygon(point, rings)
  ));
}

function cellSeed(cellX: number, cellY: number, kindSalt: number) {
  return (
    Math.imul(cellX, 73_856_093)
    ^ Math.imul(cellY, 19_349_663)
    ^ Math.imul(kindSalt, 83_492_791)
  ) >>> 0;
}

function coniferChance(leafType: unknown, fallback: number) {
  const normalizedLeafType = String(leafType ?? '').toLowerCase();
  if (normalizedLeafType.includes('needle')) return 1;
  if (normalizedLeafType.includes('broad')) return 0;
  if (normalizedLeafType.includes('mixed')) return 0.5;
  return fallback;
}

function createShadowTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normalizedX = (x + 0.5) / size * 2 - 1;
      const normalizedY = (y + 0.5) / size * 2 - 1;
      const distance = Math.hypot(normalizedX, normalizedY);
      const falloff = Math.max(0, Math.min(1, 1 - distance));
      const strength = falloff * falloff * (3 - 2 * falloff);
      const offset = (y * size + x) * 4;
      const value = Math.round(strength * 255);
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function mappedTreeIndex(trees: TreeInstance[]) {
  const index = new Map<string, MetricPoint[]>();
  for (const tree of trees) {
    const point = toMetricPoint([tree.longitude, tree.latitude]);
    if (!point) continue;
    const cellY = Math.floor(point[1] / MAPPED_TREE_CLEARANCE_METERS);
    const cellX = Math.floor(
      point[0] / horizontalGridSpacing(cellY, MAPPED_TREE_CLEARANCE_METERS),
    );
    const key = `${cellX}:${cellY}`;
    const bucket = index.get(key) ?? [];
    bucket.push(point);
    index.set(key, bucket);
  }
  return index;
}

function nearMappedTree(point: MetricPoint, index: Map<string, MetricPoint[]>) {
  const cellY = Math.floor(point[1] / MAPPED_TREE_CLEARANCE_METERS);
  const clearanceSquared = MAPPED_TREE_CLEARANCE_METERS ** 2;
  for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
    const nearbyCellY = cellY + yOffset;
    const nearbySpacing = horizontalGridSpacing(
      nearbyCellY,
      MAPPED_TREE_CLEARANCE_METERS,
    );
    const nearbyCellX = Math.floor(point[0] / nearbySpacing);
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      const bucket = index.get(`${nearbyCellX + xOffset}:${nearbyCellY}`) ?? [];
      if (bucket.some((mappedPoint) => (
        metricDistanceSquared(mappedPoint, point) < clearanceSquared
      ))) {
        return true;
      }
    }
  }
  return false;
}

function collectProceduralTrees(
  sourceFeatures: SourceFeature[],
  waterIndex: SpatialPolygonIndex,
  bounds: MetricBounds,
  mappedTrees: TreeInstance[],
  availableCount: number,
) {
  if (availableCount <= 0) return [];

  const mappedIndex = mappedTreeIndex(mappedTrees);
  const candidates = new Map<string, ProceduralTreeCandidate>();
  const clipLngLat = metricBoundsToLngLat(bounds);

  for (const feature of sourceFeatures) {
    const landClass = String(feature.properties?.class ?? '').toLowerCase();
    const landSubclass = String(feature.properties?.subclass ?? '').toLowerCase();
    const isForest = landClass === 'forest' || landClass === 'wood';
    // OpenFreeMap commonly encodes parks as grass with subclass=park, while
    // the local source uses class=park. Support both schemas.
    const isPark = landClass === 'park' || landSubclass === 'park';
    const isShrubland = landClass === 'scrub'
      || ['scrub', 'shrubbery', 'heath'].includes(landSubclass);
    const isOrchard = landClass === 'orchard' || landSubclass === 'orchard';
    if (!isForest && !isPark && !isShrubland && !isOrchard) continue;

    const spacing = isShrubland
      ? SHRUB_SPACING_METERS
      : isOrchard ? ORCHARD_TREE_SPACING_METERS
        : isForest ? FOREST_TREE_SPACING_METERS : PARK_TREE_SPACING_METERS;
    const kind = isShrubland
      ? 'shrub'
      : isOrchard ? 'orchard' : isForest ? 'forest' : 'park';
    const kindSalt = isShrubland ? 3 : isOrchard ? 4 : isForest ? 1 : 2;
    const featureConiferChance = coniferChance(
      feature.properties?.leaf_type,
      isForest ? 0.62 : 0.28,
    );

    for (const sourcePolygon of featurePolygons(feature)) {
      const outerBounds = ringLngLatBounds(sourcePolygon[0] ?? []);
      if (!outerBounds || !lngLatBoundsOverlap(outerBounds, clipLngLat)) continue;
      if (isExpensivePolygonRing(sourcePolygon[0] ?? [], outerBounds)) continue;

      const polygon = metricPolygon(sourcePolygon);
      const sourceBounds = polygonBounds(polygon);
      if (!sourceBounds) continue;

      const minX = Math.max(sourceBounds.minX, bounds.minX);
      const minY = Math.max(sourceBounds.minY, bounds.minY);
      const maxX = Math.min(sourceBounds.maxX, bounds.maxX);
      const maxY = Math.min(sourceBounds.maxY, bounds.maxY);
      if (minX > maxX || minY > maxY) continue;

      // Safety-step from the clipped window only. Using the full source
      // polygon made large forests step by many cells and look empty inside
      // the flight/view radius, while the clipped region is already bounded
      // (~4–5 km) so gridStep stays 1 in normal use.
      const clipFirstCellY = Math.floor(minY / spacing);
      const clipLastCellY = Math.floor(maxY / spacing);
      const clipMiddleCellY = Math.floor((clipFirstCellY + clipLastCellY) * 0.5);
      const clipHSpacing = horizontalGridSpacing(clipMiddleCellY, spacing);
      const clipCols = Math.ceil((maxX - minX) / clipHSpacing) + 1;
      const clipCellCount = clipCols * (clipLastCellY - clipFirstCellY + 1);
      const safetyStep = Math.ceil(Math.sqrt(clipCellCount / MAX_GRID_CELLS_PER_POLYGON));
      const gridStep = Math.max(1, safetyStep);

      const firstCellY = clipFirstCellY;
      const lastCellY = clipLastCellY;
      const alignedCellY = Math.ceil(firstCellY / gridStep) * gridStep;

      for (let cellY = alignedCellY; cellY <= lastCellY; cellY += gridStep) {
        // Longitude degrees get physically narrower toward the poles. Each
        // latitude row therefore has its own world-anchored horizontal cell
        // width, preserving approximate metre spacing without camera state.
        const horizontalSpacing = horizontalGridSpacing(cellY, spacing);
        const firstCellX = Math.floor(minX / horizontalSpacing);
        const lastCellX = Math.floor(maxX / horizontalSpacing);
        const alignedCellX = Math.ceil(firstCellX / gridStep) * gridStep;

        for (let cellX = alignedCellX; cellX <= lastCellX; cellX += gridStep) {
          const key = `${kind}:${cellX}:${cellY}`;
          if (candidates.has(key)) continue;

          const seed = cellSeed(cellX, cellY, kindSalt);
          // Keep deterministic open pockets inside large vegetation polygons.
          // This breaks the regular grid into loose groups without making the
          // placement change between camera moves.
          const clusterSeed = cellSeed(
            Math.floor(cellX / 4),
            Math.floor(cellY / 4),
            kindSalt + 19,
          );
          const clearingChance = isPark ? 0.16 : isForest ? 0.08 : 0.1;
          if (seededUnit(clusterSeed, 149) < clearingChance) continue;
          const jitterX = (seededUnit(seed, 67) - 0.5) * horizontalSpacing * 0.7;
          const jitterY = (seededUnit(seed, 79) - 0.5) * spacing * 0.82;
          const point: MetricPoint = [
            (cellX + 0.5) * horizontalSpacing + jitterX,
            (cellY + 0.5) * spacing + jitterY,
          ];
          if (!pointInPolygon(point, polygon)
            || pointInIndexedPolygons(point, waterIndex)
            || nearMappedTree(point, mappedIndex)) continue;

          const location = fromMetricPoint(point);
          const leafType = seededUnit(seed, 89) < featureConiferChance
            ? 'needleleaved'
            : 'broadleaved';
          const vegetationType: VegetationType = isShrubland
            ? 'shrub'
            : leafType === 'needleleaved' ? 'conifer'
              : isOrchard ? 'broadleaf'
                : isPark && seededUnit(seed, 113) < 0.12 ? 'shrub'
                  : 'broadleaf';
          const baseHeight = vegetationType === 'shrub'
            ? 1.4 + seededUnit(seed, 97) * 2.2
            : isOrchard ? 4.5 + seededUnit(seed, 97) * 3
              : (isForest ? 8.5 : 7.5)
                + seededUnit(seed, 97) * (isForest ? 7.5 : 6);
          const height = baseHeight + (leafType === 'needleleaved' ? 1.5 : 0);
          candidates.set(key, {
            ...treeInstance(
              location.lng,
              location.lat,
              seed,
              leafType,
              height,
              vegetationType,
            ),
            priority: seededUnit(seed, 107),
          });
        }
      }
    }
  }

  const sortedCandidates = [...candidates.values()]
    .sort((first, second) => first.priority - second.priority);

  // Pick one candidate per deterministic world-space bucket before filling
  // the remaining budget. Sorting only by random priority can select a dense
  // local patch when the viewport expands during a zoom-out.
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const bucketSize = Math.max(
    32,
    Math.sqrt((boundsWidth * boundsHeight) / Math.max(1, availableCount)),
  );
  const selected: ProceduralTreeCandidate[] = [];
  const selectedKeys = new Set<string>();

  for (const candidate of sortedCandidates) {
    const point = toMetricPoint([candidate.longitude, candidate.latitude]);
    if (!point) continue;
    const bucketKey = `${Math.floor(point[0] / bucketSize)}:${Math.floor(point[1] / bucketSize)}`;
    if (selectedKeys.has(bucketKey)) continue;
    selectedKeys.add(bucketKey);
    selected.push(candidate);
    if (selected.length >= availableCount) break;
  }

  // Deliberately do not fill the remaining budget. The budget is a maximum,
  // not a target: filling it would reintroduce locally dense patches when a
  // larger, lower-zoom viewport contains many more candidates.
  return selected.map(({ priority: _priority, ...tree }) => tree);
}

export class FlightTreeModelLayer implements CustomLayerInterface {
  readonly id = 'flight-tree-models-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly transformHelper = new THREE.Object3D();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly displayedTrees = new Map<string, DisplayedTree>();
  // Trees that leave the flight radius are kept here so turning back restores
  // the same instances instead of a freshly sampled procedural layout.
  private readonly retainedTrees = new Map<string, DisplayedTree>();
  // Far-ring trees waiting to fade in across several frames during flight.
  private readonly pendingFlightTrees: TreeInstance[] = [];
  private readonly pendingFlightTreeKeys = new Set<string>();
  private sceneOrigin = new maplibregl.LngLat(23.7609, 61.4981);
  private sceneOriginElevation = 0;
  private readonly elevationCache = new Map<string, number>();
  private lastUpdateOriginMetric?: MetricPoint;
  private lastCandidateCheckMetric?: MetricPoint;
  private lastCandidateCheckTime?: number;
  private lastOriginMercatorX?: number;
  private lastOriginMercatorY?: number;
  private lastGrowthMeshWrite = 0;
  private trunkMesh?: THREE.InstancedMesh;
  private broadleafMesh?: THREE.InstancedMesh;
  private coniferMesh?: THREE.InstancedMesh;
  private shrubMesh?: THREE.InstancedMesh;
  private shadowMesh?: THREE.InstancedMesh;
  private shadowTexture?: THREE.DataTexture;
  private shadowsEnabled = true;
  private growthAnimationActive = false;
  private darkMode = false;
  private extendedViewportRangeEnabled = false;

  constructor(private readonly sources: TreeSourceConfig) {}

  invalidateTerrain() {
    this.elevationCache.clear();
    this.retainedTrees.clear();
    this.clearPendingFlightTrees();
    this.lastUpdateOriginMetric = undefined;
    this.lastCandidateCheckMetric = undefined;
    this.lastCandidateCheckTime = undefined;
    this.lastOriginMercatorX = undefined;
    this.lastOriginMercatorY = undefined;
  }

  private clearPendingFlightTrees() {
    this.pendingFlightTrees.length = 0;
    this.pendingFlightTreeKeys.clear();
  }

  private retainTree(key: string, displayedTree: DisplayedTree) {
    this.retainedTrees.delete(key);
    this.retainedTrees.set(key, displayedTree);
    while (this.retainedTrees.size > MAX_RETAINED_TREE_COUNT) {
      const oldestKey = this.retainedTrees.keys().next().value;
      if (oldestKey === undefined) break;
      this.retainedTrees.delete(oldestKey);
    }
  }

  private takeRetainedTree(key: string) {
    const retained = this.retainedTrees.get(key);
    if (!retained) return undefined;
    this.retainedTrees.delete(key);
    return retained;
  }

  private enqueueFlightTree(tree: TreeInstance, currentMetric: MetricPoint) {
    const key = displayedTreeKey(tree);
    if (this.displayedTrees.has(key)
      || this.retainedTrees.has(key)
      || this.pendingFlightTreeKeys.has(key)) {
      return false;
    }
    if (this.pendingFlightTrees.length >= FLIGHT_PENDING_TREE_LIMIT) return false;

    const metric = toMetricPoint([tree.longitude, tree.latitude]);
    const distSq = metric ? metricDistanceSquared(metric, currentMetric) : 0;
    let insertAt = this.pendingFlightTrees.length;
    if (metric) {
      insertAt = 0;
      // Farthest first so admission grows the horizon before the inner far-ring.
      while (insertAt < this.pendingFlightTrees.length) {
        const previous = this.pendingFlightTrees[insertAt];
        const previousMetric = toMetricPoint([previous.longitude, previous.latitude]);
        if (!previousMetric) break;
        if (metricDistanceSquared(previousMetric, currentMetric) < distSq) break;
        insertAt += 1;
      }
    }
    this.pendingFlightTreeKeys.add(key);
    this.pendingFlightTrees.splice(insertAt, 0, tree);
    return true;
  }

  private prunePendingFlightTrees(visibleBounds: MetricBounds, selectedKeys: Set<string>) {
    if (this.pendingFlightTrees.length === 0) return;
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.pendingFlightTrees.length; readIndex += 1) {
      const tree = this.pendingFlightTrees[readIndex];
      const key = displayedTreeKey(tree);
      if (selectedKeys.has(key)
        || this.displayedTrees.has(key)
        || !withinTreeBounds(tree, visibleBounds)) {
        this.pendingFlightTreeKeys.delete(key);
        continue;
      }
      this.pendingFlightTrees[writeIndex] = tree;
      writeIndex += 1;
    }
    this.pendingFlightTrees.length = writeIndex;
  }

  private createDisplayedTree(
    tree: TreeInstance,
    map: MaplibreMap,
    originMercator: { x: number; y: number },
    mercatorUnitsPerMeter: number,
    terrainZoomBucket: number,
    growthStart: number,
    growthDuration: number,
  ): DisplayedTree {
    const location = new maplibregl.LngLat(tree.longitude, tree.latitude);
    let elevation: number;
    const elevationKey = `${terrainZoomBucket}:${tree.longitude.toFixed(5)}:${tree.latitude.toFixed(5)}`;
    const cached = this.cachedElevation(elevationKey);
    if (cached !== undefined) {
      elevation = cached;
    } else {
      const sampledElevation = map.queryTerrainElevation(location);
      if (sampledElevation != null) {
        elevation = sampledElevation;
        this.cacheElevation(elevationKey, elevation);
      } else {
        elevation = this.sceneOriginElevation;
      }
    }

    const treeMercator = maplibregl.MercatorCoordinate.fromLngLat(location);
    return {
      tree,
      elevation,
      mercatorX: treeMercator.x,
      mercatorY: treeMercator.y,
      east: (treeMercator.x - originMercator.x) / mercatorUnitsPerMeter,
      north: (originMercator.y - treeMercator.y) / mercatorUnitsPerMeter,
      up: elevation - this.sceneOriginElevation,
      growthStart,
      growthDuration,
    };
  }

  private admitPendingFlightTrees(now: number, maxAdmit: number) {
    const map = this.map;
    if (!map || !this.extendedViewportRangeEnabled || maxAdmit <= 0) return 0;
    if (this.pendingFlightTrees.length === 0) return 0;

    const currentCenter = map.getCenter();
    const currentMetric = toMetricPoint([currentCenter.lng, currentCenter.lat]);
    const visibleBounds = currentMetric
      ? metricBoundsAroundPoint(currentMetric, FLIGHT_TREE_RADIUS_METERS)
      : visibleMetricBounds(map);
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const mercatorUnitsPerMeter = originMercator.meterInMercatorCoordinateUnits();
    const terrainZoomBucket = Math.floor(map.getZoom() + 1e-6);
    let admitted = 0;

    while (admitted < maxAdmit && this.pendingFlightTrees.length > 0) {
      if (this.displayedTrees.size >= MAX_TREE_COUNT) {
        this.clearPendingFlightTrees();
        break;
      }
      const tree = this.pendingFlightTrees.shift()!;
      const key = displayedTreeKey(tree);
      this.pendingFlightTreeKeys.delete(key);
      if (this.displayedTrees.has(key) || !withinTreeBounds(tree, visibleBounds)) continue;

      this.displayedTrees.set(key, this.createDisplayedTree(
        tree,
        map,
        originMercator,
        mercatorUnitsPerMeter,
        terrainZoomBucket,
        now,
        FLIGHT_TREE_GROWTH_DURATION_MS,
      ));
      admitted += 1;
    }

    return admitted;
  }

  private cachedElevation(key: string) {
    const elevation = this.elevationCache.get(key);
    if (elevation === undefined) return undefined;
    // Refresh insertion order so the bounded map behaves as a small LRU.
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

  setShadowsEnabled(enabled: boolean) {
    this.shadowsEnabled = enabled;
    if (this.shadowMesh) this.shadowMesh.visible = enabled;
    this.map?.triggerRepaint();
  }

  // map.getBounds() breaks down under flight's combined steep pitch and
  // roll (a screen corner can rotate off the ground plane entirely), so
  // flight uses a fixed radius around the aircraft instead of the normal
  // viewport-span cutoff.
  setExtendedViewportRange(enabled: boolean) {
    this.extendedViewportRangeEnabled = enabled;
    if (!enabled) {
      this.retainedTrees.clear();
      this.clearPendingFlightTrees();
    }
  }

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    if (this.map) this.updateTrees();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;

    // Tree instances use local metre coordinates: x=east, y=up, z=north.
    // Rotate that local scene into MapLibre's Mercator coordinate system once,
    // then keep all per-tree matrices small to preserve floating-point precision.
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));

    this.scene.add(new THREE.HemisphereLight(
      CARTOON_AMBIENT_SKY_COLOR,
      CARTOON_AMBIENT_GROUND_COLOR,
      1.8,
    ));
    const sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR, 2.4);
    const sunDistance = 140;
    const sunHorizontalDistance = Math.sin(SUN_POLAR_RADIANS) * sunDistance;
    sunlight.position.set(
      Math.sin(SUN_AZIMUTH_RADIANS) * sunHorizontalDistance,
      Math.cos(SUN_POLAR_RADIANS) * sunDistance,
      Math.cos(SUN_AZIMUTH_RADIANS) * sunHorizontalDistance,
    );
    this.scene.add(sunlight);

    const trunkGeometry = new THREE.CylinderGeometry(0.28, 0.42, 1, 5, 1);
    trunkGeometry.translate(0, 0.5, 0);
    const broadleafGeometry = new THREE.IcosahedronGeometry(1, 1);
    const coniferGeometry = new THREE.ConeGeometry(1, 1, 7, 2);
    const shrubGeometry = new THREE.DodecahedronGeometry(1, 0);
    const shadowGeometry = new THREE.CircleGeometry(1, 12);
    shadowGeometry.rotateX(-Math.PI / 2);

    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const broadleafMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const coniferMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const shrubMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.shadowTexture = createShadowTexture();
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: CARTOON_SHADOW_COLOR,
      transparent: true,
      opacity: 0.22,
      alphaMap: this.shadowTexture,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    this.trunkMesh = new THREE.InstancedMesh(
      trunkGeometry,
      trunkMaterial,
      MAX_TREE_COUNT,
    );
    this.broadleafMesh = new THREE.InstancedMesh(
      broadleafGeometry,
      broadleafMaterial,
      MAX_TREE_COUNT,
    );
    this.coniferMesh = new THREE.InstancedMesh(
      coniferGeometry,
      coniferMaterial,
      MAX_TREE_COUNT,
    );
    this.shrubMesh = new THREE.InstancedMesh(
      shrubGeometry,
      shrubMaterial,
      MAX_TREE_COUNT,
    );
    this.shadowMesh = new THREE.InstancedMesh(
      shadowGeometry,
      shadowMaterial,
      MAX_TREE_COUNT,
    );
    this.shadowMesh.visible = this.shadowsEnabled;

    for (const mesh of [
      this.shadowMesh,
      this.trunkMesh,
      this.broadleafMesh,
      this.coniferMesh,
      this.shrubMesh,
    ]) {
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The loaded vector-tile set already limits instances to the current map
      // neighborhood. Avoid using Three's camera assumptions for MapLibre's
      // combined custom projection matrix.
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  updateTrees() {
    const map = this.map;
    const trunkMesh = this.trunkMesh;
    const broadleafMesh = this.broadleafMesh;
    const coniferMesh = this.coniferMesh;
    const shrubMesh = this.shrubMesh;
    const shadowMesh = this.shadowMesh;
    if (!map || !trunkMesh || !broadleafMesh || !coniferMesh
      || !shrubMesh || !shadowMesh) return;

    const flightMode = this.extendedViewportRangeEnabled;
    if (flightMode && map.getZoom() < TREE_MIN_ZOOM) {
      // High-altitude flight loads low-zoom tiles whose water/landuse rings
      // span countries. Building a spatial index over those freezes the tab;
      // trees are not meaningful at that scale anyway.
      if (this.displayedTrees.size > 0 || this.retainedTrees.size > 0) {
        this.clearDisplayedTrees();
        map.triggerRepaint();
      }
      return;
    }
    if (!flightMode) {
      const bounds = map.getBounds();
      if (!shouldRenderTreesForViewport({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      }, map.getZoom())) {
        this.clearDisplayedTrees();
        map.triggerRepaint();
        return;
      }
    }

    const currentCenter = map.getCenter();
    const currentMetric = toMetricPoint([currentCenter.lng, currentCenter.lat]);

    const msSinceLastUpdate = this.lastCandidateCheckTime !== undefined
      ? performance.now() - this.lastCandidateCheckTime
      : Infinity;

    // Prevent back-to-back calls from both the flight interval and a map
    // event firing within the same frame.
    if (flightMode && msSinceLastUpdate < FLIGHT_UPDATE_MIN_INTERVAL_MS) {
      return;
    }

    // Skip if the aircraft hasn't covered enough new ground — but only while
    // the update is "recent". After FLIGHT_STALE_REFRESH_MS any call goes
    // through unconditionally so the interval can flush stale tile data
    // (e.g. water bodies that finished loading since the last update).
    if (flightMode && currentMetric && this.lastCandidateCheckMetric
        && msSinceLastUpdate < FLIGHT_STALE_REFRESH_MS) {
      const distSq = metricDistanceSquared(currentMetric, this.lastCandidateCheckMetric);
      if (distSq < FLIGHT_UPDATE_MOVE_METERS ** 2) {
        return;
      }
    }

    // Rebase the local scene origin only after throttles pass. Updating it
    // earlier and then returning left render() with a new origin and stale
    // east/north offsets — the whole forest appeared to teleport.
    if (!this.lastUpdateOriginMetric || (currentMetric && metricDistanceSquared(
      currentMetric,
      this.lastUpdateOriginMetric,
    ) > FLIGHT_ORIGIN_REBASE_METERS ** 2)) {
      this.sceneOrigin = currentCenter;
      if (currentMetric) this.lastUpdateOriginMetric = currentMetric;
    }
    this.sceneOriginElevation = 0;

    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const mercatorUnitsPerMeter = originMercator.meterInMercatorCoordinateUnits();
    const zoom = map.getZoom();
    const terrainZoomBucket = Math.floor(zoom + 1e-6);
    const shadowMaterial = shadowMesh.material as THREE.MeshBasicMaterial;
    shadowMaterial.opacity = treeShadowOpacity(zoom);

    if (currentMetric) {
      this.lastCandidateCheckMetric = currentMetric;
    }
    // An update that ran because the aircraft moved (not because the stale
    // timer elapsed) must refill the leading edge. Hovering refreshes can
    // skip the expensive source scan when coverage is already healthy.
    const movementTriggered = flightMode && msSinceLastUpdate < FLIGHT_STALE_REFRESH_MS;
    this.lastCandidateCheckTime = performance.now();

    const flightBounds = flightMode && currentMetric
      ? metricBoundsAroundPoint(currentMetric, FLIGHT_TREE_RADIUS_METERS)
      : undefined;
    const budget = MAX_TREE_COUNT;
    const visibleBounds = flightBounds ?? visibleMetricBounds(map);
    const trees: TreeInstance[] = [];
    const selectedKeys = new Set<string>();
    const isInitialFlightLoad = flightMode && this.displayedTrees.size === 0
      && this.retainedTrees.size === 0;

    // Trees are world objects, not zoom-level decorations. Keep every tree
    // that overlaps the new view and only use the current source data to fill
    // newly exposed space. This prevents vector-tile LOD changes from
    // replacing a local patch with a different arrangement.
    for (const displayedTree of this.displayedTrees.values()) {
      if (!withinTreeBounds(displayedTree.tree, visibleBounds)) continue;
      trees.push(displayedTree.tree);
      selectedKeys.add(displayedTreeKey(displayedTree.tree));
      if (trees.length >= budget) break;
    }

    // Prefer previously displayed trees that re-enter the radius over a new
    // procedural sample that would land at a different jittered cell.
    if (trees.length < budget) {
      for (const retained of this.retainedTrees.values()) {
        if (!withinTreeBounds(retained.tree, visibleBounds)) continue;
        const key = displayedTreeKey(retained.tree);
        if (selectedKeys.has(key)) continue;
        trees.push(retained.tree);
        selectedKeys.add(key);
        if (trees.length >= budget) break;
      }
    }

    // Flight's querySourceFeatures scan of every loaded vegetation tile is the
    // main hitch. Skip it while hovering with healthy coverage; always run on
    // movement so the frontier ahead of the aircraft stays populated.
    const needsGeneration = !flightMode
      || isInitialFlightLoad
      || movementTriggered
      || trees.length < budget * 0.85;
    const generatedTrees = needsGeneration
      ? (flightBounds
        ? visibleTrees(map, this.sources, undefined, flightBounds)
        : visibleTrees(map, this.sources))
      : [];

    let newTreesQueuedThisUpdate = 0;
    for (const tree of generatedTrees) {
      if (trees.length >= budget) break;
      const key = displayedTreeKey(tree);
      if (selectedKeys.has(key)) continue;

      if (flightMode && currentMetric && !isInitialFlightLoad) {
        const treeMetric = toMetricPoint([tree.longitude, tree.latitude]);
        if (treeMetric) {
          const distSq = metricDistanceSquared(treeMetric, currentMetric);
          // Close-up trees stay fixed once placed. New samples only appear on
          // the far ring so they do not pop in under the nose.
          if (distSq < FLIGHT_NEW_TREE_MIN_RADIUS_METERS ** 2) {
            continue;
          }
        }
        if (newTreesQueuedThisUpdate >= FLIGHT_MAX_NEW_TREES_PER_UPDATE) {
          continue;
        }
        if (this.enqueueFlightTree(tree, currentMetric)) {
          newTreesQueuedThisUpdate += 1;
        }
        continue;
      }

      trees.push(tree);
      selectedKeys.add(key);
    }
    this.prunePendingFlightTrees(visibleBounds, selectedKeys);
    // Detect whether the scene origin moved (happens every >4 km); if so we
    // must recompute east/north/up for every kept tree.
    const originChanged = this.lastOriginMercatorX !== originMercator.x
      || this.lastOriginMercatorY !== originMercator.y;
    this.lastOriginMercatorX = originMercator.x;
    this.lastOriginMercatorY = originMercator.y;

    const now = performance.now();
    const nextKeys = new Set<string>();
    let treesChanged = originChanged;

    for (const tree of trees) {
      const key = displayedTreeKey(tree);
      nextKeys.add(key);
      const previousTree = this.displayedTrees.get(key)
        ?? this.takeRetainedTree(key);

      if (previousTree !== undefined) {
        if (!this.displayedTrees.has(key)) {
          // Restored trees should appear fully grown — they were already seen.
          previousTree.growthStart = now - previousTree.growthDuration;
          this.displayedTrees.set(key, previousTree);
          treesChanged = true;
        }
        // Tree already known — only recompute position if scene origin changed.
        if (originChanged) {
          previousTree.east = (previousTree.mercatorX - originMercator.x)
            / mercatorUnitsPerMeter;
          previousTree.north = (originMercator.y - previousTree.mercatorY)
            / mercatorUnitsPerMeter;
          previousTree.up = previousTree.elevation - this.sceneOriginElevation;
        }
        continue;
      }

      // New tree — sample elevation, compute Mercator position, insert.
      treesChanged = true;
      this.displayedTrees.set(key, this.createDisplayedTree(
        tree,
        map,
        originMercator,
        mercatorUnitsPerMeter,
        terrainZoomBucket,
        flightMode && isInitialFlightLoad
          ? now - FLIGHT_TREE_GROWTH_DURATION_MS
          : now,
        flightMode ? FLIGHT_TREE_GROWTH_DURATION_MS : TREE_GROWTH_DURATION_MS,
      ));
    }

    // Prune keys that are no longer in the visible set. In flight mode keep
    // them in the retention cache so a turn-back restores the same layout.
    for (const [key, displayedTree] of this.displayedTrees) {
      if (nextKeys.has(key)) continue;
      this.displayedTrees.delete(key);
      treesChanged = true;
      if (flightMode) this.retainTree(key, displayedTree);
    }

    // Skip the expensive instance rewrite when the visible set and origin are
    // unchanged. Pending flight trees are admitted from render().
    if (!treesChanged) {
      if (flightMode && this.pendingFlightTrees.length > 0) map.triggerRepaint();
      return;
    }

    if (!this.growthAnimationActive) {
      this.writeTreeMeshes(performance.now());
    } else {
      map.triggerRepaint();
    }
  }

  private writeTreeMeshes(now: number) {
    const map = this.map;
    const trunkMesh = this.trunkMesh;
    const broadleafMesh = this.broadleafMesh;
    const coniferMesh = this.coniferMesh;
    const shrubMesh = this.shrubMesh;
    const shadowMesh = this.shadowMesh;
    if (!map || !trunkMesh || !broadleafMesh || !coniferMesh
      || !shrubMesh || !shadowMesh) return;

    let broadleafCount = 0;
    let coniferCount = 0;
    let shrubCount = 0;
    let trunkCount = 0;
    let shadowCount = 0;
    let hasGrowingTrees = false;

    for (const displayedTree of this.displayedTrees.values()) {
      const {
        tree,
        east,
        north,
        up,
      } = displayedTree;
      const progress = Math.min(
        1,
        Math.max(0, (now - displayedTree.growthStart) / displayedTree.growthDuration),
      );
      const growth = treeGrowth(
        displayedTree.growthStart,
        now,
        displayedTree.growthDuration,
      );
      if (progress < 1) hasGrowingTrees = true;
      const isConifer = tree.vegetationType === 'conifer';
      const isShrub = tree.vegetationType === 'shrub';
      const canopyBase = tree.height * (isShrub ? 0.06 : isConifer ? 0.18 : 0.3);
      const trunkHeight = (canopyBase + TRUNK_CANOPY_OVERLAP_METERS) * growth;
      const trunkWidth = tree.widthScale * (0.82 + tree.height / 60);

      if (!isShrub) {
        this.transformHelper.position.set(east, up, north);
        this.transformHelper.rotation.set(0, tree.rotation, 0);
        this.transformHelper.scale.set(
          trunkWidth * growth,
          trunkHeight,
          trunkWidth * growth,
        );
        this.transformHelper.updateMatrix();
        trunkMesh.setMatrixAt(trunkCount, this.transformHelper.matrix);
        this.color.setHSL(0.075, this.darkMode ? 0.24 : 0.38, (this.darkMode ? 0.07 : 0.27) + tree.colorVariation * (this.darkMode ? 0.015 : 0.06));
        trunkMesh.setColorAt(trunkCount, this.color);
        trunkCount += 1;
      }

      const canopyHeight = (tree.height - canopyBase) * growth;
      const canopyRadius = tree.height
        // Slightly broader crowns create fuller parks without adding another
        // instance or increasing the existing per-zoom tree budgets.
        * (isShrub ? 0.58 : isConifer ? 0.27 : 0.27)
        * tree.widthScale;

      // A compact shadow under each crown acts as fake ambient occlusion. It
      // is deliberately independent of tree height and sun direction so it
      // matches the centered building-footprint treatment.
      this.transformHelper.position.set(east, up + 0.06, north);
      this.transformHelper.rotation.set(0, 0, 0);
      this.transformHelper.scale.set(
        canopyRadius * 1.18 * growth,
        1,
        canopyRadius * 1.18 * growth,
      );
      this.transformHelper.updateMatrix();
      shadowMesh.setMatrixAt(shadowCount, this.transformHelper.matrix);
      shadowCount += 1;

      this.transformHelper.position.set(east, up + canopyBase * growth + canopyHeight / 2, north);
      this.transformHelper.rotation.set(0, tree.rotation, 0);
      const crownWidth = canopyRadius * (0.9 + tree.colorVariation * 0.2);
      const crownHeight = isConifer
        ? canopyHeight * (0.92 + tree.colorVariation * 0.16)
        : canopyHeight * (0.86 + tree.colorVariation * 0.22);
      this.transformHelper.scale.set(
        crownWidth * growth,
        crownHeight,
        canopyRadius * (1.06 - tree.colorVariation * 0.12) * growth,
      );
      this.transformHelper.updateMatrix();

      if (isConifer) {
        coniferMesh.setMatrixAt(coniferCount, this.transformHelper.matrix);
        this.color.setHSL(0.31, this.darkMode ? 0.32 : 0.54, (this.darkMode ? 0.065 : 0.26) + tree.colorVariation * (this.darkMode ? 0.02 : 0.08));
        coniferMesh.setColorAt(coniferCount, this.color);
        coniferCount += 1;
      } else if (isShrub) {
        shrubMesh.setMatrixAt(shrubCount, this.transformHelper.matrix);
        this.color.setHSL(0.24 + tree.colorVariation * 0.04, this.darkMode ? 0.29 : 0.47, (this.darkMode ? 0.08 : 0.34) + tree.colorVariation * (this.darkMode ? 0.02 : 0.1));
        shrubMesh.setColorAt(shrubCount, this.color);
        shrubCount += 1;
      } else {
        broadleafMesh.setMatrixAt(broadleafCount, this.transformHelper.matrix);
        this.color.setHSL(0.29 + tree.colorVariation * 0.04, this.darkMode ? 0.32 : 0.53, (this.darkMode ? 0.09 : 0.36) + tree.colorVariation * (this.darkMode ? 0.02 : 0.1));
        broadleafMesh.setColorAt(broadleafCount, this.color);
        broadleafCount += 1;
      }
    }

    trunkMesh.count = trunkCount;
    broadleafMesh.count = broadleafCount;
    coniferMesh.count = coniferCount;
    shrubMesh.count = shrubCount;
    shadowMesh.count = shadowCount;
    trunkMesh.instanceMatrix.needsUpdate = true;
    broadleafMesh.instanceMatrix.needsUpdate = true;
    coniferMesh.instanceMatrix.needsUpdate = true;
    shrubMesh.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (broadleafMesh.instanceColor) broadleafMesh.instanceColor.needsUpdate = true;
    if (coniferMesh.instanceColor) coniferMesh.instanceColor.needsUpdate = true;
    if (shrubMesh.instanceColor) shrubMesh.instanceColor.needsUpdate = true;
    this.growthAnimationActive = hasGrowingTrees;
    map.triggerRepaint();
  }

  private clearDisplayedTrees() {
    this.displayedTrees.clear();
    this.retainedTrees.clear();
    this.clearPendingFlightTrees();
    this.lastUpdateOriginMetric = undefined;
    this.lastCandidateCheckMetric = undefined;
    this.lastCandidateCheckTime = undefined;
    this.lastOriginMercatorX = undefined;
    this.lastOriginMercatorY = undefined;
    this.growthAnimationActive = false;
    for (const mesh of [
      this.shadowMesh,
      this.trunkMesh,
      this.broadleafMesh,
      this.coniferMesh,
      this.shrubMesh,
    ]) {
      if (!mesh) continue;
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer) return;

    let viewportAllowed = true;
    if (this.extendedViewportRangeEnabled) {
      viewportAllowed = map.getZoom() >= TREE_MIN_ZOOM;
    } else {
      const bounds = map.getBounds();
      viewportAllowed = shouldRenderTreesForViewport({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      }, map.getZoom());
    }
    if (!viewportAllowed) {
      this.clearDisplayedTrees();
      map.triggerRepaint();
      return;
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

    const now = performance.now();
    const admitted = this.admitPendingFlightTrees(now, FLIGHT_TREES_ADMIT_PER_FRAME);
    const needsGrowthWrite = this.growthAnimationActive || admitted > 0;
    const growthWriteInterval = this.extendedViewportRangeEnabled
      ? FLIGHT_GROWTH_MESH_WRITE_MS
      : 0;
    if (needsGrowthWrite && now - this.lastGrowthMeshWrite >= growthWriteInterval) {
      this.lastGrowthMeshWrite = now;
      this.writeTreeMeshes(now);
    } else if (admitted > 0 || this.growthAnimationActive || this.pendingFlightTrees.length > 0) {
      map.triggerRepaint();
    }

    renderer.resetState();
    renderer.render(this.scene, this.camera);
  }

  onRemove() {
    for (const mesh of [
      this.shadowMesh,
      this.trunkMesh,
      this.broadleafMesh,
      this.coniferMesh,
      this.shrubMesh,
    ]) {
      mesh?.geometry.dispose();
      const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
      materials.forEach((material) => material?.dispose());
    }
    this.scene.clear();
    this.displayedTrees.clear();
    this.retainedTrees.clear();
    this.clearPendingFlightTrees();
    this.elevationCache.clear();
    this.shadowTexture?.dispose();
    this.shadowTexture = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }
}
