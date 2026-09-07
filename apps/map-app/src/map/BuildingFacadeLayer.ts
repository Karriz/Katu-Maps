import * as maplibregl from 'maplibre-gl';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';
import { pastelizeBuildingHex } from './MapPalette';

const FACADE_MIN_ZOOM = 15;
const MAX_WALL_COUNT = 3_200;
const MIN_WALL_LENGTH_METERS = 0.9;
const WALL_OFFSET_METERS = 0.14;
const STORY_HEIGHT_METERS = 3;
const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;
const COORDINATE_QUANTIZE = 1e6;
const NASINNEULA_BUILDING_OUTLINE_ID = 6_807_253_782;

export const BUILDING_FACADE_LAYER_ID = 'building-facades-3d';

const FALLBACK_BODY_COLORS = [
  0xfffdf8,
  0xf8f4ec,
  0xf4f1e8,
  0xf6f3ec,
  0xfaf7f1,
] as const;

type SourceFeature = ReturnType<MaplibreMap['querySourceFeatures']>[number];

type LngLatPoint = [number, number];

type WallSegment = {
  start: LngLatPoint;
  end: LngLatPoint;
  base: number;
  top: number;
  color: number;
  seed: number;
  distance: number;
};

type MetricPoint = [number, number];

export function seededUnit(seed: number, salt: number) {
  let value = Math.imul(seed ^ salt, 2_246_822_519);
  value ^= value >>> 13;
  value = Math.imul(value, 3_266_489_917);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_295;
}

export function parseBuildingColour(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^[0-9]+$/.test(trimmed)) return undefined;
  try {
    const color = new THREE.Color(trimmed);
    if (color.r === 0 && color.g === 0 && color.b === 0 && !/^#?0+$/i.test(trimmed) && trimmed.toLowerCase() !== 'black') {
      return undefined;
    }
    return color.getHex();
  } catch {
    return undefined;
  }
}

export function fallbackBuildingColour(seed: number) {
  return FALLBACK_BODY_COLORS[seed % FALLBACK_BODY_COLORS.length];
}

export function buildingColourSeed(id: number, longitude: number, latitude: number) {
  const gridLongitude = Math.round(longitude * 3_500);
  const gridLatitude = Math.round(latitude * 4_000);
  const osmId = Math.floor(Math.abs(id) / 10);
  return (Math.imul(gridLongitude, 73_856_093)
    ^ Math.imul(gridLatitude, 19_349_663)
    ^ Math.imul(osmId, 83_492_791)) >>> 0;
}

function toMetricPoint(coordinates: LngLatPoint): MetricPoint {
  return [
    coordinates[0] * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS,
    coordinates[1] * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS,
  ];
}

function longitudeScale(latitude: number) {
  return Math.max(Math.cos(85 * DEGREES_TO_RADIANS), Math.cos(latitude * DEGREES_TO_RADIANS));
}

export function wallLengthMeters(start: LngLatPoint, end: LngLatPoint) {
  const first = toMetricPoint(start);
  const second = toMetricPoint(end);
  const averageLatitude = (start[1] + end[1]) * 0.5;
  const east = (second[0] - first[0]) * longitudeScale(averageLatitude);
  const north = second[1] - first[1];
  return Math.hypot(east, north);
}

export function shouldRenderFacadesForViewport(
  _bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
) {
  // Pitched chase/driver cameras stretch geographic bounds far beyond the
  // nearby street. Keep the overlay on street zooms and let wall budgets plus
  // fragment distance fading limit cost to the neighbourhood in front of the camera.
  return zoom >= FACADE_MIN_ZOOM;
}

export function facadeDetailOpacity(zoom: number) {
  if (zoom <= FACADE_MIN_ZOOM) return 0;
  if (zoom >= 16.8) return 1;
  return Math.min(1, Math.max(0, (zoom - FACADE_MIN_ZOOM) / 1.8));
}

function quantizeCoordinate(value: number) {
  return Math.round(value * COORDINATE_QUANTIZE);
}

