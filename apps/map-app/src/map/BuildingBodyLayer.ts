import * as maplibregl from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MaplibreMap } from 'maplibre-gl';
import * as THREE from 'three';
import { buildingView, containsBuildingView, type BuildingView } from './BuildingModelWork';
import { createBuildingEnvironmentMap, createBuildingNormalMap } from './BuildingMaterials';
import {
  CARTOON_AMBIENT_BASE_INTENSITY,
  CARTOON_AMBIENT_DAY_INTENSITY,
  CARTOON_AMBIENT_GROUND_COLOR,
  CARTOON_AMBIENT_SKY_COLOR,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_BASE_INTENSITY,
  CARTOON_SUN_COLOR,
  CARTOON_SUN_DAY_INTENSITY,
  CARTOON_SUN_POLAR_DEGREES,
  sunCartesian,
} from './CartoonLighting';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';

export const BUILDING_BODY_LAYER_ID = 'building-bodies-3d';
export const BUILDING_BODY_ENTER_ZOOM = 13;
export const BUILDING_BODY_EXIT_ZOOM = 12.75;

const FRAME_BUDGET_MS = 4;
const MAX_BUILDINGS = 8000;
const MAX_CACHED_PARTS = 10000;
const MAX_VERTICES = 300_000;
const MAX_RING_VERTICES = 96;
const LIGHT_COLOR = new THREE.Color('#fffdf8');
const DARK_COLOR = new THREE.Color('#293f53');

type PolygonRings = Array<Array<[number, number]>>;
type CachedBuildingPart = {
  rings: PolygonRings;
  longitude: number;
  latitude: number;
  height: number;
  minHeight: number;
  colour?: string;
};

export function closeBuildingZoom(zoom: number, active: boolean) {
  return zoom >= (active ? BUILDING_BODY_EXIT_ZOOM : BUILDING_BODY_ENTER_ZOOM);
}

export function buildingBodyLocalPoint(
  longitude: number, latitude: number,
  origin: maplibregl.MercatorCoordinate, units: number,
): [number, number] {
  const point = maplibregl.MercatorCoordinate.fromLngLat([longitude, latitude]);
  // All existing Three.js map layers use positive local z toward north.
  return [(point.x - origin.x) / units, (origin.y - point.y) / units];
}

/** A square ground window around the camera survives a bearing change. */
export function rotationStableBuildingView(map: MaplibreMap): BuildingView {
  const view = buildingView(map, 1);
  const center = map.getCenter();
  const longitudeScale = Math.max(0.1, Math.cos(center.lat * Math.PI / 180));
  const radius = Math.max(
    Math.abs(view.west - center.lng) * longitudeScale,
    Math.abs(view.east - center.lng) * longitudeScale,
    Math.abs(view.south - center.lat),
    Math.abs(view.north - center.lat),
  );
  return {
    ...view,
    west: center.lng - radius / longitudeScale,
    east: center.lng + radius / longitudeScale,
    south: center.lat - radius,
    north: center.lat + radius,
  };
}

function polygonParts(geometry: { type: string; coordinates: unknown }): PolygonRings[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates as PolygonRings];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as PolygonRings[];
  return [];
}

function signedArea(ring: Array<[number, number]>) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

type BuildingBuffers = {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
};

function vertex(
  buffers: BuildingBuffers,
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  color: THREE.Color,
  u: number, v: number,
) {
  buffers.positions.push(x, y, z);
  buffers.normals.push(nx, ny, nz);
  buffers.colors.push(color.r, color.g, color.b);
  buffers.uvs.push(u, v);
}

