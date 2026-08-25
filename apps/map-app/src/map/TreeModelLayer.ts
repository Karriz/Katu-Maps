import maplibregl, {
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
} from './CartoonLighting';

const TREE_MIN_ZOOM = 12;
const MAX_TREE_COUNT = 5000;
const TREE_BUDGETS = [
  { maxZoom: 14, count: 900 },
  { maxZoom: 15, count: 1600 },
  { maxZoom: 16, count: 2800 },
  { maxZoom: Number.POSITIVE_INFINITY, count: MAX_TREE_COUNT },
] as const;
const FOREST_TREE_SPACING_METERS = 32;
const PARK_TREE_SPACING_METERS = 34;
const SHRUB_SPACING_METERS = 22;
const ORCHARD_TREE_SPACING_METERS = 24;
const MAPPED_TREE_CLEARANCE_METERS = 9;
const TRUNK_CANOPY_OVERLAP_METERS = 0.25;
const SAMPLING_BOUNDS_PADDING_METERS = 80;
const MAX_GRID_CELLS_PER_POLYGON = 100_000;
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

const LOCAL_TREE_SOURCES: TreeSourceConfig = {
  sourceId: 'tampere',
  waterLayers: ['water', 'water_detail', 'river_areas'],
  vegetationLayers: ['landuse'],
  mappedTreeLayer: 'trees',
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
  return sourceLayers.flatMap((sourceLayer) => {
    try {
      return map.querySourceFeatures(sourceId, { sourceLayer });
    } catch (error) {
      console.warn(`Could not query optional source layer ${sourceLayer}`, error);
      return [];
    }
  });
}

function visibleMetricBounds(map: MaplibreMap): MetricBounds {
  const bounds = map.getBounds();
  const southWest = toMetricPoint([bounds.getWest(), bounds.getSouth()])!;
  const northEast = toMetricPoint([bounds.getEast(), bounds.getNorth()])!;
  const centerY = (southWest[1] + northEast[1]) * 0.5;
  const horizontalPadding = SAMPLING_BOUNDS_PADDING_METERS
    / longitudeScaleAtMetricY(centerY);
  return {
    minX: Math.min(southWest[0], northEast[0]) - horizontalPadding,
    minY: Math.min(southWest[1], northEast[1]) - SAMPLING_BOUNDS_PADDING_METERS,
    maxX: Math.max(southWest[0], northEast[0]) + horizontalPadding,
    maxY: Math.max(southWest[1], northEast[1]) + SAMPLING_BOUNDS_PADDING_METERS,
  };
}

