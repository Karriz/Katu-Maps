import * as maplibregl from 'maplibre-gl';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type CustomTerrainRenderInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';
import {
  CARTOON_NIGHT_SHADOW_COLOR,
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_POLAR_DEGREES,
  sunCartesian,
  treeShadowOpacity,
} from './CartoonLighting';
import {
  containsBuildingView,
  sortBuildingCandidates,
  type BuildingView,
} from './BuildingModelWork';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';
import { TerrainShadowDrape } from './TerrainShadowDrape';

/**
 * Three.js renders model and building casters into one directional shadow map.
 * With terrain enabled, MapLibre shades terrain tiles with that map and drapes
 * them over its own terrain. Flat maps retain the older Three ground receiver.
 *
 * The cartoon colors and opacity follow the shared day/night lighting model.
 */

export const SHADOW_CATCHER_LAYER_ID = 'ground-shadow-catcher-3d';

const SHADOW_MIN_ZOOM = 13;
/** Terrain-tile shadows are reserved for street views; the draped style remains the fallback. */
const TERRAIN_SHADOW_MIN_ZOOM = 16.75;
const SHADOW_FRAME_BUDGET_MS = 4;
const MAX_GRID_CELLS_PER_AXIS = 160;
const COARSE_GROUND_CELL_METERS = 80;
/** Base separation from terrain; midpoint relief adds lift where needed. */
const GROUND_LIFT_METERS = 0.3;
const GROUND_MARGIN_METERS = 60;
const SHADOW_MAP_SIZE = 2560;

/** Grow detail at street zoom while keeping the phone and GPU texture budgets bounded. */
export function shadowTextureSizes(zoom: number, canvasWidth: number, maxTextureSize: number) {
  const mobile = canvasWidth < 768;
  const requested = zoom >= 17
    ? (mobile ? [2048, 1024] : [4096, 1536])
    : zoom >= 15
      ? (mobile ? [1536, 768] : [2560, 1024])
      : (mobile ? [1024, 512] : [1536, 768]);
  const cap = Math.max(1, Math.floor(maxTextureSize));
  return {
    shadow: Math.min(requested[0], cap),
    height: Math.min(requested[1], cap),
  };
}
const TILE_SHADOW_UPDATE_INTERVAL_MS = 350;
const CATCHER_RECENTER_DISTANCE_METERS = 2000;
/** Matches the elevation clamp of buildingShadowTranslate in DayNightAppearance. */
const MIN_SUN_ELEVATION_DEGREES = 8;
const BUILDING_CASTER_MAX_COUNT = 2400;
const COARSE_BUILDING_CASTER_COUNT = 300;
const BUILDING_CASTER_MAX_VERTICES = 160_000;
const BUILDING_CASTER_MAX_RING_VERTICES = 64;
const MAX_ELEVATION_CACHE_ENTRIES = 80_000;
const NASINNEULA_BUILDING_OUTLINE_ID = 6_807_253_782;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const METRES_PER_DEGREE_LAT = Math.PI / 180 * 6_378_137;

/**
 * Half-span caps per zoom band. Pitched views reach the horizon in
 * map.getBounds(); shadows only read near the camera, and DEM sampling is the
 * expensive part (~0.3 ms per queryTerrainElevation call), so the drape and
 * the building casters sample a bounded window instead.
 */
export function groundHalfSpanCapMeters(zoom: number) {
  if (zoom < 13.5) return 2000;
  if (zoom < 15) return 1400;
  if (zoom < 16.5) return 900;
  return 700;
}

/** Narrow close-zoom terrain shadow coverage without losing pitched views. */
export function terrainShadowHalfSpanMeters(zoom: number, pitch: number) {
  const closeSpan = Math.max(300, 700 / 2 ** Math.max(0, zoom - 16.5));
  const pitchFactor = 1 + Math.max(0, Math.min(25, pitch - 50)) / 25 * 0.6;
  return Math.min(700, Math.ceil(closeSpan * pitchFactor / 25) * 25);
}

export type ShadowCasterOrigin = {
  longitude: number;
  latitude: number;
  elevation: number;
};

export type ShadowCasterSet = {
  /**
   * MapLibre layer id of the owning layer. Casters are suspended while that
   * layer is hidden, mirroring how MapLibre stops calling its render().
   */
  layerId?: string;
  /** Root object whose descendant meshes cast directional shadows. */
  root: () => THREE.Object3D | undefined;
  /** Origin of the root's local metre frame, or undefined while unavailable. */
  origin: () => ShadowCasterOrigin | undefined;
};

export type GroundGridWindow = {
  cell: number;
  minCellX: number;
  minCellZ: number;
  cellsX: number;
  cellsZ: number;
};

/** How far shadows can reach across the ground for the current sun elevation. */
export function shadowReachMeters(polarDegrees: number, maxCasterHeightMeters = 45) {
  const elevation = Math.max(
    MIN_SUN_ELEVATION_DEGREES,
    90 - Math.min(90, Math.max(0, polarDegrees)),
  );
  return Math.min(350, Math.max(30, maxCasterHeightMeters / Math.tan(elevation * DEGREES_TO_RADIANS)));
}

/** DEM sample spacing for the draped ground mesh; finer near street level. */
export function groundCellSize(zoom: number) {
  if (zoom < 13.5) return 56;
  if (zoom < 15) return 36;
  if (zoom < 16.5) return 28;
  return 22;
}

/**
 * Snap a metres-bounds window onto a world-anchored cell grid so panning inside
 * the window keeps the same sample set, and grow the cell size when the span
 * would exceed the vertex budget.
 */
export function groundGridWindow(
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  requestedCell: number,
): GroundGridWindow {
  let cell = requestedCell;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  while (
    Math.ceil(spanX / cell) > MAX_GRID_CELLS_PER_AXIS
    || Math.ceil(spanZ / cell) > MAX_GRID_CELLS_PER_AXIS
  ) {
    cell *= 2;
  }
  const minCellX = Math.floor(bounds.minX / cell);
  const maxCellX = Math.ceil(bounds.maxX / cell);
  const minCellZ = Math.floor(bounds.minZ / cell);
  const maxCellZ = Math.ceil(bounds.maxZ / cell);
  return {
    cell,
    minCellX,
    minCellZ,
    cellsX: Math.max(1, maxCellX - minCellX),
    cellsZ: Math.max(1, maxCellZ - minCellZ),
  };
}

export function groundGridSignature(window: GroundGridWindow, terrainZoomBucket: number, terrainRevision: number) {
  return [
    window.cell,
    window.minCellX,
    window.minCellZ,
    window.cellsX,
    window.cellsZ,
    terrainZoomBucket,
    terrainRevision,
  ].join(':');
}