/** A complete roof cap and outward-facing walls; holes remain open. */
export function appendBuildingBody(
  buffers: BuildingBuffers,
  rings: PolygonRings,
  base: number,
  top: number,
  wallColor: THREE.Color,
) {
  const valid = rings.map((ring) => {
    const trimmed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0]
      && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    return trimmed;
  }).filter((ring) => ring.length >= 3 && ring.length <= MAX_RING_VERTICES);
  if (!valid.length || top <= base) return 0;
  const contour = valid[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = valid.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const points = [...contour, ...holes.flat()];
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  if (!triangles.length) return 0;
  const before = buffers.positions.length / 3;
  const roofColor = wallColor.clone().lerp(LIGHT_COLOR, 0.08);
  const groundColor = wallColor.clone().multiplyScalar(0.72);
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map((index) => points[index]);
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (const point of (cross > 0 ? [a, c, b] : [a, b, c])) {
      vertex(buffers, point.x, top, point.y, 0, 1, 0, roofColor, point.x / 8, point.y / 8);
    }
  }
  for (let ringIndex = 0; ringIndex < valid.length; ringIndex += 1) {
    const ring = valid[ringIndex];
    const outwardSign = Math.sign(signedArea(ring)) * (ringIndex === 0 ? 1 : -1);
    let distance = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const nx = outwardSign * dz / length;
      const nz = -outwardSign * dx / length;
      const corners = [
        [a[0], base, a[1], distance / 8, base / 8, groundColor],
        [b[0], base, b[1], (distance + length) / 8, base / 8, groundColor],
        [b[0], top, b[1], (distance + length) / 8, top / 8, wallColor],
        [a[0], top, a[1], distance / 8, top / 8, wallColor],
      ] as const;
      // Winding is chosen for the outward normal in x/east, z/north space.
      const order = outwardSign > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const corner of order) {
        const [x, y, z, u, v, color] = corners[corner];
        vertex(buffers, x, y, z, nx, 0, nz, color, u, v);
      }
      distance += length;
    }
  }
  return buffers.positions.length / 3 - before;
}

function geometryFromBuffers(buffers: BuildingBuffers) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  return geometry;
}

