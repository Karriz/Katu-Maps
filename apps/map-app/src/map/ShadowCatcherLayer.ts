import * as maplibregl from 'maplibre-gl';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
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
  buildingView,
  containsBuildingView,
  sortBuildingCandidates,
  type BuildingView,
} from './BuildingModelWork';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';

/**
 * Phase 1-3 of the shadows plan: one Three.js custom layer that owns a
 * terrain-draped ground mesh rendered with THREE.ShadowMaterial, plus a single
 * shadow-casting directional light. The other Three.js model layers register
 * their scenes as casters; this layer mirrors their meshes with depth-only
 * proxies so a single shadow pass covers trees, bridges, facades, roofs,
 * vehicles, and projected building footprints.
 *
 * The cartoon look is preserved: shadows use the shared CARTOON shadow colors
 * and the treeShadowOpacity fade, and the sun follows the day/night solar
 * model instead of a fixed azimuth.
 */

export const SHADOW_CATCHER_LAYER_ID = 'ground-shadow-catcher-3d';

const SHADOW_MIN_ZOOM = 13;
const SHADOW_FRAME_BUDGET_MS = 4;
const MAX_GRID_CELLS_PER_AXIS = 160;
/** Keeps the drape above the rendered terrain between grid samples. */
const GROUND_LIFT_METERS = 0.3;
const GROUND_MARGIN_METERS = 60;
const SHADOW_MAP_SIZE = 2048;
const CATCHER_RECENTER_DISTANCE_METERS = 2000;
/** Matches the elevation clamp of buildingShadowTranslate in DayNightAppearance. */
const MIN_SUN_ELEVATION_DEGREES = 8;
const BUILDING_CASTER_MAX_COUNT = 2400;
const BUILDING_CASTER_MAX_VERTICES = 160_000;
const BUILDING_CASTER_MAX_RING_VERTICES = 64;
const BUILDING_ELEVATION_CELL_METERS = 12;
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

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
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
    startedAt: number;
    terrainRevision: number;
  };
  private groundSignature = '';
  private groundBounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  private completedBuildingView?: BuildingView;
  private buildingJob?: {
    generator: Generator<void, boolean, void>;
    signature: string;
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
  /** World-anchored DEM samples; rebuilds after a pan only sample new cells. */
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
    this.map?.triggerRepaint();
  }

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    this.applyShadowColors();
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
    this.map?.triggerRepaint();
  }

  /** Vector tiles changed; building footprint casters resample. */
  invalidateSource() {
    this.sourceRevision += 1;
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
    this.sunlight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.applyShadowColors();
  }

  onRemove() {
    this.groundJob = undefined;
    this.buildingJob = undefined;
    this.setActive(false);
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

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer) return;

    const zoom = map.getZoom();
    if (zoom < SHADOW_MIN_ZOOM) {
      this.clearActiveCatcher();
      return;
    }

    this.recenterIfNeeded(map);
    this.updateShadowCatcher();
    if (!this.active || !this.groundMesh?.visible) return;
    this.syncCasterProxies(map);
    this.fitSunCamera();

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
    if (drift <= CATCHER_RECENTER_DISTANCE_METERS) return;

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
    if (this.groundMesh?.visible) {
      reposition(this.groundMesh, this.groundMeshOrigin, this.groundMeshOriginElevation);
    }
    if (this.buildingMesh?.visible) {
      reposition(this.buildingMesh, this.buildingMeshOrigin, this.buildingMeshOriginElevation);
    }

    this.sceneOrigin = center;
    this.sceneOriginElevation = nextOriginElevation;
    this.groundJob = undefined;
    this.buildingJob = undefined;
    this.groundSignature = '';
    this.buildingSignature = '';
    this.completedBuildingView = undefined;
  }

  /** Frame-budget stepping of the ground drape and building caster jobs. */
  updateShadowCatcher(): boolean {
    const map = this.map;
    if (!map || map.getZoom() < SHADOW_MIN_ZOOM) return false;
    // Keep the last complete meshes during gestures; idle resumes generation.
    const allowJobs = this.flightMode || !map.isMoving?.();
    const buildings3dVisible = this.buildings3dVisible(map);
    if (allowJobs) {
      this.startGroundJob(map);
      // The drape pre-populates the elevation lattice that building bases
      // reuse; waiting for the first commit keeps the building job off the
      // slow DEM query path while tiles stream.
      if (buildings3dVisible && this.active) this.startBuildingJob(map);
      else {
        this.buildingJob = undefined;
        if (this.buildingMesh?.visible) this.buildingMesh.visible = false;
      }
    } else {
      this.groundJob = undefined;
      this.buildingJob = undefined;
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
      this.setActive(true);
      // A commit sampled before the latest DEM content is shown immediately,
      // then resampled on the next render.
      if (job.terrainRevision === this.terrainRevision) {
        this.groundSignature = job.signature;
      } else {
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
      if (job.sourceRevision === this.sourceRevision) {
        this.buildingSignature = job.signature;
        this.completedBuildingView = job.view;
      } else {
        // Features streamed in mid-job: show this mesh now, resample next.
        this.buildingSignature = '';
        this.completedBuildingView = undefined;
      }
    } else {
      this.completedBuildingView = undefined;
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
    const window = this.currentGroundWindow(map);
    const signature = groundGridSignature(
      window,
      this.terrainZoomBucket,
      this.terrainRevision,
    );
    if (this.groundJob) {
      if (this.groundJob.signature === signature) return;
      this.groundJob = undefined;
    }
    if (signature === this.groundSignature) return;
    this.groundJob = {
      generator: this.buildGroundJob(map, window),
      signature,
      startedAt: performance.now(),
      terrainRevision: this.terrainRevision,
    };
    this.performanceStats.groundJobs += 1;
  }

  private currentGroundWindow(map: MaplibreMap): GroundGridWindow {
    const bounds = map.getBounds();
    const frame = this.localFrame();
    const southWest = frame.toLocal(bounds.getWest(), bounds.getSouth());
    const northEast = frame.toLocal(bounds.getEast(), bounds.getNorth());
    const margin = shadowReachMeters(this.polar) + GROUND_MARGIN_METERS;
    const halfSpan = groundHalfSpanCapMeters(map.getZoom()) + margin;
    return groundGridWindow({
      minX: Math.max(Math.min(southWest[0], northEast[0]) - margin, -halfSpan),
      minZ: Math.max(Math.min(southWest[1], northEast[1]) - margin, -halfSpan),
      maxX: Math.min(Math.max(southWest[0], northEast[0]) + margin, halfSpan),
      maxZ: Math.min(Math.max(southWest[1], northEast[1]) + margin, halfSpan),
    }, groundCellSize(map.getZoom()));
  }

  /**
   * DEM sampling is the expensive part of both jobs. Samples are cached on a
   * world-anchored grid so panning rebuilds only touch new cells; the cache is
   * cleared when DEM content changes so stale heights never survive a refresh.
   */
  private cachedTerrainElevation(
    map: MaplibreMap,
    lng: number,
    lat: number,
    cell: number,
  ) {
    const cellX = Math.floor(lng * METRES_PER_DEGREE_LAT * Math.cos(lat * DEGREES_TO_RADIANS) / cell);
    const cellZ = Math.floor(lat * METRES_PER_DEGREE_LAT / cell);
    const key = `${this.terrainRevision}:${this.terrainZoomBucket}:${cellX}:${cellZ}`;
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

  /**
   * Bilinear elevation over the world-anchored drape cell lattice. The ground
   * drape pre-populates these samples, so building bases usually cost no DEM
   * queries at all; callers fall back to a direct sample when cells are cold.
   */
  private drapeLatticeElevation(map: MaplibreMap, lng: number, lat: number): number | undefined {
    const cell = groundCellSize(map.getZoom());
    const cosLat = Math.max(0.1, Math.cos(lat * DEGREES_TO_RADIANS));
    const x = lng * METRES_PER_DEGREE_LAT * cosLat / cell;
    const z = lat * METRES_PER_DEGREE_LAT / cell;
    const cellX = Math.floor(x);
    const cellZ = Math.floor(z);
    const fractionX = x - cellX;
    const fractionZ = z - cellZ;
    const corners: number[] = [];
    for (let cornerZ = 0; cornerZ <= 1; cornerZ += 1) {
      for (let cornerX = 0; cornerX <= 1; cornerX += 1) {
        const value = this.elevationCache.get(
          `${this.terrainRevision}:${this.terrainZoomBucket}:${cellX + cornerX}:${cellZ + cornerZ}`,
        );
        if (value === undefined) return undefined;
        corners.push(value);
      }
    }
    const north = corners[0] * (1 - fractionX) + corners[1] * fractionX;
    const south = corners[2] * (1 - fractionX) + corners[3] * fractionX;
    return north * (1 - fractionZ) + south * fractionZ;
  }

  private *buildGroundJob(map: MaplibreMap, window: GroundGridWindow): Generator<void, boolean, void> {
    const frame = this.localFrame();
    const originElevation = this.sceneOriginElevation;
    const cellsX = window.cellsX;
    const cellsZ = window.cellsZ;
    const positions = new Float32Array((cellsX + 1) * (cellsZ + 1) * 3);
    let index = 0;
    for (let cellZ = 0; cellZ <= cellsZ; cellZ += 1) {
      yield;
      const north = (window.minCellZ + cellZ) * window.cell;
      for (let cellX = 0; cellX <= cellsX; cellX += 1) {
        const east = (window.minCellX + cellX) * window.cell;
        const location = frame.toLngLat(east, north);
        const elevation = this.cachedTerrainElevation(
          map,
          location.lng,
          location.lat,
          window.cell,
        );
        positions[index] = east;
        positions[index + 1] = elevation - originElevation + GROUND_LIFT_METERS;
        positions[index + 2] = north;
        index += 3;
      }
    }
    const indices = new Uint32Array(cellsX * cellsZ * 6);
    let triangleIndex = 0;
    for (let cellZ = 0; cellZ < cellsZ; cellZ += 1) {
      yield;
      for (let cellX = 0; cellX < cellsX; cellX += 1) {
        const topLeft = cellZ * (cellsX + 1) + cellX;
        const bottomLeft = topLeft + cellsX + 1;
        indices[triangleIndex++] = topLeft;
        indices[triangleIndex++] = bottomLeft;
        indices[triangleIndex++] = topLeft + 1;
        indices[triangleIndex++] = topLeft + 1;
        indices[triangleIndex++] = bottomLeft;
        indices[triangleIndex++] = bottomLeft + 1;
      }
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
    const view = buildingView(map, 0.15);
    const margin = shadowReachMeters(this.polar);
    // Pitched bounds reach the horizon; casters only matter near the camera and
    // DEM sampling dominates the job cost, so clamp the sampling window.
    const halfSpan = groundHalfSpanCapMeters(view.zoom) + margin;
    const center = map.getCenter();
    const cosLat = Math.max(0.1, Math.cos(center.lat * DEGREES_TO_RADIANS));
    const reachLat = halfSpan / METRES_PER_DEGREE_LAT;
    const reachLng = halfSpan / (METRES_PER_DEGREE_LAT * cosLat);
    return {
      ...view,
      west: Math.max(view.west, center.lng - reachLng),
      east: Math.min(view.east, center.lng + reachLng),
      south: Math.max(view.south, center.lat - reachLat),
      north: Math.min(view.north, center.lat + reachLat),
    };
  }

  private startBuildingJob(map: MaplibreMap) {
    const view = this.buildingJobView;
    const signature = JSON.stringify([view, this.sourceRevision]);
    if (this.buildingJob) {
      if (this.buildingJob.signature === signature) return;
      this.buildingJob = undefined;
    }
    if (this.completedBuildingView && containsBuildingView(this.completedBuildingView, view)) return;
    if (signature === this.buildingSignature) return;
    if (!map.getSource(this.sourceId)) return;
    this.buildingJob = {
      generator: this.buildBuildingCastersJob(map, view),
      signature,
      startedAt: performance.now(),
      view,
      sourceRevision: this.sourceRevision,
    };
    this.performanceStats.buildingJobs += 1;
  }

  private *buildBuildingCastersJob(map: MaplibreMap, view: BuildingView): Generator<void, boolean, void> {
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
    for (const feature of features) {
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
        const groundElevation = this.drapeLatticeElevation(map, centroidLng, centroidLat)
          ?? this.cachedTerrainElevation(
            map,
            centroidLng,
            centroidLat,
            BUILDING_ELEVATION_CELL_METERS,
          );
        candidates.push({
          ring: localRing,
          centroidLng,
          centroidLat,
          area,
          baseY: groundElevation + renderMinHeight - originElevation,
          topY: groundElevation + renderHeight - originElevation,
        });
      }
    }

    const sorted = yield* sortBuildingCandidates(candidates, (first, second) => second.area - first.area);
    const positions: number[] = [];
    const indices: number[] = [];
    let vertices = 0;
    let buildings = 0;
    for (const candidate of sorted) {
      yield;
      if (buildings >= BUILDING_CASTER_MAX_COUNT) break;
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

  private fitSunCamera() {
    const light = this.sunlight;
    if (!light || !this.groundBounds) return;
    const bounds = this.groundBounds;
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
    const extent = half * 1.35 + 50;
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