function stripClosingVertex(ring: Array<[number, number]>): Array<[number, number]> {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

/**
 * Deterministic ear clipping for footprint caps. Returns triangles as indices
 * into the (stripped) ring, or null for degenerate rings.
 */
export function triangulateRing(ring: Array<[number, number]>): number[] | null {
  const points = stripClosingVertex(ring);
  const count = points.length;
  if (count < 3) return null;
  let twiceArea = 0;
  for (let index = 0; index < count; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % count];
    twiceArea += x1 * y2 - x2 * y1;
  }
  if (Math.abs(twiceArea) < 1e-6) return null;
  // Work on an index list normalized to counter-clockwise winding.
  let remaining = Array.from({ length: count }, (_unused, index) => index);
  if (twiceArea < 0) remaining.reverse();
  const triangles: number[] = [];
  const cross = (a: number, b: number, c: number) => {
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const [cx, cy] = points[c];
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  };
  const pointInsideTriangle = (a: number, b: number, c: number, p: number) => {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    return d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9;
  };
  let guard = 0;
  while (remaining.length > 3 && guard < count * count) {
    guard += 1;
    let clipped = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index + remaining.length - 1) % remaining.length];
      const current = remaining[index];
      const next = remaining[(index + 1) % remaining.length];
      if (cross(previous, current, next) <= 0) continue;
      let occluded = false;
      for (const other of remaining) {
        if (other === previous || other === current || other === next) continue;
        if (pointInsideTriangle(previous, current, next, other)) {
          occluded = true;
          break;
        }
      }
      if (occluded) continue;
      triangles.push(previous, current, next);
      remaining.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (remaining.length !== 3) return null;
  triangles.push(remaining[0], remaining[1], remaining[2]);
  return triangles;
}

/**
 * Append a closed vertical prism (bottom cap, walls, top cap) for one building
 * footprint in local metres. Ring winding does not matter; the depth material
 * renders both sides. Returns the number of vertices appended.
 */
export function appendBuildingCaster(
  positions: number[],
  indices: number[],
  ring: Array<[number, number]>,
  triangles: number[],
  baseY: number,
  topY: number,
): number {
  const count = ring.length;
  const vertexOffset = positions.length / 3;
  for (const [east, north] of ring) {
    positions.push(east, baseY, north);
  }
  for (const [east, north] of ring) {
    positions.push(east, topY, north);
  }
  for (let index = 0; index < triangles.length; index += 3) {
    // Top cap in the triangulated winding, bottom cap reversed.
    indices.push(
      vertexOffset + count + triangles[index],
      vertexOffset + count + triangles[index + 1],
      vertexOffset + count + triangles[index + 2],
    );
    indices.push(
      vertexOffset + triangles[index],
      vertexOffset + triangles[index + 2],
      vertexOffset + triangles[index + 1],
    );
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const baseA = vertexOffset + index;
    const baseB = vertexOffset + next;
    const topA = vertexOffset + count + index;
    const topB = vertexOffset + count + next;
    indices.push(baseA, baseB, topB, baseA, topB, topA);
  }
  return count * 2;
}

type CasterEntry = {
  set: ShadowCasterSet;
  host: THREE.Object3D;
  proxies: Map<THREE.Object3D, THREE.Mesh | THREE.InstancedMesh>;
};

type BuildingCasterCandidate = {
  ring: Array<[number, number]>;
  centroidLng: number;
  centroidLat: number;
  area: number;
  baseY: number;
  topY: number;
};

export class ShadowCatcherLayer implements CustomLayerInterface {
  readonly id = SHADOW_CATCHER_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  terrainTileRevision = 0;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private tileDrape?: TerrainShadowDrape;
  private tileDepthTexture?: WebGLTexture;
  private readonly tileShadowMatrix = new THREE.Matrix4();
  private tileOrigin: [number, number, number, number] = [0, 0, 1, 0];
  private tileReady = false;
  private tileDirty = true;
  private tileRevisionPending = false;
  private lastTileUpdate = 0;
  private tileHalfSpan = 0;
  private lastCasterSignature = '';
  private tileUpdateTimer?: ReturnType<typeof setTimeout>;
  private shadowMapSize = SHADOW_MAP_SIZE;
  private maxTextureSize = 4096;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private sceneOrigin = new maplibregl.LngLat(23.7609, 61.4981);
  private sceneOriginElevation = 0;

  private groundMesh?: THREE.Mesh;
  private groundMaterial?: THREE.ShadowMaterial;
  private buildingMesh?: THREE.Mesh;
  private readonly casterMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private sunlight?: THREE.DirectionalLight;
  private readonly sunTarget = new THREE.Object3D();

  private readonly casters = new Map<string, CasterEntry>();
  private readonly sceneInverse = new THREE.Matrix4();

  private azimuth = CARTOON_SUN_AZIMUTH_DEGREES;
  private polar = CARTOON_SUN_POLAR_DEGREES;
  private nightMix = 0;
  private darkMode = false;
  private active = false;
  private activeChangeHandler?: (active: boolean) => void;
  private flightMode = false;

  private groundJob?: {
    generator: Generator<void, boolean, void>;
    signature: string;
    windowSignature: string;
    quality: 'coarse' | 'fine';
    startedAt: number;
    terrainRevision: number;
  };
  private groundSignature = '';
  private groundBounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  private buildingMeshView?: BuildingView;
  private buildingJob?: {
    generator: Generator<void, boolean, void>;
    signature: string;
    viewSignature: string;
    quality: 'coarse' | 'fine';
    startedAt: number;
    view: BuildingView;
    sourceRevision: number;
  };
  private buildingSignature = '';
  private groundMeshOrigin = this.sceneOrigin;
  private groundMeshOriginElevation = 0;
  private buildingMeshOrigin = this.sceneOrigin;
  private buildingMeshOriginElevation = 0;
  private terrainRevision = 0;
  private sourceRevision = 0;
  private terrainZoomBucket = 0;
  /** Exact geographic DEM samples; keys never alias different grid origins. */
  private readonly elevationCache = new Map<string, number>();
  private lastOpacityZoomBucket = -1;
  private readonly performanceStats = {
    groundJobs: 0,
    groundCommits: 0,
    buildingJobs: 0,
    buildingCommits: 0,
    lastGroundJobMs: 0,
    lastBuildingJobMs: 0,
  };

  constructor(private readonly sourceId: string = OPENFREEMAP_SOURCE_ID) {}

  getPerformanceStats() {
    let proxyCount = 0;
    let visibleProxyCount = 0;
    for (const entry of this.casters.values()) {
      for (const proxy of entry.proxies.values()) {
        proxyCount += 1;
        if (proxy.visible) visibleProxyCount += 1;
      }
    }
    return {
      ...this.performanceStats,
      active: this.active,
      terrainTileDrapeReady: this.tileReady,
      shadowMapSize: this.shadowMapSize,
      terrainHeightSize: this.tileDrape?.heightSize ?? 0,
      tileHalfSpan: this.tileHalfSpan,
      azimuth: this.azimuth,
      polar: this.polar,
      nightMix: this.nightMix,
      proxyCount,
      visibleProxyCount,
      hasGroundMesh: Boolean(this.groundBounds),
      groundMeshVisible: this.groundMesh?.visible ?? false,
      groundJobActive: Boolean(this.groundJob),
      buildingJobActive: Boolean(this.buildingJob),
    };
  }

  isActive() { return this.active; }