export class BuildingBodyLayer implements CustomLayerInterface {
  readonly id = BUILDING_BODY_LAYER_ID;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly normalMap = createBuildingNormalMap();
  private readonly environmentMap = createBuildingEnvironmentMap();
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0,
    normalMap: this.normalMap, normalScale: new THREE.Vector2(0.12, 0.12),
    envMap: this.environmentMap, envMapIntensity: 0.15,
  });
  private readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  private readonly ambient = new THREE.HemisphereLight(CARTOON_AMBIENT_SKY_COLOR, CARTOON_AMBIENT_GROUND_COLOR);
  private readonly sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR);
  private readonly sunTarget = new THREE.Object3D();
  private sunAzimuth = CARTOON_SUN_AZIMUTH_DEGREES;
  private sunPolar = CARTOON_SUN_POLAR_DEGREES;
  private shadowMapDirty = true;
  private shadowMapSize = 0;
  private origin = new maplibregl.LngLat(23.7609, 61.4981);
  private originElevation = 0;
  private readyView?: BuildingView;
  private readonly cachedParts = new Map<string, CachedBuildingPart>();
  private job?: Generator<void, void, void>;
  private jobTimer?: ReturnType<typeof setTimeout>;
  private sourceRevision = 0;
  private builtRevision = -1;
  private processedFeatures = 0;
  private totalFeatures = 0;
  private enabled = true;
  private active = false;
  private activeChanged?: (active: boolean) => void;
  private dark = false;
  private nightMix = 0;
  private paletteColor?: string;
  private buildingColorsEnabled = true;

  constructor(private readonly sourceId = OPENFREEMAP_SOURCE_ID) {
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.sunlight.castShadow = true;
    this.sunlight.shadow.autoUpdate = false;
    this.sunlight.shadow.bias = -0.00015;
    this.sunlight.shadow.normalBias = 0.12;
    this.sunlight.shadow.radius = 2;
    this.sunlight.target = this.sunTarget;
    this.scene.add(this.mesh, this.ambient, this.sunlight, this.sunTarget);
    this.setDayNightLighting(null);
  }

  shadowCasterScene() { return this.renderer && this.active ? this.scene : undefined; }
  shadowCasterOrigin() {
    return { longitude: this.origin.lng, latitude: this.origin.lat, elevation: this.originElevation };
  }
  isActive() { return this.active; }
  getDebugState() {
    return { active: this.active, enabled: this.enabled, readyView: this.readyView,
      job: Boolean(this.job), sourceRevision: this.sourceRevision, builtRevision: this.builtRevision,
      vertices: this.mesh.geometry.getAttribute('position')?.count ?? 0,
      zoom: this.map?.getZoom(), sourceId: this.sourceId,
      sourceLoaded: this.map?.isSourceLoaded(this.sourceId),
      processedFeatures: this.processedFeatures, totalFeatures: this.totalFeatures,
      cachedParts: this.cachedParts.size, shadowMapReady: Boolean(this.sunlight.shadow.map),
      shadowMapSize: this.shadowMapSize };
  }
  setActiveChangeHandler(handler: (active: boolean) => void) { this.activeChanged = handler; }
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.cancelJob();
      this.setActive(false);
    }
    this.map?.triggerRepaint();
  }
  setTheme(dark: boolean) {
    if (this.dark === dark) return;
    this.dark = dark;
    if (!this.paletteColor) this.invalidateSource();
  }
  setBuildingColorsEnabled(enabled: boolean) {
    if (this.buildingColorsEnabled === enabled) return;
    this.buildingColorsEnabled = enabled;
    this.invalidateSource();
  }
  setDayNightLighting(lighting: { azimuth: number; polar: number; nightMix: number; palette?: { building: string } } | null) {
    const nextPalette = lighting?.palette?.building;
    if (nextPalette !== this.paletteColor) {
      this.paletteColor = nextPalette;
      this.invalidateSource();
    }
    this.nightMix = lighting?.nightMix ?? 0;
    const nextAzimuth = lighting?.azimuth ?? CARTOON_SUN_AZIMUTH_DEGREES;
    const nextPolar = lighting?.polar ?? CARTOON_SUN_POLAR_DEGREES;
    if (Math.abs(nextAzimuth - this.sunAzimuth) > 0.25
      || Math.abs(nextPolar - this.sunPolar) > 0.25) this.shadowMapDirty = true;
    this.sunAzimuth = nextAzimuth;
    this.sunPolar = nextPolar;
    this.sunlight.intensity = CARTOON_SUN_BASE_INTENSITY + (1 - this.nightMix) * CARTOON_SUN_DAY_INTENSITY;
    this.ambient.intensity = CARTOON_AMBIENT_BASE_INTENSITY + (1 - this.nightMix) * CARTOON_AMBIENT_DAY_INTENSITY;
    this.map?.triggerRepaint();
  }
  invalidateSource() {
    this.sourceRevision += 1;
    // Let the current bounded job finish; a burst of tile events should not
    // repeatedly discard work while the camera is moving.
    this.map?.triggerRepaint();
  }
  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    queueMicrotask(() => { if (this.active === active) this.activeChanged?.(active); });
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  onRemove() {
    this.setActive(false);
    this.activeChanged = undefined;
    this.cancelJob();
    this.cachedParts.clear();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.normalMap.dispose();
    this.environmentMap.dispose();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.renderer) return;
    if (!this.enabled || !closeBuildingZoom(map.getZoom(), this.active)) {
      this.cancelJob();
      this.setActive(false);
      return;
    }
    const view = buildingView(map);
    const covered = this.readyView && containsBuildingView(this.readyView, view);
    if ((!covered || this.builtRevision !== this.sourceRevision) && !this.job && map.getSource(this.sourceId)) {
      this.job = this.build(map, rotationStableBuildingView(map), this.sourceRevision);
      this.scheduleJob();
    }
    // Keep geographically anchored geometry visible as the map rotates or new
    // source tiles arrive. The flat footprint style covers yet-unloaded areas.
    const ready = (this.mesh.geometry.getAttribute('position')?.count ?? 0) > 0;
    this.setActive(ready);
    if (!ready) return;
    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.origin, this.originElevation);
    const transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
      .scale(new THREE.Vector3(origin.meterInMercatorCoordinateUnits(),
        -origin.meterInMercatorCoordinateUnits(), origin.meterInMercatorCoordinateUnits()));
    this.camera.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(transform);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.configureShadowCamera(map.getZoom());
    if (this.shadowMapDirty) {
      // Three restores its own framebuffer after the depth pass. Save the
      // framebuffer MapLibre selected, then draw building color into it.
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      this.material.colorWrite = false;
      this.sunlight.shadow.needsUpdate = true;
      try {
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.shadowMapDirty = false;
      } finally {
        this.material.colorWrite = true;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      }
    }
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  private configureShadowCamera(zoom: number) {
    const bounds = this.mesh.geometry.boundingBox;
    if (!bounds) return;
    const size = zoom >= 16 ? 1024 : 512;
    if (size !== this.shadowMapSize) {
      this.shadowMapSize = size;
      this.sunlight.shadow.mapSize.set(size, size);
      this.sunlight.shadow.map?.setSize(size, size);
      this.shadowMapDirty = true;
    }
    if (!this.shadowMapDirty) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.5;
    const height = Math.max(1, bounds.max.y - bounds.min.y);
    const halfSpan = extent + height * 1.5 + 30;
    const distance = halfSpan * 2 + height + 100;
    const sun = sunCartesian(this.sunAzimuth, Math.min(this.sunPolar, 82), distance);
    this.sunTarget.position.copy(center);
    this.sunlight.position.set(center.x + sun.x, center.y + sun.y, center.z + sun.z);
    const camera = this.sunlight.shadow.camera;
    camera.left = -halfSpan;
    camera.right = halfSpan;
    camera.top = halfSpan;
    camera.bottom = -halfSpan;
    camera.near = 1;
    camera.far = distance * 2 + height + 100;
    camera.updateProjectionMatrix();
  }

  private cancelJob() {
    this.job = undefined;
    if (this.jobTimer) clearTimeout(this.jobTimer);
    this.jobTimer = undefined;
  }

  private scheduleJob() {
    if (this.jobTimer || !this.job) return;
    // Build independently of MapLibre frames. A heavy terrain frame must not
    // strand a partially completed building view behind the flat footprints.
    this.jobTimer = setTimeout(() => {
      this.jobTimer = undefined;
      const deadline = performance.now() + FRAME_BUDGET_MS;
      while (this.job && performance.now() < deadline) {
        try {
          if (this.job.next().done) this.job = undefined;
        } catch (error) {
          console.warn('Three.js buildings could not be built.', error);
          this.job = undefined;
        }
      }
      if (this.job) this.scheduleJob();
    }, 0);
  }

  private *build(map: MaplibreMap, view: BuildingView, revision: number): Generator<void, void, void> {
    let features: ReturnType<MaplibreMap['querySourceFeatures']>;
    try { features = map.querySourceFeatures(this.sourceId, { sourceLayer: 'building' }); }
    catch { return; }
    this.totalFeatures = features.length;
    this.processedFeatures = 0;
    for (const feature of features) {
      this.processedFeatures += 1;
      if (this.processedFeatures % 32 === 0) yield;
      if (feature.properties?.hide_3d || feature.id === 6_807_253_782) continue;
      const height = Number(feature.properties?.render_height ?? 6);
      const minHeight = Number(feature.properties?.render_min_height ?? 0);
      if (!Number.isFinite(height) || !Number.isFinite(minHeight) || height - minHeight < 1) continue;
      for (const part of polygonParts(feature.geometry as { type: string; coordinates: unknown })) {
        if (part.length === 0 || part[0].length > MAX_RING_VERTICES) continue;
        const outer = part[0];
        const longitude = outer.reduce((sum, point) => sum + point[0], 0) / outer.length;
        const latitude = outer.reduce((sum, point) => sum + point[1], 0) / outer.length;
        if (longitude < view.west || longitude > view.east || latitude < view.south || latitude > view.north) continue;
        const key = `${feature.id ?? ''}:${longitude.toFixed(6)}:${latitude.toFixed(6)}`;
        this.cachedParts.set(key, {
          rings: part, longitude, latitude, height, minHeight,
          colour: typeof feature.properties?.colour === 'string' ? feature.properties.colour : undefined,
        });
      }
    }
    // Retain adjacent tiles across bearing changes, but release geometry after
    // a real pan and bound memory even when a city has very dense footprints.
    for (const [key, part] of this.cachedParts) {
      if (part.longitude < view.west || part.longitude > view.east
        || part.latitude < view.south || part.latitude > view.north) this.cachedParts.delete(key);
    }
    const center = map.getCenter();
    const origin = maplibregl.MercatorCoordinate.fromLngLat(center);
    const units = origin.meterInMercatorCoordinateUnits();
    const originElevation = map.queryTerrainElevation(center) ?? 0;
    const visibleView = buildingView(map, 0.2);
    const longitudeScale = Math.max(0.1, Math.cos(center.lat * Math.PI / 180));
    const rank = (part: CachedBuildingPart) => {
      const visible = part.longitude >= visibleView.west && part.longitude <= visibleView.east
        && part.latitude >= visibleView.south && part.latitude <= visibleView.north;
      const distance = ((part.longitude - center.lng) * longitudeScale) ** 2
        + (part.latitude - center.lat) ** 2;
      return [visible ? 0 : 1, distance] as const;
    };
    const candidates = [...this.cachedParts.entries()].sort((a, b) => {
      const first = rank(a[1]);
      const second = rank(b[1]);
      return first[0] - second[0] || first[1] - second[1];
    });
    for (const [key] of candidates.slice(MAX_CACHED_PARTS)) this.cachedParts.delete(key);
    const buffers: BuildingBuffers = { positions: [], normals: [], colors: [], uvs: [] };
    let count = 0;
    for (const [index, [, part]] of candidates.slice(0, MAX_CACHED_PARTS).entries()) {
      if (index % 32 === 0) yield;
      const rings = part.rings.map((ring) => ring.map(([lng, lat]) =>
        buildingBodyLocalPoint(lng, lat, origin, units)));
      const elevation = map.queryTerrainElevation([part.longitude, part.latitude]) ?? 0;
      const base = elevation + part.minHeight - originElevation;
      const top = elevation + part.height - originElevation;
      const color = this.paletteColor ? new THREE.Color(this.paletteColor)
        : (this.dark ? DARK_COLOR : LIGHT_COLOR).clone();
      if (this.buildingColorsEnabled && part.colour && /^#[0-9a-f]{6}$/i.test(part.colour)) {
        color.lerp(new THREE.Color(part.colour), 0.35);
      }
      const estimatedVertices = rings.reduce((sum, ring) => sum + ring.length * 9, 0) + rings.length * 6;
      if (buffers.positions.length / 3 + estimatedVertices > MAX_VERTICES || count >= MAX_BUILDINGS) break;
      if (appendBuildingBody(buffers, rings, base, top, color)) count += 1;
    }
    if (count === 0) {
      this.readyView = view;
      this.builtRevision = revision;
      return;
    }
    const geometry = geometryFromBuffers(buffers);
    geometry.computeBoundingBox();
    this.shadowMapDirty = true;
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.origin = center;
    this.originElevation = originElevation;
    this.readyView = view;
    this.builtRevision = revision;
    map.triggerRepaint();
  }
}