export function undirectedEdgeKey(start: LngLatPoint, end: LngLatPoint) {
  const first = `${quantizeCoordinate(start[0])}:${quantizeCoordinate(start[1])}`;
  const second = `${quantizeCoordinate(end[0])}:${quantizeCoordinate(end[1])}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function latToMercatorY(latitude: number) {
  const y = Math.log(Math.tan(Math.PI / 4 + (latitude * DEGREES_TO_RADIANS) / 2));
  return (1 - y / Math.PI) / 2;
}

export function isLikelyTileClipEdge(start: LngLatPoint, end: LngLatPoint) {
  const longitudeAligned = Math.abs(start[0] - end[0]) < 1.5e-6;
  const latitudeAligned = Math.abs(start[1] - end[1]) < 1.5e-6;
  if (!longitudeAligned && !latitudeAligned) return false;

  for (let zoom = 13; zoom <= 16; zoom += 1) {
    const tiles = 2 ** zoom;
    if (longitudeAligned) {
      const x = ((start[0] + 180) / 360) * tiles;
      if (Math.abs(x - Math.round(x)) < 2e-4) return true;
    }
    if (latitudeAligned) {
      const y = latToMercatorY(start[1]) * tiles;
      if (Math.abs(y - Math.round(y)) < 2e-4) return true;
    }
  }
  return false;
}

function ringCoordinates(geometry: SourceFeature['geometry']): LngLatPoint[][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => ring.map((point) => [Number(point[0]), Number(point[1])] as LngLatPoint));
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => (
      polygon.map((ring) => ring.map((point) => [Number(point[0]), Number(point[1])] as LngLatPoint))
    ));
  }
  return [];
}

function featureCentroid(rings: LngLatPoint[][]): LngLatPoint | undefined {
  const ring = rings[0];
  if (!ring || ring.length < 3) return undefined;
  let east = 0;
  let north = 0;
  let count = 0;
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    east += point[0];
    north += point[1];
    count += 1;
  }
  if (!count) return undefined;
  return [east / count, north / count];
}

function geometryIdentity(feature: SourceFeature) {
  const geometry = feature.geometry;
  if (!geometry || !('coordinates' in geometry)) return `${feature.id ?? 'anon'}`;
  const serialized = JSON.stringify(geometry.coordinates).slice(0, 180);
  return `${feature.id ?? 'anon'}:${serialized.length}:${serialized}`;
}

function numericFeatureId(feature: SourceFeature) {
  const id = Number(feature.id);
  return Number.isFinite(id) ? id : 0;
}

function buildingHeights(properties: Record<string, unknown> | null) {
  const top = Number(properties?.render_height ?? properties?.height);
  const base = Number(properties?.render_min_height ?? properties?.min_height);
  return {
    base: Number.isFinite(base) ? Math.max(0, base) : 0,
    top: Number.isFinite(top) && top > 1 ? top : 6,
  };
}

function shouldSkipBuilding(feature: SourceFeature) {
  const properties = feature.properties ?? {};
  if (properties.hide_3d) return true;
  const id = numericFeatureId(feature);
  if (id === NASINNEULA_BUILDING_OUTLINE_ID) return true;
  const { base, top } = buildingHeights(properties);
  return top - base < 2.2;
}

type DirectedEdge = {
  key: string;
  start: LngLatPoint;
  end: LngLatPoint;
};

export function uniqueBuildingWalls(features: SourceFeature[]): WallSegment[] {
  const uniqueGeometries = new Set<string>();
  const groups = new Map<string, {
    edges: DirectedEdge[];
    color: number;
    seed: number;
    base: number;
    top: number;
    centroid: LngLatPoint;
  }>();

  for (const feature of features) {
    if (shouldSkipBuilding(feature)) continue;
    const identity = geometryIdentity(feature);
    if (uniqueGeometries.has(identity)) continue;
    uniqueGeometries.add(identity);

    const rings = ringCoordinates(feature.geometry);
    const centroid = featureCentroid(rings);
    if (!centroid) continue;

    const id = numericFeatureId(feature);
    const groupKey = id ? String(id) : identity;
    const heights = buildingHeights(feature.properties);
    const mappedColour = parseBuildingColour(feature.properties?.colour ?? feature.properties?.color);
    const seed = buildingColourSeed(id, centroid[0], centroid[1]);
    const wallColour = mappedColour !== undefined
      ? pastelizeBuildingHex(mappedColour)
      : fallbackBuildingColour(seed);
    const group = groups.get(groupKey) ?? {
      edges: [],
      color: wallColour,
      seed,
      base: heights.base,
      top: heights.top,
      centroid,
    };
    if (mappedColour !== undefined) group.color = wallColour;
    group.base = Math.min(group.base, heights.base);
    group.top = Math.max(group.top, heights.top);

    for (const ring of rings) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const start = ring[index];
        const end = ring[index + 1];
        if (!Number.isFinite(start[0]) || !Number.isFinite(end[0])) continue;
        group.edges.push({
          key: undirectedEdgeKey(start, end),
          start,
          end,
        });
      }
    }
    groups.set(groupKey, group);
  }

  const walls: WallSegment[] = [];
  for (const group of groups.values()) {
    const counts = new Map<string, number>();
    for (const edge of group.edges) {
      counts.set(edge.key, (counts.get(edge.key) ?? 0) + 1);
    }
    for (const edge of group.edges) {
      if ((counts.get(edge.key) ?? 0) !== 1) continue;
      if (isLikelyTileClipEdge(edge.start, edge.end)) continue;
      const length = wallLengthMeters(edge.start, edge.end);
      if (length < MIN_WALL_LENGTH_METERS) continue;
      walls.push({
        start: edge.start,
        end: edge.end,
        base: group.base,
        top: group.top,
        color: group.color,
        seed: group.seed,
        distance: 0,
      });
    }
  }
  return walls;
}

function localEastNorth(
  point: LngLatPoint,
  origin: maplibregl.LngLat,
): [number, number] {
  const originMetric = toMetricPoint([origin.lng, origin.lat]);
  const pointMetric = toMetricPoint(point);
  const scale = longitudeScale((origin.lat + point[1]) * 0.5);
  return [
    (pointMetric[0] - originMetric[0]) * scale,
    pointMetric[1] - originMetric[1],
  ];
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 wallColor;
  attribute float wallU;
  attribute float wallV;
  attribute float wallSeed;
  varying vec3 vColor;
  varying float vU;
  varying float vV;
  varying float vSeed;
  varying float vDistance;

  void main() {
    vColor = wallColor;
    vU = wallU;
    vV = wallV;
    vSeed = wallSeed;
    vDistance = length(position.xz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  uniform float uNight;
  uniform float uStoryHeight;
  varying vec3 vColor;
  varying float vU;
  varying float vV;
  varying float vSeed;
  varying float vDistance;

  void main() {
    float distanceFade = smoothstep(380.0, 90.0, vDistance);
    float ground = step(vV, uStoryHeight + 0.05);

    // Upper-floor window bands stay off for now; keep the ground-floor band.
    float storefront = ground
      * step(0.32, vV)
      * step(vV, 2.62);

    float alpha = uOpacity * distanceFade * storefront * mix(0.58, 0.7, uNight);
    if (alpha < 0.01) discard;

    vec3 bandColor = mix(vec3(0.32, 0.34, 0.34), vec3(0.24, 0.25, 0.25), uNight);
    gl_FragColor = vec4(mix(vColor * 0.92, bandColor, storefront), alpha);
  }
`;

export class BuildingFacadeLayer implements CustomLayerInterface {
  readonly id = BUILDING_FACADE_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private sceneOrigin = new maplibregl.LngLat(23.7609, 61.4981);
  private sceneOriginElevation = 0;
  private mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private enabled = true;
  private nightMix = 0;
  lastWallCount = 0;
  private readonly elevationCache = new Map<string, number>();

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uOpacity: { value: 0 },
        uNight: { value: 0 },
        uStoryHeight: { value: STORY_HEIGHT_METERS },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      vertexColors: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    const geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.clearGeometry();
    this.map?.triggerRepaint();
  }

  setNightMix(nightMix: number) {
    this.nightMix = Math.min(1, Math.max(0, nightMix));
    if (this.mesh) this.mesh.material.uniforms.uNight.value = this.nightMix;
    this.map?.triggerRepaint();
  }

  updateFacades() {
    const map = this.map;
    const mesh = this.mesh;
    if (!map || !mesh) return;

    const bounds = map.getBounds();
    const viewport = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    };
    const zoom = map.getZoom();
    const opacity = this.enabled ? facadeDetailOpacity(zoom) : 0;
    mesh.material.uniforms.uOpacity.value = opacity;
    mesh.material.uniforms.uNight.value = this.nightMix;

    if (!this.enabled || !shouldRenderFacadesForViewport(viewport, zoom) || opacity <= 0) {
      this.clearGeometry();
      this.lastWallCount = 0;
      map.triggerRepaint();
      return;
    }

    this.sceneOrigin = map.getCenter();
    this.sceneOriginElevation = map.queryTerrainElevation(this.sceneOrigin) ?? 0;
    const features = this.sourceFeatures().filter((feature) => {
      const rings = ringCoordinates(feature.geometry);
      const centroid = featureCentroid(rings);
      if (!centroid) return false;
      return wallLengthMeters(centroid, [this.sceneOrigin.lng, this.sceneOrigin.lat]) < 420;
    });
    const walls = uniqueBuildingWalls(features)
      .map((wall) => {
        const mid: LngLatPoint = [
          (wall.start[0] + wall.end[0]) * 0.5,
          (wall.start[1] + wall.end[1]) * 0.5,
        ];
        return {
          ...wall,
          distance: wallLengthMeters(mid, [this.sceneOrigin.lng, this.sceneOrigin.lat]),
        };
      })
      .sort((first, second) => first.distance - second.distance)
      .slice(0, MAX_WALL_COUNT);

    this.writeGeometry(walls);
    this.lastWallCount = walls.length;
    map.triggerRepaint();
  }

  private sourceFeatures(): SourceFeature[] {
    const map = this.map;
    if (!map?.getSource('openfreemap')) return [];
    try {
      return map.querySourceFeatures('openfreemap', { sourceLayer: 'building' });
    } catch (error) {
      console.warn('Could not query building features for façades', error);
      return [];
    }
  }

  private writeGeometry(walls: WallSegment[]) {
    const mesh = this.mesh;
    const map = this.map;
    if (!mesh || !map) return;

    const vertexCount = walls.length * 4;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const wallU = new Float32Array(vertexCount);
    const wallV = new Float32Array(vertexCount);
    const wallSeed = new Float32Array(vertexCount);
    const indices = new Uint32Array(walls.length * 6);
    const color = new THREE.Color();

    walls.forEach((wall, wallIndex) => {
      const start = localEastNorth(wall.start, this.sceneOrigin);
      const end = localEastNorth(wall.end, this.sceneOrigin);
      const edgeEast = end[0] - start[0];
      const edgeNorth = end[1] - start[1];
      const edgeLength = Math.hypot(edgeEast, edgeNorth) || 1;
      const outwardEast = edgeNorth / edgeLength * WALL_OFFSET_METERS;
      const outwardNorth = -edgeEast / edgeLength * WALL_OFFSET_METERS;
      const elevation = this.wallElevation(wall) - this.sceneOriginElevation;
      const bottom = elevation + wall.base;
      const top = elevation + wall.top;
      const seed = seededUnit(wall.seed, 17);
      color.setHex(wall.color);

      const corners: Array<[number, number, number, number, number]> = [
        [start[0] + outwardEast, bottom, start[1] + outwardNorth, 0, 0],
        [start[0] + outwardEast, top, start[1] + outwardNorth, 0, wall.top - wall.base],
        [end[0] + outwardEast, top, end[1] + outwardNorth, edgeLength, wall.top - wall.base],
        [end[0] + outwardEast, bottom, end[1] + outwardNorth, edgeLength, 0],
      ];
      const vertexOffset = wallIndex * 4;
      corners.forEach((corner, cornerIndex) => {
        const index = vertexOffset + cornerIndex;
        positions[index * 3] = corner[0];
        positions[index * 3 + 1] = corner[1];
        positions[index * 3 + 2] = corner[2];
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
        wallU[index] = corner[3];
        wallV[index] = corner[4];
        wallSeed[index] = seed;
      });
      const indexOffset = wallIndex * 6;
      indices[indexOffset] = vertexOffset;
      indices[indexOffset + 1] = vertexOffset + 1;
      indices[indexOffset + 2] = vertexOffset + 2;
      indices[indexOffset + 3] = vertexOffset;
      indices[indexOffset + 4] = vertexOffset + 2;
      indices[indexOffset + 5] = vertexOffset + 3;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('wallColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('wallU', new THREE.BufferAttribute(wallU, 1));
    geometry.setAttribute('wallV', new THREE.BufferAttribute(wallV, 1));
    geometry.setAttribute('wallSeed', new THREE.BufferAttribute(wallSeed, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  private wallElevation(wall: WallSegment) {
    const map = this.map;
    const longitude = (wall.start[0] + wall.end[0]) * 0.5;
    const latitude = (wall.start[1] + wall.end[1]) * 0.5;
    const key = `${longitude.toFixed(4)}:${latitude.toFixed(4)}`;
    const cached = this.elevationCache.get(key);
    if (cached !== undefined) return cached;
    const elevation = map?.queryTerrainElevation(new maplibregl.LngLat(longitude, latitude))
      ?? this.sceneOriginElevation;
    this.elevationCache.set(key, elevation);
    while (this.elevationCache.size > MAX_WALL_COUNT) {
      const oldestKey = this.elevationCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.elevationCache.delete(oldestKey);
    }
    return elevation;
  }

  private clearGeometry() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.BufferGeometry();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    const mesh = this.mesh;
    if (!map || !renderer || !mesh) return;
    if (!this.enabled || mesh.material.uniforms.uOpacity.value <= 0) return;

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
    this.clearGeometry();
    this.elevationCache.clear();
    this.mesh?.material.dispose();
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.mesh = undefined;
    this.map = undefined;
  }
}