  /** Called with false when the catcher retires, so blob decals return as the fallback. */
  setActiveChangeHandler(handler?: (active: boolean) => void) {
    this.activeChangeHandler = handler;
  }

  registerCasters(key: string, set: ShadowCasterSet) {
    this.casters.delete(key);
    const host = new THREE.Object3D();
    this.scene.add(host);
    this.casters.set(key, { set, host, proxies: new Map() });
  }

  setFlightMode(enabled: boolean) {
    if (this.flightMode === enabled) return;
    this.flightMode = enabled;
    this.tileDirty = true;
    this.map?.triggerRepaint();
  }

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    this.applyShadowColors();
    this.tileDirty = true;
    this.map?.triggerRepaint();
  }

  setDayNightLighting(lighting: {
    azimuth: number;
    polar: number;
    nightMix: number;
  } | null) {
    this.azimuth = lighting?.azimuth ?? CARTOON_SUN_AZIMUTH_DEGREES;
    this.polar = lighting?.polar ?? CARTOON_SUN_POLAR_DEGREES;
    this.nightMix = lighting?.nightMix ?? 0;
    this.tileDirty = true;
    this.applyShadowColors();
    this.map?.triggerRepaint();
  }

  /**
   * DEM content changed; the draped mesh must resample even at a static view.
   * In-flight jobs keep running so DEM streaming cannot starve the first mesh;
   * commits made against stale terrain are refreshed right after. Cache keys
   * carry the revision, so new samples never read stale heights.
   */
  invalidateTerrain() {
    this.terrainRevision += 1;
    this.tileDirty = true;
    this.map?.triggerRepaint();
  }

  /** Vector tiles changed; building footprint casters resample. */
  invalidateSource() {
    this.sourceRevision += 1;
    this.tileDirty = true;
    this.map?.triggerRepaint();
  }

  private shadowNightMix() {
    return Math.max(this.darkMode ? 0.85 : 0, this.nightMix);
  }

  private applyShadowColors() {
    if (!this.groundMaterial) return;
    this.groundMaterial.color
      .set(CARTOON_SHADOW_COLOR)
      .lerp(new THREE.Color(CARTOON_NIGHT_SHADOW_COLOR), this.shadowNightMix());
    this.groundMaterial.opacity = this.currentOpacity();
  }

  private currentOpacity() {
    const zoom = this.map?.getZoom() ?? SHADOW_MIN_ZOOM;
    return treeShadowOpacity(zoom) * (1 - this.shadowNightMix() * 0.7);
  }

  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.activeChangeHandler?.(active);
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.sceneOrigin = map.getCenter();
    this.sceneOriginElevation = map.queryTerrainElevation(this.sceneOrigin) ?? 0;
    this.groundMeshOrigin = this.sceneOrigin;
    this.groundMeshOriginElevation = this.sceneOriginElevation;
    this.buildingMeshOrigin = this.sceneOrigin;
    this.buildingMeshOriginElevation = this.sceneOriginElevation;
    // Ground and casters use local metre coordinates: x=east, y=up, z=north.
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));

    this.sunlight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunlight.castShadow = true;
    // The catcher drives shadow map updates per frame (needsUpdate) so the
    // color pass can reuse the map without re-entering the shadow pass.
    this.sunlight.shadow.autoUpdate = false;
    this.maxTextureSize = Number((gl as WebGL2RenderingContext).getParameter(
      (gl as WebGL2RenderingContext).MAX_TEXTURE_SIZE,
    )) || 4096;
    const textureSizes = shadowTextureSizes(map.getZoom(), map.getCanvas().clientWidth, this.maxTextureSize);
    this.shadowMapSize = textureSizes.shadow;
    this.sunlight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    this.sunlight.shadow.bias = -0.00015;
    this.sunlight.shadow.normalBias = 0.6;
    const shadowCamera = this.sunlight.shadow.camera;
    shadowCamera.left = -500;
    shadowCamera.right = 500;
    shadowCamera.top = 500;
    shadowCamera.bottom = -500;
    shadowCamera.near = 1;
    shadowCamera.far = 3000;
    this.scene.add(this.sunlight);
    this.scene.add(this.sunTarget);
    this.sunlight.target = this.sunTarget;

    this.groundMaterial = new THREE.ShadowMaterial({
      color: CARTOON_SHADOW_COLOR,
      opacity: 0.22,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.groundMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.groundMaterial);
    this.groundMesh.receiveShadow = true;
    this.groundMesh.frustumCulled = false;
    this.groundMesh.visible = false;
    this.scene.add(this.groundMesh);

    this.buildingMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.casterMaterial);
    this.buildingMesh.castShadow = true;
    this.buildingMesh.frustumCulled = false;
    this.buildingMesh.visible = false;
    this.scene.add(this.buildingMesh);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // Regular depth sampling lets the tile shader filter in four explicit taps.
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    try {
      this.tileDrape = new TerrainShadowDrape(
        gl as WebGL2RenderingContext, textureSizes.height,
      );
    } catch {
      // The existing decals remain visible when float terrain targets are unavailable.
      this.tileDrape = undefined;
    }
    this.applyShadowColors();
  }

  onRemove() {
    this.groundJob = undefined;
    this.buildingJob = undefined;
    this.setActive(false);
    if (this.tileUpdateTimer) clearTimeout(this.tileUpdateTimer);
    this.tileUpdateTimer = undefined;
    this.tileDrape?.dispose();
    this.tileDrape = undefined;
    this.tileDepthTexture = undefined;
    this.tileReady = false;
    this.tileRevisionPending = false;
    this.groundMesh?.geometry.dispose();
    this.buildingMesh?.geometry.dispose();
    for (const entry of this.casters.values()) {
      for (const proxy of entry.proxies.values()) entry.host.remove(proxy);
      entry.proxies.clear();
      this.scene.remove(entry.host);
    }
    this.casters.clear();
    this.groundMaterial?.dispose();
    this.casterMaterial.dispose();
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }

  prerender(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    const light = this.sunlight;
    const drape = this.tileDrape;
    if (!map?.getTerrain() || map.getZoom() < TERRAIN_SHADOW_MIN_ZOOM
      || !renderer || !light || !drape || !options.renderTerrainHeightMap) {
      if (map?.getTerrain()) {
        if (this.tileReady) {
          this.tileReady = false;
          this.tileRevisionPending = false;
          this.terrainTileRevision += 1;
          map.triggerRepaint();
        }
        this.setActive(false);
      }
      return;
    }

    this.recenterIfNeeded(map);
    this.groundJob = undefined;
    if (this.groundMesh) this.groundMesh.visible = false;
    this.updateTileCasterJobs(map);
    const casterSignature = this.casterSignature(map);
    if (casterSignature !== this.lastCasterSignature) {
      this.lastCasterSignature = casterSignature;
      this.tileDirty = true;
    }
    const requestedTextureSizes = shadowTextureSizes(map.getZoom(), map.getCanvas().clientWidth, this.maxTextureSize);
    // Reallocating the depth and height textures during a gesture can leave
    // terrain tiles referring to a texture that Three has already replaced.
    const textureSizes = map.isMoving() && this.tileReady
      ? { shadow: this.shadowMapSize, height: drape.heightSize }
      : requestedTextureSizes;
    const tileHalfSpan = terrainShadowHalfSpanMeters(map.getZoom(), map.getPitch());
    if (textureSizes.shadow !== this.shadowMapSize || textureSizes.height !== drape.heightSize
      || tileHalfSpan !== this.tileHalfSpan) {
      this.tileDirty = true;
    }
    const now = performance.now();
    // Static tile shadows stay cached while the camera moves within the fixed window.
    // Vehicle casters refresh at a bounded rate while their model layers are active.
    const dynamicCastersVisible = [...this.casters.values()].some(({ set }) =>
      (set.layerId === 'transit-vehicle-model-3d' || set.layerId === 'live-vehicle-models-3d')
      && this.layerVisible(map, set.layerId) && Boolean(set.root()));
    // MapLibre releases cached terrain textures on a revision change. Keep the
    // completed textures through a zoom gesture and publish one revision after it.
    if (this.tileRevisionPending && !map.isMoving() && !this.tileDirty) {
      this.tileRevisionPending = false;
      this.terrainTileRevision += 1;
      map.triggerRepaint();
      return;
    }
    if (this.tileReady && !this.tileDirty && !dynamicCastersVisible && !map.isMoving()) return;
    if (this.tileReady && !this.tileDirty && now - this.lastTileUpdate < TILE_SHADOW_UPDATE_INTERVAL_MS) {
      if (!this.tileUpdateTimer) {
        this.tileUpdateTimer = setTimeout(() => {
          this.tileUpdateTimer = undefined;
          this.map?.triggerRepaint();
        }, TILE_SHADOW_UPDATE_INTERVAL_MS - (now - this.lastTileUpdate));
      }
      return;
    }

    this.syncCasterProxies(map);
    if (renderer.shadowMap.type !== THREE.BasicShadowMap) renderer.shadowMap.type = THREE.BasicShadowMap;
    const visibleCaster = Boolean(this.buildingMesh?.visible)
      || [...this.casters.values()].some(({ proxies }) =>
        [...proxies.values()].some((proxy) => proxy.visible));
    if (!visibleCaster) {
      // Vector tiles can briefly have no building features during a zoom.
      // Keep the last completed shadow until replacement casters are ready.
      if (this.tileReady && this.buildings3dVisible(map)
        && (map.isMoving() || Boolean(this.buildingJob)
          || !(map.isSourceLoaded?.(this.sourceId) ?? true))) return;
      if (this.tileReady) {
        this.tileReady = false;
        this.tileRevisionPending = false;
        this.terrainTileRevision += 1;
        map.triggerRepaint();
      }
      this.setActive(false);
      return;
    }
    if (textureSizes.shadow !== this.shadowMapSize) {
      this.shadowMapSize = textureSizes.shadow;
      light.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
      light.shadow.map?.setSize(this.shadowMapSize, this.shadowMapSize);
    }
    drape.resizeHeightMap(textureSizes.height);
    this.fitSunCameraForTiles(map);
    this.groundMesh!.visible = false;
    const mercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const units = mercator.meterInMercatorCoordinateUnits();
    const halfSpan = tileHalfSpan + shadowReachMeters(this.polar) + GROUND_MARGIN_METERS;
    const radius = halfSpan * units;
    const bounds: [number, number, number, number] = [
      mercator.x - radius, mercator.y - radius,
      mercator.x + radius, mercator.y + radius,
    ];
    // The receiver is MapLibre's own terrain. Three only fills the caster depth map.
    renderer.resetState();
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    light.shadow.needsUpdate = true;
    renderer.render(this.scene, this.camera);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    renderer.resetState();
    const depth = light.shadow.map?.depthTexture;
    const depthTexture = depth && (renderer.properties.get(depth) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!depthTexture) {
      this.tileDirty = true;
      if (!this.tileReady) this.setActive(false);
      return;
    }
    drape.updateHeightMap(options.renderTerrainHeightMap, bounds);
    this.tileDepthTexture = depthTexture;
    this.tileShadowMatrix.copy(light.shadow.matrix);
    this.tileOrigin = [mercator.x, mercator.y, units, this.sceneOriginElevation];
    this.tileHalfSpan = tileHalfSpan;
    this.tileReady = true;
    this.tileDirty = false;
    this.lastTileUpdate = now;
    if (map.isMoving()) {
      this.tileRevisionPending = true;
    } else {
      this.tileRevisionPending = false;
      this.terrainTileRevision += 1;
    }
    this.setActive(true);
    map.triggerRepaint();
  }

  renderToTerrainTile(_gl: WebGL2RenderingContext, options: CustomTerrainRenderInput) {
    if (!this.tileReady || !this.tileDrape || !this.tileDepthTexture
      || !this.map || this.map.getZoom() < TERRAIN_SHADOW_MIN_ZOOM) return;
    const color = new THREE.Color(CARTOON_SHADOW_COLOR)
      .lerp(new THREE.Color(CARTOON_NIGHT_SHADOW_COLOR), this.shadowNightMix());
    this.tileDrape.draw(
      options,
      this.tileDepthTexture,
      new Float32Array(this.tileShadowMatrix.elements),
      this.tileOrigin,
      [color.r, color.g, color.b],
      this.currentOpacity(),
    );
  }

  private casterSignature(map: MaplibreMap) {
    const parts: string[] = [];
    for (const [key, { set }] of this.casters) {
      const root = set.root();
      const origin = set.origin();
      parts.push(key, String(this.layerVisible(map, set.layerId)), String(root?.id ?? 0),
        `${origin?.longitude ?? 0}:${origin?.latitude ?? 0}:${origin?.elevation ?? 0}`);
      if (root) {
        for (const child of root.children) {
          const mesh = child as THREE.Mesh;
          parts.push(`${child.id}:${child.visible}:${mesh.geometry?.id ?? 0}`);
        }
      }
    }
    parts.push(`buildings:${this.buildings3dVisible(map)}`);
    return parts.join('|');
  }

  private updateTileCasterJobs(map: MaplibreMap) {
    const buildingsVisible = this.buildings3dVisible(map);
    if (this.buildingMesh) {
      this.buildingMesh.visible = buildingsVisible
        && Boolean(this.buildingMesh.geometry.getAttribute('position')?.count);
    }
    if (buildingsVisible) this.startBuildingJob(map);
    else this.buildingJob = undefined;
    const deadline = performance.now() + SHADOW_FRAME_BUDGET_MS;
    while (this.buildingJob && performance.now() < deadline) this.stepBuildingJob();
    if (this.buildingJob) map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer) return;
    if (map.getTerrain() && this.tileDrape) return;
    if (renderer.shadowMap && renderer.shadowMap.type !== THREE.PCFSoftShadowMap) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    const zoom = map.getZoom();
    if (zoom < SHADOW_MIN_ZOOM) {
      this.clearActiveCatcher();
      return;
    }

    this.recenterIfNeeded(map);
    this.updateShadowCatcher();
    if (!this.active || !this.groundMesh?.visible) return;
    this.syncCasterProxies(map);
    this.fitSunCamera(map);

    const opacityBucket = Math.round(zoom * 2) / 2;
    if (this.groundMaterial && opacityBucket !== this.lastOpacityZoomBucket) {
      this.lastOpacityZoomBucket = opacityBucket;
      this.groundMaterial.opacity = this.currentOpacity();
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
    // Three's shadow pass ends by restoring its tracked render target (null),
    // which binds the default framebuffer — not the render target MapLibre
    // bound for this frame. Split the work: phase A fills the shadow map (its
    // color pass only draws colorWrite-off proxies, so nothing visible lands
    // in the wrong buffer), then MapLibre's framebuffer is restored for the
    // drape's color pass, which reuses the completed shadow map.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const mapFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    this.sunlight!.shadow.needsUpdate = true;
    this.groundMesh!.visible = false;
    renderer.render(this.scene, this.camera);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mapFramebuffer);
    renderer.resetState();
    this.groundMesh!.visible = true;
    renderer.render(this.scene, this.camera);
  }

  private clearActiveCatcher() {
    this.groundJob = undefined;
    this.buildingJob = undefined;
    if (this.groundMesh?.visible) this.groundMesh.visible = false;
    if (this.buildingMesh?.visible) this.buildingMesh.visible = false;
    this.setActive(false);
  }

  private recenterIfNeeded(map: MaplibreMap) {
    const center = map.getCenter();
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const centerMercator = maplibregl.MercatorCoordinate.fromLngLat(center);
    const units = originMercator.meterInMercatorCoordinateUnits();
    const drift = Math.hypot(
      (centerMercator.x - originMercator.x) / units,
      (centerMercator.y - originMercator.y) / units,
    );
    // The ground window is capped around this origin. Recenter before the
    // camera can move outside that cap, even when drift is under 2 km.
    const recenterDistance = Math.min(
      CATCHER_RECENTER_DISTANCE_METERS,
      map.getTerrain() && this.tileDrape
        ? terrainShadowHalfSpanMeters(map.getZoom(), map.getPitch()) * 0.3
        : groundHalfSpanCapMeters(map.getZoom()) * 0.5,
    );
    if (drift <= recenterDistance) return;

    const nextOriginElevation = map.queryTerrainElevation(center) ?? 0;
    const nextOrigin = maplibregl.MercatorCoordinate.fromLngLat(center);
    const nextUnits = nextOrigin.meterInMercatorCoordinateUnits();
    const reposition = (
      mesh: THREE.Object3D,
      meshOrigin: maplibregl.LngLat,
      meshOriginElevation: number,
    ) => {
      const previousOrigin = maplibregl.MercatorCoordinate.fromLngLat(meshOrigin);
      const meshUnits = previousOrigin.meterInMercatorCoordinateUnits();
      const horizontalScale = meshUnits / nextUnits;
      mesh.position.set(
        (previousOrigin.x - nextOrigin.x) / nextUnits,
        meshOriginElevation - nextOriginElevation,
        (nextOrigin.y - previousOrigin.y) / nextUnits,
      );
      mesh.scale.set(horizontalScale, 1, horizontalScale);
    };
    if (this.groundBounds && this.groundMesh) {
      reposition(this.groundMesh, this.groundMeshOrigin, this.groundMeshOriginElevation);
    }
    if (this.buildingMesh?.geometry.getAttribute('position')) {
      reposition(this.buildingMesh, this.buildingMeshOrigin, this.buildingMeshOriginElevation);
    }

    this.sceneOrigin = center;
    this.sceneOriginElevation = nextOriginElevation;
    this.groundJob = undefined;
    this.buildingJob = undefined;
    this.groundSignature = '';
    this.buildingSignature = '';
    this.tileDirty = true;
  }

  /** Frame-budget stepping of the ground drape and building caster jobs. */
  updateShadowCatcher(): boolean {
    const map = this.map;
    if (!map || map.getZoom() < SHADOW_MIN_ZOOM) return false;
    if (map.getTerrain() && this.tileDrape) {
      this.groundJob = undefined;
      if (this.groundMesh) this.groundMesh.visible = false;
      this.updateTileCasterJobs(map);
      return Boolean(this.buildingJob);
    }
    // The zoom gate hides the mesh without discarding its completed geometry.
    if (this.groundBounds && this.groundMesh) this.groundMesh.visible = true;
    this.setActive(this.groundCoversCurrentView(map));
    // Both ground and building jobs use stable local windows, so they can
    // continue during a camera gesture.
    const buildings3dVisible = this.buildings3dVisible(map);
    if (this.buildingMesh) {
      this.buildingMesh.visible = buildings3dVisible
        && Boolean(this.buildingMesh.geometry.getAttribute('position')?.count);
    }
    this.startGroundJob(map);
    if (buildings3dVisible && this.active) this.startBuildingJob(map);
    else if (!buildings3dVisible || !this.active) {
      this.buildingJob = undefined;
      if (this.buildingMesh?.visible) this.buildingMesh.visible = false;
    }

    const deadline = performance.now() + SHADOW_FRAME_BUDGET_MS;
    let groundTurn = true;
    while (performance.now() < deadline && (this.groundJob || this.buildingJob)) {
      if (this.groundJob && (groundTurn || !this.buildingJob)) {
        this.stepGroundJob();
      } else if (this.buildingJob) {
        this.stepBuildingJob();
      }
      groundTurn = !groundTurn;
    }
    // Restore decal shadows if the completed mesh no longer covers this view.
    this.setActive(this.groundCoversCurrentView(map));
    if (this.groundJob || this.buildingJob) map.triggerRepaint();
    return Boolean(this.groundJob || this.buildingJob);
  }

  private stepGroundJob() {
    const job = this.groundJob!;
    const result = job.generator.next();
    if (!result.done) return;
    this.groundJob = undefined;
    const jobMs = performance.now() - job.startedAt;
    this.performanceStats.lastGroundJobMs = jobMs;
    if (result.value) {
      this.performanceStats.groundCommits += 1;
      // A commit sampled before the latest DEM content is shown immediately,
      // then resampled on the next render.
      if (job.quality === 'fine' && job.terrainRevision === this.terrainRevision) {
        this.groundSignature = job.signature;
      } else {
        // A coarse commit is usable now, then a fine pass replaces it.
        this.groundSignature = '';
      }
    }
  }

  private stepBuildingJob() {
    const job = this.buildingJob!;
    const result = job.generator.next();
    if (!result.done) return;
    this.buildingJob = undefined;
    const jobMs = performance.now() - job.startedAt;
    this.performanceStats.lastBuildingJobMs = jobMs;
    if (result.value) {
      this.performanceStats.buildingCommits += 1;
      this.buildingMeshView = job.view;
      this.tileDirty = true;
      if (job.quality === 'fine' && job.sourceRevision === this.sourceRevision) {
        this.buildingSignature = job.signature;
      } else {
        // A coarse or stale commit is visible now; refresh it next.
        this.buildingSignature = '';
      }
    }
  }

  private buildings3dVisible(map: MaplibreMap) {
    if (!map.getLayer?.('global-buildings')) return false;
    try {
      return map.getLayoutProperty('global-buildings', 'visibility') !== 'none';
    } catch {
      return false;
    }
  }

  private startGroundJob(map: MaplibreMap) {
    this.terrainZoomBucket = Math.floor(map.getZoom() + 1e-6);
    const fineWindow = this.currentGroundWindow(map);
    const terrainEnabled = Boolean(map.getTerrain?.());
    const signature = `${groundGridSignature(fineWindow, this.terrainZoomBucket, this.terrainRevision)}:${terrainEnabled}`;
    const covered = this.groundCoversCurrentView(map);
    const quality = covered ? 'fine' : 'coarse';
    const window = quality === 'fine' ? fineWindow
      : this.currentGroundWindow(map, COARSE_GROUND_CELL_METERS);
    const windowSignature = `${groundGridSignature(window, this.terrainZoomBucket, 0)}:${terrainEnabled}`;
    if (this.groundJob) {
      // Keep the current job through tile updates. A fine job yields to a
      // coarse one if a fast pan has left the completed mesh behind.
      if (this.groundJob.quality === quality
        && this.groundJob.windowSignature === windowSignature) return;
      this.groundJob = undefined;
    }
    if (covered && signature === this.groundSignature) return;
    this.groundJob = {
      generator: this.buildGroundJob(map, window, terrainEnabled),
      signature,
      windowSignature,
      quality,
      startedAt: performance.now(),
      terrainRevision: this.terrainRevision,
    };
    this.performanceStats.groundJobs += 1;
  }

  private currentGroundWindow(map: MaplibreMap, requestedCell = groundCellSize(map.getZoom())): GroundGridWindow {
    // Keep the lattice fixed in the scene's local frame. Panning inside it
    // does not invalidate the ground job or expose an undraped strip.
    const halfSpan = groundHalfSpanCapMeters(map.getZoom())
      + shadowReachMeters(this.polar) + GROUND_MARGIN_METERS;
    return groundGridWindow({
      minX: -halfSpan,
      minZ: -halfSpan,
      maxX: halfSpan,
      maxZ: halfSpan,
    }, requestedCell);
  }

  private currentViewBounds(map: MaplibreMap, margin: number) {
    const bounds = map.getBounds();
    const frame = this.localFrame();
    const southWest = frame.toLocal(bounds.getWest(), bounds.getSouth());
    const northEast = frame.toLocal(bounds.getEast(), bounds.getNorth());
    const center = frame.toLocal(map.getCenter().lng, map.getCenter().lat);
    // Pitched bounds can extend to the horizon. Only the bounded ground near
    // the camera participates in this pass.
    const halfSpan = groundHalfSpanCapMeters(map.getZoom());
    return {
      minX: Math.max(Math.min(southWest[0], northEast[0]), center[0] - halfSpan) - margin,
      minZ: Math.max(Math.min(southWest[1], northEast[1]), center[1] - halfSpan) - margin,
      maxX: Math.min(Math.max(southWest[0], northEast[0]), center[0] + halfSpan) + margin,
      maxZ: Math.min(Math.max(southWest[1], northEast[1]), center[1] + halfSpan) + margin,
    };
  }

  private groundCoversCurrentView(map: MaplibreMap) {
    const mesh = this.groundMesh;
    const bounds = this.groundBounds;
    if (!mesh || !bounds || !mesh.visible) return false;
    const needed = this.currentViewBounds(map, shadowReachMeters(this.polar));
    const covers = (lower: number, upper: number, meshLower: number, meshUpper: number) =>
      meshLower <= lower && meshUpper >= upper;
    return covers(
      needed.minX,
      needed.maxX,
      mesh.position.x + bounds.minX * mesh.scale.x,
      mesh.position.x + bounds.maxX * mesh.scale.x,
    ) && covers(
      needed.minZ,
      needed.maxZ,
      mesh.position.z + bounds.minZ * mesh.scale.z,
      mesh.position.z + bounds.maxZ * mesh.scale.z,
    );
  }

  /**
   * Reuse DEM samples only at the same geographic point. Quantizing whole
   * grid cells can return a height from a different slope after recentering.
   */
  private cachedTerrainElevation(
    map: MaplibreMap,
    lng: number,
    lat: number,
  ) {
    const key = `${this.terrainRevision}:${this.terrainZoomBucket}:${lng.toFixed(7)}:${lat.toFixed(7)}`;
    const cached = this.elevationCache.get(key);
    if (cached !== undefined) return cached;
    const sampled = map.queryTerrainElevation(new maplibregl.LngLat(lng, lat));
    // Do not cache a fallback: terrain tiles may still be loading.
    if (sampled == null) return 0;
    this.elevationCache.set(key, sampled);
    while (this.elevationCache.size > MAX_ELEVATION_CACHE_ENTRIES) {
      const oldestKey = this.elevationCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.elevationCache.delete(oldestKey);
    }
    return sampled;
  }

  private localFrame() {
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const units = originMercator.meterInMercatorCoordinateUnits();
    return {
      units,
      toLocal(lng: number, lat: number): [number, number] {
        const point = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
        return [(point.x - originMercator.x) / units, (originMercator.y - point.y) / units];
      },
      toLngLat(east: number, north: number) {
        const x = originMercator.x + east * units;
        const y = originMercator.y - north * units;
        return new maplibregl.LngLat(
          (x - 0.5) * 360,
          Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * RADIANS_TO_DEGREES,
        );
      },
    };
  }

  private *buildGroundJob(
    map: MaplibreMap,
    window: GroundGridWindow,
    terrainEnabled: boolean,
  ): Generator<void, boolean, void> {
    const frame = this.localFrame();
    const originElevation = this.sceneOriginElevation;
    const cellsX = window.cellsX;
    const cellsZ = window.cellsZ;
    const vertexCount = (cellsX + 1) * (cellsZ + 1);
    const positions = new Float32Array(vertexCount * 3);
    const extraLift = new Float32Array(vertexCount);
    let index = 0;
    for (let cellZ = 0; cellZ <= cellsZ; cellZ += 1) {
      const north = (window.minCellZ + cellZ) * window.cell;
      for (let cellX = 0; cellX <= cellsX; cellX += 1) {
        if ((cellX & 7) === 0) yield;
        const east = (window.minCellX + cellX) * window.cell;
        const location = frame.toLngLat(east, north);
        const elevation = terrainEnabled
          ? this.cachedTerrainElevation(map, location.lng, location.lat) : 0;
        positions[index] = east;
        positions[index + 1] = elevation - originElevation + GROUND_LIFT_METERS;
        positions[index + 2] = north;
        index += 3;
      }
    }
    const indices = new Uint32Array(cellsX * cellsZ * 6);
    let triangleIndex = 0;
    for (let cellZ = 0; cellZ < cellsZ; cellZ += 1) {
      for (let cellX = 0; cellX < cellsX; cellX += 1) {
        if ((cellX & 7) === 0) yield;
        const topLeft = cellZ * (cellsX + 1) + cellX;
        const bottomLeft = topLeft + cellsX + 1;
        const topRight = topLeft + 1;
        const bottomRight = bottomLeft + 1;
        // The center lies on this cell's diagonal. A sampled ridge between
        // corners would otherwise put the whole shadow triangle under terrain.
        const east = (window.minCellX + cellX + 0.5) * window.cell;
        const north = (window.minCellZ + cellZ + 0.5) * window.cell;
        const location = frame.toLngLat(east, north);
        const centerElevation = terrainEnabled
          ? this.cachedTerrainElevation(map, location.lng, location.lat) : 0;
        const diagonalElevation = (
          positions[bottomLeft * 3 + 1] + positions[topRight * 3 + 1]
        ) * 0.5 + originElevation;
        const lift = Math.max(0, centerElevation + 0.2 - diagonalElevation);
        if (lift > 0) {
          for (const vertex of [topLeft, bottomLeft, topRight, bottomRight]) {
            extraLift[vertex] = Math.max(extraLift[vertex], lift);
          }
        }
        indices[triangleIndex++] = topLeft;
        indices[triangleIndex++] = bottomLeft;
        indices[triangleIndex++] = topRight;
        indices[triangleIndex++] = topRight;
        indices[triangleIndex++] = bottomLeft;
        indices[triangleIndex++] = bottomRight;
      }
    }
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      positions[vertex * 3 + 1] += extraLift[vertex];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    if (!this.groundMesh) return false;
    this.groundMesh.geometry.dispose();
    this.groundMesh.geometry = geometry;
    this.groundMesh.position.set(0, 0, 0);
    this.groundMesh.scale.set(1, 1, 1);
    this.groundMesh.visible = true;
    this.groundBounds = {
      minX: window.minCellX * window.cell,
      minZ: window.minCellZ * window.cell,
      maxX: (window.minCellX + cellsX) * window.cell,
      maxZ: (window.minCellZ + cellsZ) * window.cell,
    };
    this.groundMeshOrigin = this.sceneOrigin;
    this.groundMeshOriginElevation = this.sceneOriginElevation;
    return true;
  }

  private get buildingJobView(): BuildingView {
    const map = this.map!;
    const margin = shadowReachMeters(this.polar);
    const halfSpan = (map.getTerrain() && this.tileDrape
      ? terrainShadowHalfSpanMeters(map.getZoom(), map.getPitch())
      : groundHalfSpanCapMeters(map.getZoom())) + margin;
    const center = this.sceneOrigin;
    const cosLat = Math.max(0.1, Math.cos(center.lat * DEGREES_TO_RADIANS));
    const reachLat = halfSpan / METRES_PER_DEGREE_LAT;
    const reachLng = halfSpan / (METRES_PER_DEGREE_LAT * cosLat);
    return {
      west: center.lng - reachLng,
      east: center.lng + reachLng,
      south: center.lat - reachLat,
      north: center.lat + reachLat,
      zoom: Math.floor(map.getZoom()),
      latitude: Math.round(center.lat * 10) / 10,
    };
  }

  private startBuildingJob(map: MaplibreMap) {
    const view = this.buildingJobView;
    const viewSignature = JSON.stringify(view);
    const signature = `${viewSignature}:${this.sourceRevision}`;
    const covered = this.buildingMeshView && containsBuildingView(this.buildingMeshView, view);
    const quality = covered ? 'fine' : 'coarse';
    if (this.buildingJob) {
      // Complete this window even if vector tiles stream in mid-job.
      if (this.buildingJob.quality === quality
        && this.buildingJob.viewSignature === viewSignature) return;
      this.buildingJob = undefined;
    }
    if (covered && signature === this.buildingSignature) return;
    if (!map.getSource(this.sourceId)) return;
    this.buildingJob = {
      generator: this.buildBuildingCastersJob(map, view, quality),
      signature,
      viewSignature,
      quality,
      startedAt: performance.now(),
      view,
      sourceRevision: this.sourceRevision,
    };
    this.performanceStats.buildingJobs += 1;
  }

  private *buildBuildingCastersJob(
    map: MaplibreMap,
    view: BuildingView,
    quality: 'coarse' | 'fine',
  ): Generator<void, boolean, void> {
    if (!map.getSource(this.sourceId)) return false;
    let features: ReturnType<MaplibreMap['querySourceFeatures']> = [];
    try {
      features = map.querySourceFeatures(this.sourceId, { sourceLayer: 'building' });
    } catch {
      return false;
    }

    const frame = this.localFrame();
    const originElevation = this.sceneOriginElevation;
    const candidates: BuildingCasterCandidate[] = [];
    featureLoop: for (const feature of features) {
      yield;
      if (feature.properties?.hide_3d) continue;
      const sourceId = feature.id ?? feature.properties?.osm_id;
      if (sourceId === NASINNEULA_BUILDING_OUTLINE_ID) continue;
      const renderHeight = Number(feature.properties?.render_height ?? 6);
      const renderMinHeight = Number(feature.properties?.render_min_height ?? 0);
      if (!Number.isFinite(renderHeight) || !Number.isFinite(renderMinHeight)) continue;
      const bodyHeight = Math.max(0, renderHeight - renderMinHeight);
      if (bodyHeight < 1) continue;

      for (const outerRing of featureOuterRings(feature)) {
        yield;
        const ring = stripClosingVertex(outerRing);
        if (ring.length < 4 || ring.length > BUILDING_CASTER_MAX_RING_VERTICES) continue;
        let centroidLng = 0;
        let centroidLat = 0;
        for (const [lng, lat] of ring) {
          centroidLng += lng;
          centroidLat += lat;
        }
        centroidLng /= ring.length;
        centroidLat /= ring.length;
        if (centroidLng < view.west || centroidLng > view.east
          || centroidLat < view.south || centroidLat > view.north) continue;

        const localRing = ring.map(([lng, lat]) => frame.toLocal(lng, lat));
        let twiceArea = 0;
        for (let vertex = 0; vertex < localRing.length; vertex += 1) {
          const [x1, z1] = localRing[vertex];
          const [x2, z2] = localRing[(vertex + 1) % localRing.length];
          twiceArea += x1 * z2 - x2 * z1;
        }
        const area = Math.abs(twiceArea) / 2;
        if (area < 4) continue;
        const groundElevation = this.cachedTerrainElevation(map, centroidLng, centroidLat);
        candidates.push({
          ring: localRing,
          centroidLng,
          centroidLat,
          area,
          baseY: groundElevation + renderMinHeight - originElevation,
          topY: groundElevation + renderHeight - originElevation,
        });
        if (quality === 'coarse' && candidates.length >= COARSE_BUILDING_CASTER_COUNT) {
          break featureLoop;
        }
      }
    }

    const sorted = yield* sortBuildingCandidates(candidates, (first, second) => second.area - first.area);
    const positions: number[] = [];
    const indices: number[] = [];
    let vertices = 0;
    let buildings = 0;
    for (const candidate of sorted) {
      yield;
      if (buildings >= (quality === 'coarse'
        ? COARSE_BUILDING_CASTER_COUNT : BUILDING_CASTER_MAX_COUNT)) break;
      if (vertices + candidate.ring.length * 2 > BUILDING_CASTER_MAX_VERTICES) break;
      const triangles = triangulateRing(candidate.ring);
      if (!triangles) continue;
      vertices += appendBuildingCaster(positions, indices, candidate.ring, triangles, candidate.baseY, candidate.topY);
      buildings += 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(new THREE.BufferAttribute(
      vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1,
    ));
    if (!this.buildingMesh) {
      geometry.dispose();
      return false;
    }
    this.buildingMesh.geometry.dispose();
    this.buildingMesh.geometry = geometry;
    this.buildingMesh.position.set(0, 0, 0);
    this.buildingMesh.scale.set(1, 1, 1);
    this.buildingMesh.visible = buildings > 0;
    this.buildingMeshOrigin = this.sceneOrigin;
    this.buildingMeshOriginElevation = this.sceneOriginElevation;
    return true;
  }

  private isEffectivelyVisible(object: THREE.Object3D) {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  }

  private layerVisible(map: MaplibreMap, layerId?: string) {
    if (!layerId) return true;
    if (!map.getLayer?.(layerId)) return false;
    try {
      return map.getLayoutProperty(layerId, 'visibility') !== 'none';
    } catch {
      return false;
    }
  }

  private syncCasterProxies(map: MaplibreMap) {
    const catcherOrigin = maplibregl.MercatorCoordinate.fromLngLat(
      this.sceneOrigin,
      this.sceneOriginElevation,
    );
    const units = catcherOrigin.meterInMercatorCoordinateUnits();
    for (const entry of this.casters.values()) {
      const root = entry.set.root();
      const origin = entry.set.origin();
      if (!root || !origin || !this.layerVisible(map, entry.set.layerId)) {
        for (const proxy of entry.proxies.values()) proxy.visible = false;
        continue;
      }
      const originMercator = maplibregl.MercatorCoordinate.fromLngLat(
        new maplibregl.LngLat(origin.longitude, origin.latitude),
      );
      entry.host.position.set(
        (originMercator.x - catcherOrigin.x) / units,
        origin.elevation - this.sceneOriginElevation,
        (catcherOrigin.y - originMercator.y) / units,
      );
      root.updateMatrixWorld(true);
      this.sceneInverse.copy(root.matrixWorld).invert();
      const seen = new Set<THREE.Object3D>();
      root.traverse((object) => {
        const instanced = object as THREE.InstancedMesh;
        if (!instanced.isMesh && !instanced.isInstancedMesh) return;
        const material = instanced.material as THREE.Material;
        if (Array.isArray(material)) return;
        // Blob decals (depthWrite false) stay out of the shadow pass.
        if (material.depthWrite === false) return;
        seen.add(object);
        const proxy = entry.proxies.get(object) ?? this.createProxy(entry, object);
        proxy.matrix.copy(this.sceneInverse).multiply(object.matrixWorld);
        const visible = this.isEffectivelyVisible(object);
        if (instanced.isInstancedMesh) {
          const instancedProxy = proxy as THREE.InstancedMesh;
          instancedProxy.instanceMatrix = instanced.instanceMatrix;
          instancedProxy.count = instanced.count;
          instancedProxy.geometry = instanced.geometry;
          proxy.visible = visible && instanced.count > 0;
        } else {
          (proxy as THREE.Mesh).geometry = (object as THREE.Mesh).geometry;
          proxy.visible = visible;
        }
      });
      for (const [source, proxy] of entry.proxies) {
        if (seen.has(source)) continue;
        entry.proxies.delete(source);
        entry.host.remove(proxy);
      }
    }
  }

  private createProxy(entry: CasterEntry, source: THREE.Object3D): THREE.Mesh | THREE.InstancedMesh {
    let proxy: THREE.Mesh | THREE.InstancedMesh;
    const instanced = source as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      proxy = new THREE.InstancedMesh(
        instanced.geometry,
        this.casterMaterial,
        Math.max(1, instanced.instanceMatrix.count),
      );
    } else {
      proxy = new THREE.Mesh((source as THREE.Mesh).geometry, this.casterMaterial);
    }
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.frustumCulled = false;
    proxy.matrixAutoUpdate = false;
    entry.host.add(proxy);
    entry.proxies.set(source, proxy);
    return proxy;
  }

  private fitSunCameraForTiles(map: MaplibreMap) {
    const light = this.sunlight;
    if (!light) return;
    const half = terrainShadowHalfSpanMeters(map.getZoom(), map.getPitch())
      + shadowReachMeters(this.polar) + GROUND_MARGIN_METERS;
    const polar = Math.min(this.polar, 90 - MIN_SUN_ELEVATION_DEGREES);
    const direction = sunCartesian(this.azimuth, polar, 1);
    const distance = half * 2 + 300;
    light.position.set(direction.x * distance, direction.y * distance, direction.z * distance);
    this.sunTarget.position.set(0, 0, 0);
    const shadowCamera = light.shadow.camera;
    const extent = half * 1.45 + 150;
    shadowCamera.left = -extent;
    shadowCamera.right = extent;
    shadowCamera.top = extent;
    shadowCamera.bottom = -extent;
    shadowCamera.near = 1;
    shadowCamera.far = distance * 2 + 600;
    shadowCamera.updateProjectionMatrix();
  }

  private fitSunCamera(map: MaplibreMap) {
    const light = this.sunlight;
    if (!light || !this.groundBounds) return;
    // Concentrate the 2048px shadow map on the visible ground and caster
    // reach, rather than spreading it over the entire pan buffer.
    const bounds = this.currentViewBounds(map, shadowReachMeters(this.polar));
    const centerEast = (bounds.minX + bounds.maxX) * 0.5;
    const centerNorth = (bounds.minZ + bounds.maxZ) * 0.5;
    const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.5;
    // Clamp like the paint shadow translates so horizon-grazing sun cannot
    // smear shadows across the entire drape.
    const polar = Math.min(this.polar, 90 - MIN_SUN_ELEVATION_DEGREES);
    const direction = sunCartesian(this.azimuth, polar, 1);
    const distance = half * 2 + 300;
    light.position.set(
      centerEast + direction.x * distance,
      direction.y * distance,
      centerNorth + direction.z * distance,
    );
    this.sunTarget.position.set(centerEast, 0, centerNorth);
    const shadowCamera = light.shadow.camera;
    const extent = half * 1.15 + 30;
    shadowCamera.left = -extent;
    shadowCamera.right = extent;
    shadowCamera.top = extent;
    shadowCamera.bottom = -extent;
    shadowCamera.near = 1;
    shadowCamera.far = distance * 2 + 600;
    shadowCamera.updateProjectionMatrix();
  }
}

function* featureOuterRings(
  feature: ReturnType<MaplibreMap['querySourceFeatures']>[number],
): Generator<Array<[number, number]>> {
  const geometry = feature.geometry;
  if (!geometry) return;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const polygon of polygons) {
    if (polygon?.[0]) yield polygon[0] as Array<[number, number]>;
  }
}