function treeBudget(zoom: number) {
  return TREE_BUDGETS.find((entry) => zoom < entry.maxZoom) ?? TREE_BUDGETS.at(-1)!;
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

function collectMetricPolygons(features: SourceFeature[]): MetricPolygon[] {
  return features.flatMap((feature) => featurePolygons(feature).flatMap((sourcePolygon) => {
    const rings = metricPolygon(sourcePolygon);
    const bounds = polygonBounds(rings);
    return bounds ? [{ rings, bounds }] : [];
  }));
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
  waterFeatures: SourceFeature[],
  bounds: MetricBounds,
  mappedTrees: TreeInstance[],
  availableCount: number,
  zoom: number,
) {
  if (availableCount <= 0) return [];

  const mappedIndex = mappedTreeIndex(mappedTrees);
  // Water polygons are separate source layers from landuse. Keep them as an
  // exclusion mask so a lake nested inside a park or forest stays treeless.
  const waterPolygons = collectMetricPolygons(waterFeatures);
  const candidates = new Map<string, ProceduralTreeCandidate>();

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
      isForest ? 0.46 : 0.16,
    );

    for (const sourcePolygon of featurePolygons(feature)) {
      const polygon = metricPolygon(sourcePolygon);
      const sourceBounds = polygonBounds(polygon);
      if (!sourceBounds) continue;

      const minX = Math.max(sourceBounds.minX, bounds.minX);
      const minY = Math.max(sourceBounds.minY, bounds.minY);
      const maxX = Math.min(sourceBounds.maxX, bounds.maxX);
      const maxY = Math.min(sourceBounds.maxY, bounds.maxY);
      if (minX > maxX || minY > maxY) continue;

      const firstCellY = Math.floor(minY / spacing);
      const lastCellY = Math.floor(maxY / spacing);
      const middleCellY = Math.floor((firstCellY + lastCellY) * 0.5);
      const estimatedHorizontalSpacing = horizontalGridSpacing(middleCellY, spacing);
      const estimatedColumnCount = Math.ceil((maxX - minX) / estimatedHorizontalSpacing) + 1;
      const gridCellCount = estimatedColumnCount * (lastCellY - firstCellY + 1);
      const zoomStep = zoom < 14 ? 2 : 1;
      const safetyStep = Math.ceil(Math.sqrt(gridCellCount / MAX_GRID_CELLS_PER_POLYGON));
      const gridStep = Math.max(zoomStep, safetyStep);
      const alignedCellY = firstCellY + ((gridStep - (firstCellY % gridStep)) % gridStep);

      for (let cellY = alignedCellY; cellY <= lastCellY; cellY += gridStep) {
        // Longitude degrees get physically narrower toward the poles. Each
        // latitude row therefore has its own world-anchored horizontal cell
        // width, preserving approximate metre spacing without camera state.
        const horizontalSpacing = horizontalGridSpacing(cellY, spacing);
        const firstCellX = Math.floor(minX / horizontalSpacing);
        const lastCellX = Math.floor(maxX / horizontalSpacing);
        const alignedCellX = firstCellX
          + ((gridStep - (firstCellX % gridStep)) % gridStep);

        for (let cellX = alignedCellX; cellX <= lastCellX; cellX += gridStep) {
          const key = `${kind}:${cellX}:${cellY}`;
          if (candidates.has(key)) continue;

          const seed = cellSeed(cellX, cellY, kindSalt);
          const jitterX = (seededUnit(seed, 67) - 0.5) * horizontalSpacing * 0.7;
          const jitterY = (seededUnit(seed, 79) - 0.5) * spacing * 0.7;
          const point: MetricPoint = [
            (cellX + 0.5) * horizontalSpacing + jitterX,
            (cellY + 0.5) * spacing + jitterY,
          ];
          if (!pointInPolygon(point, polygon)
            || pointInAnyPolygon(point, waterPolygons)
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
          const height = vegetationType === 'shrub'
            ? 1.4 + seededUnit(seed, 97) * 2.2
            : isOrchard ? 4.5 + seededUnit(seed, 97) * 3
              : (isForest ? 8.5 : 7.5)
                + seededUnit(seed, 97) * (isForest ? 7.5 : 6);
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

  return [...candidates.values()]
    .sort((first, second) => first.priority - second.priority)
    .slice(0, availableCount)
    .map(({ priority: _priority, ...tree }) => tree);
}

export class TreeModelLayer implements CustomLayerInterface {
  readonly id = 'tree-models-3d';
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
  private sceneOrigin = new maplibregl.LngLat(23.7609, 61.4981);
  private sceneOriginElevation = 0;
  private readonly elevationCache = new Map<string, number>();
  private trunkMesh?: THREE.InstancedMesh;
  private broadleafMesh?: THREE.InstancedMesh;
  private coniferMesh?: THREE.InstancedMesh;
  private shrubMesh?: THREE.InstancedMesh;
  private shadowMesh?: THREE.InstancedMesh;
  private shadowTexture?: THREE.DataTexture;
  private shadowsEnabled = true;

  constructor(private readonly sources: TreeSourceConfig = LOCAL_TREE_SOURCES) {}

  invalidateTerrain() {
    this.elevationCache.clear();
  }

  setShadowsEnabled(enabled: boolean) {
    this.shadowsEnabled = enabled;
    if (this.shadowMesh) this.shadowMesh.visible = enabled;
    this.map?.triggerRepaint();
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
      2.1,
    ));
    const sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR, 2.7);
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

    this.trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, MAX_TREE_COUNT);
    this.broadleafMesh = new THREE.InstancedMesh(broadleafGeometry, broadleafMaterial, MAX_TREE_COUNT);
    this.coniferMesh = new THREE.InstancedMesh(coniferGeometry, coniferMaterial, MAX_TREE_COUNT);
    this.shrubMesh = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, MAX_TREE_COUNT);
    this.shadowMesh = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, MAX_TREE_COUNT);
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

    if (map.getZoom() < TREE_MIN_ZOOM) {
      trunkMesh.count = 0;
      broadleafMesh.count = 0;
      coniferMesh.count = 0;
      shrubMesh.count = 0;
      shadowMesh.count = 0;
      map.triggerRepaint();
      return;
    }

    this.sceneOrigin = map.getCenter();
    this.sceneOriginElevation = map.queryTerrainElevation(this.sceneOrigin) ?? 0;
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const mercatorUnitsPerMeter = originMercator.meterInMercatorCoordinateUnits();
    const budget = treeBudget(map.getZoom());
    const samplingBounds = visibleMetricBounds(map);
    const waterFeatures = sourceFeatures(map, this.sources.sourceId, this.sources.waterLayers);
    const waterPolygons = collectMetricPolygons(waterFeatures);
    const mappedTreeFeatures = this.sources.mappedTreeLayer
      ? sourceFeatures(map, this.sources.sourceId, [this.sources.mappedTreeLayer])
      : [];
    const mappedTrees = collectTreeInstances(mappedTreeFeatures)
      .filter((tree) => withinTreeBounds(tree, samplingBounds))
      .filter((tree) => {
        const point = toMetricPoint([tree.longitude, tree.latitude]);
        return point !== undefined && !pointInAnyPolygon(point, waterPolygons);
      })
      .slice(0, budget.count);
    const landuseFeatures = sourceFeatures(
      map,
      this.sources.sourceId,
      this.sources.vegetationLayers,
    );
    const proceduralTrees = collectProceduralTrees(
      landuseFeatures,
      waterFeatures,
      visibleMetricBounds(map),
      mappedTrees,
      Math.max(0, budget.count - mappedTrees.length),
      map.getZoom(),
    ).filter((tree) => withinTreeBounds(tree, samplingBounds));
    const trees = [...mappedTrees, ...proceduralTrees].slice(0, budget.count);

    let broadleafCount = 0;
    let coniferCount = 0;
    let shrubCount = 0;
    let trunkCount = 0;

    trees.forEach((tree, index) => {
      const location = new maplibregl.LngLat(tree.longitude, tree.latitude);
      const treeMercator = maplibregl.MercatorCoordinate.fromLngLat(location);
      const east = (treeMercator.x - originMercator.x) / mercatorUnitsPerMeter;
      const north = (originMercator.y - treeMercator.y) / mercatorUnitsPerMeter;
      // Terrain queries are relatively expensive. Elevation changes slowly at
      // tree scale, so reuse samples from a small geographic grid between
      // model rebuilds.
      const elevationKey = `${tree.longitude.toFixed(4)}:${tree.latitude.toFixed(4)}`;
      let elevation = this.elevationCache.get(elevationKey);
      if (elevation === undefined) {
        const sampledElevation = map.queryTerrainElevation(location);
        elevation = sampledElevation ?? this.sceneOriginElevation;
        // Do not cache a fallback value: terrain tiles may still be loading and
        // a later idle update should be able to replace it with real terrain.
        if (sampledElevation !== undefined) this.elevationCache.set(elevationKey, elevation);
      }
      const up = elevation - this.sceneOriginElevation;
      const isConifer = tree.vegetationType === 'conifer';
      const isShrub = tree.vegetationType === 'shrub';
      const canopyBase = tree.height * (isShrub ? 0.06 : isConifer ? 0.18 : 0.3);
      const trunkHeight = canopyBase + TRUNK_CANOPY_OVERLAP_METERS;
      const trunkWidth = tree.widthScale * (0.82 + tree.height / 60);

      if (!isShrub) {
        this.transformHelper.position.set(east, up, north);
        this.transformHelper.rotation.set(0, tree.rotation, 0);
        this.transformHelper.scale.set(trunkWidth, trunkHeight, trunkWidth);
        this.transformHelper.updateMatrix();
        trunkMesh.setMatrixAt(trunkCount, this.transformHelper.matrix);
        this.color.setHSL(0.075, 0.32, 0.25 + tree.colorVariation * 0.06);
        trunkMesh.setColorAt(trunkCount, this.color);
        trunkCount += 1;
      }

      const canopyHeight = tree.height - canopyBase;
      const canopyRadius = tree.height
        // Slightly broader crowns create fuller parks without adding another
        // instance or increasing the existing per-zoom tree budgets.
        * (isShrub ? 0.58 : isConifer ? 0.21 : 0.27)
        * tree.widthScale;

      // A compact shadow under each crown acts as fake ambient occlusion. It
      // is deliberately independent of tree height and sun direction so it
      // matches the centered building-footprint treatment.
      this.transformHelper.position.set(east, up + 0.06, north);
      this.transformHelper.rotation.set(0, 0, 0);
      this.transformHelper.scale.set(
        canopyRadius * 1.12,
        1,
        canopyRadius * 1.12,
      );
      this.transformHelper.updateMatrix();
      shadowMesh.setMatrixAt(index, this.transformHelper.matrix);

      this.transformHelper.position.set(east, up + canopyBase + canopyHeight / 2, north);
      this.transformHelper.rotation.set(0, tree.rotation, 0);
      this.transformHelper.scale.set(
        canopyRadius,
        isConifer ? canopyHeight : canopyHeight / 2,
        canopyRadius,
      );
      this.transformHelper.updateMatrix();

      if (isConifer) {
        coniferMesh.setMatrixAt(coniferCount, this.transformHelper.matrix);
        this.color.setHSL(0.31, 0.36, 0.29 + tree.colorVariation * 0.08);
        coniferMesh.setColorAt(coniferCount, this.color);
        coniferCount += 1;
      } else if (isShrub) {
        shrubMesh.setMatrixAt(shrubCount, this.transformHelper.matrix);
        this.color.setHSL(0.24 + tree.colorVariation * 0.04, 0.38, 0.31 + tree.colorVariation * 0.1);
        shrubMesh.setColorAt(shrubCount, this.color);
        shrubCount += 1;
      } else {
        broadleafMesh.setMatrixAt(broadleafCount, this.transformHelper.matrix);
        this.color.setHSL(0.29 + tree.colorVariation * 0.035, 0.4, 0.36 + tree.colorVariation * 0.1);
        broadleafMesh.setColorAt(broadleafCount, this.color);
        broadleafCount += 1;
      }
    });

    trunkMesh.count = trunkCount;
    broadleafMesh.count = broadleafCount;
    coniferMesh.count = coniferCount;
    shrubMesh.count = shrubCount;
    shadowMesh.count = trees.length;
    trunkMesh.instanceMatrix.needsUpdate = true;
    broadleafMesh.instanceMatrix.needsUpdate = true;
    coniferMesh.instanceMatrix.needsUpdate = true;
    shrubMesh.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (broadleafMesh.instanceColor) broadleafMesh.instanceColor.needsUpdate = true;
    if (coniferMesh.instanceColor) coniferMesh.instanceColor.needsUpdate = true;
    if (shrubMesh.instanceColor) shrubMesh.instanceColor.needsUpdate = true;
    map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer || map.getZoom() < TREE_MIN_ZOOM) return;

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
    this.shadowTexture?.dispose();
    this.shadowTexture = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }
}
