import * as maplibregl from 'maplibre-gl';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';
import { flightBuildingView, buildingView, containsBuildingView, mergeBuildingGeometries, sortBuildingCandidates, type BuildingView } from './BuildingModelWork';
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
import {
  facadeMeshDataToBufferGeometry,
  generateFacadeGeometry,
  isEligibleFacadeFootprint,
  type FacadeCandidate,
} from './FacadeGeometry';

export const FACADE_MODEL_LAYER_ID = 'facade-details-3d';

const FACADE_MIN_ZOOM = 15;
const FACADE_MAX_BUILDINGS = 1200;
const FACADE_MAX_VERTICES = 240_000;
const FACADE_RECENTER_DISTANCE_METERS = 3000;
const FACADE_DEDUPLICATION_CELL_METERS = 8;
const FACADE_DUPLICATE_CENTER_DISTANCE_METERS = 4;
const FACADE_DUPLICATE_MIN_AREA_RATIO = 0.6;
const FACADE_FRAME_BUDGET_MS = 4;
const FACADE_MIN_WALL_HEIGHT_M = 3;
const FACADE_MAX_WALL_HEIGHT_M = 45;

/**
 * Glass tint for light mode. Only slightly darker than the building wall
 * colour (#fffdf8) so windows read as a subtle tonal shift rather than
 * a separate material pasted onto the facade.
 */
const FACADE_GLASS_LIGHT = new THREE.Color('#dcd8cf');
/**
 * Glass tint for dark mode. Slightly lighter than the dark building wall
 * (#293f53) so windows remain visible at night even before emissive.
 */
const FACADE_GLASS_DARK = new THREE.Color('#334458');
/**
 * Emissive glow applied to windows in dark mode to simulate lit
 * interiors. A warm amber tone that reads as indoor lighting without
 * overpowering the scene. Set to black (no glow) in light mode.
 */
const FACADE_EMISSIVE_NIGHT = new THREE.Color('#5a4a2e');
const FACADE_EMISSIVE_INTENSITY_NIGHT = 0.55;
const FACADE_EMISSIVE_OFF = new THREE.Color('#000000');

/**
 * Subtle per-building brightness variation baked into vertex colours.
 * Multiplied with the material colour so all buildings share the same
 * glass hue while varying slightly in lightness.
 */
const FACADE_GLASS_VARIATION = [
  new THREE.Color(1.0, 1.0, 1.0),
  new THREE.Color(0.94, 0.94, 0.94),
  new THREE.Color(0.97, 0.97, 0.97),
  new THREE.Color(0.91, 0.91, 0.91),
];

const NASINNEULA_BUILDING_OUTLINE_ID = 6_807_253_782;



type FacadeFootprint = {
  ring: Array<[number, number]>;
  centroid: maplibregl.LngLat;
  center: [number, number];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
  id: number | string;
  renderHeight: number;
  renderMinHeight: number;
  wallHeight: number;
};

export class FacadeModelLayer implements CustomLayerInterface {
  readonly id = FACADE_MODEL_LAYER_ID;
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
  private sampledFacadeCount = 0;
  private completedView?: BuildingView;
  private facadeMesh?: THREE.Mesh;
  private facadeMaterial?: THREE.MeshLambertMaterial;
  private userEnabled = true;
  private darkMode = false;
  private nightMix = 0;
  private lastViewSignature = '';
  private flightMode = false;
  private flightRefreshRequested = false;
  private sourceRevision = 0;
  private facadeJob?: { generator: Generator<void, boolean, void>; signature: string; revision: number };
  private hemisphereLight?: THREE.HemisphereLight;
  private sunlight?: THREE.DirectionalLight;

  constructor(private readonly sourceId: string = OPENFREEMAP_SOURCE_ID) {}

  setFlightMode(enabled: boolean) {
    if (this.flightMode === enabled) return;
    this.flightMode = enabled;
    this.facadeJob = undefined;
    this.completedView = undefined;
    this.lastViewSignature = '';
    this.flightRefreshRequested = enabled;
    this.map?.triggerRepaint();
  }

  requestFlightRefresh() {
    if (!this.flightMode) return;
    this.flightRefreshRequested = true;
    this.map?.triggerRepaint();
  }

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    this.applyFacadeColors();
    this.map?.triggerRepaint();
  }

  setDayNightLighting(lighting: {
    azimuth: number;
    polar: number;
    nightMix: number;
  } | null) {
    const azimuth = lighting?.azimuth ?? CARTOON_SUN_AZIMUTH_DEGREES;
    const polar = lighting?.polar ?? CARTOON_SUN_POLAR_DEGREES;
    this.nightMix = lighting?.nightMix ?? 0;
    const position = sunCartesian(azimuth, polar);
    this.sunlight?.position.set(position.x, position.y, position.z);
    if (this.sunlight) {
      this.sunlight.intensity = CARTOON_SUN_BASE_INTENSITY + (1 - this.nightMix) * CARTOON_SUN_DAY_INTENSITY;
      this.sunlight.color.set(this.nightMix > 0.65 ? 0xc8d4f0 : CARTOON_SUN_COLOR);
    }
    if (this.hemisphereLight) {
      this.hemisphereLight.intensity = CARTOON_AMBIENT_BASE_INTENSITY + (1 - this.nightMix) * CARTOON_AMBIENT_DAY_INTENSITY;
    }
    this.applyFacadeColors();
    this.map?.triggerRepaint();
  }

  setEnabled(enabled: boolean) {
    if (this.userEnabled === enabled) return;
    this.userEnabled = enabled;
    if (!enabled) {
      this.facadeJob = undefined;
      this.completedView = undefined;
      this.sampledFacadeCount = 0;
      this.clearMesh();
      this.map?.triggerRepaint();
      return;
    }
    this.lastViewSignature = '';
    this.map?.triggerRepaint();
  }

  invalidateSource() {
    this.lastViewSignature = '';
    this.completedView = undefined;
    this.sourceRevision += 1;
    // Streamed tiles invalidate the next sample, without starving this one.
    if (!this.flightMode) this.facadeJob = undefined;
  }

  private applyFacadeColors() {
    if (!this.facadeMaterial) return;
    const night = Math.max(this.darkMode ? 1 : 0, this.nightMix);
    this.facadeMaterial.color.copy(FACADE_GLASS_LIGHT).lerp(FACADE_GLASS_DARK, night);
    this.facadeMaterial.emissive.copy(FACADE_EMISSIVE_OFF).lerp(FACADE_EMISSIVE_NIGHT, night);
    this.facadeMaterial.emissiveIntensity = night * FACADE_EMISSIVE_INTENSITY_NIGHT;
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.sceneOrigin = map.getCenter();
    this.sceneOriginElevation = map.queryTerrainElevation(this.sceneOrigin) ?? 0;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));

    this.hemisphereLight = new THREE.HemisphereLight(
      CARTOON_AMBIENT_SKY_COLOR, CARTOON_AMBIENT_GROUND_COLOR, 1.8,
    );
    this.scene.add(this.hemisphereLight);
    this.sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR, 2.4);
    const sunPosition = sunCartesian(CARTOON_SUN_AZIMUTH_DEGREES, CARTOON_SUN_POLAR_DEGREES);
    this.sunlight.position.set(sunPosition.x, sunPosition.y, sunPosition.z);
    this.scene.add(this.sunlight);

    this.facadeMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.applyFacadeColors();
    this.facadeMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.facadeMaterial);
    this.facadeMesh.frustumCulled = false;
    this.scene.add(this.facadeMesh);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  onRemove() {
    this.facadeJob = undefined;
    this.map = undefined;
    this.facadeMesh?.geometry.dispose();
    this.facadeMaterial?.dispose();
    this.renderer?.dispose();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer) return;
    if (!this.userEnabled) return;

    const center = map.getCenter();
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const centerMercator = maplibregl.MercatorCoordinate.fromLngLat(center);
    const units = originMercator.meterInMercatorCoordinateUnits();
    const drift = Math.hypot(
      (centerMercator.x - originMercator.x) / units,
      (centerMercator.y - originMercator.y) / units,
    );
    if (drift > FACADE_RECENTER_DISTANCE_METERS) {
      this.sceneOrigin = center;
      this.sceneOriginElevation = map.queryTerrainElevation(center) ?? 0;
      this.lastViewSignature = '';
      this.facadeJob = undefined;
      this.completedView = undefined;
      this.sampledFacadeCount = 0;
      this.clearMesh();
    }

    const zoom = map.getZoom();
    if (zoom < (this.flightMode ? 14 : FACADE_MIN_ZOOM)) {
      this.facadeJob = undefined;
      if (this.sampledFacadeCount > 0) {
        this.completedView = undefined;
        this.lastViewSignature = '';
        this.sampledFacadeCount = 0;
        this.clearMesh();
      }
    } else {
      this.updateFacades();
    }

    const origin = maplibregl.MercatorCoordinate.fromLngLat(
      this.sceneOrigin, this.sceneOriginElevation,
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

  updateFacades(): boolean {
    const map = this.map;
    if (!map || !this.userEnabled || map.getZoom() < (this.flightMode ? 14 : FACADE_MIN_ZOOM)) return false;
    // Keep the last complete scene during gestures. Idle resumes generation.
    if (!this.flightMode && map.isMoving?.()) {
      this.facadeJob = undefined;
      return false;
    }
    if (this.flightMode && !this.facadeJob && !this.flightRefreshRequested) return false;
    const view = this.flightMode ? flightBuildingView(map) : buildingView(map);
    const signature = JSON.stringify(view);
    if (!this.flightMode) {
      if ((this.completedView && containsBuildingView(this.completedView, view))
        || signature === this.lastViewSignature) {
        this.facadeJob = undefined;
        return false;
      }
      if (this.facadeJob && this.facadeJob.signature !== signature) this.facadeJob = undefined;
    }
    // Flight consumes loaded tiles while more stream in. Tile arrivals request
    // a later pass, rather than requiring the entire horizon to finish loading.
    if (!map.getSource(this.sourceId)
      || (!this.flightMode && !map.isSourceLoaded(this.sourceId))) return false;
    if (!this.facadeJob) {
      this.flightRefreshRequested = false;
      this.facadeJob = {
        generator: this.sampleFacadesJob(map, this.flightMode ? view : buildingView(map, 0.15)),
        signature,
        revision: this.sourceRevision,
      };
    }

    const deadline = performance.now() + (this.flightMode ? 1.5 : FACADE_FRAME_BUDGET_MS);
    for (let step = 0; step < 128 && performance.now() < deadline; step += 1) {
      const job = this.facadeJob;
      const result = job.generator.next();
      if (result.done) {
        this.facadeJob = undefined;
        if (result.value && job.revision === this.sourceRevision) {
          this.lastViewSignature = job.signature;
        } else {
          this.completedView = undefined;
          this.lastViewSignature = '';
        }
        return result.value;
      }
    }
    map.triggerRepaint();
    return false;
  }

  private *sampleFacadesJob(map: MaplibreMap, view: BuildingView): Generator<void, boolean, void> {
    if (!map.getSource(this.sourceId)) return false;

    let features: ReturnType<MaplibreMap['querySourceFeatures']> = [];
    try {
      features = map.querySourceFeatures(this.sourceId, {
        sourceLayer: 'building',
      });
    } catch {
      return false;
    }

    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(
      this.sceneOrigin, this.sceneOriginElevation,
    );
    const units = originMercator.meterInMercatorCoordinateUnits();
    const toLocal = (lng: number, lat: number): [number, number] => {
      const pt = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
      return [(pt.x - originMercator.x) / units, (originMercator.y - pt.y) / units];
    };

    const footprintCandidates: FacadeFootprint[] = [];
    const { west, east, south, north } = view;

    for (const feature of features) {
      yield;
      const sourceId = feature.id ?? feature.properties?.osm_id;
      if (sourceId === NASINNEULA_BUILDING_OUTLINE_ID) continue;
      if (feature.properties?.hide_3d) continue;

      const renderHeight = Number(feature.properties?.render_height ?? 6);
      const renderMinHeight = Number(feature.properties?.render_min_height ?? 0);
      // Skip elevated building parts — these belong to multi-part structures
      // where procedural windows would look misplaced.
      if (renderMinHeight > 0.5) continue;
      const wallHeight = Math.max(0, renderHeight - renderMinHeight);
      if (wallHeight < FACADE_MIN_WALL_HEIGHT_M) continue;
      if (wallHeight > FACADE_MAX_WALL_HEIGHT_M) continue;

      for (const outerRing of featureFootprintRings(feature)) {
        yield;
        if (outerRing.length < 4 || outerRing.length > 25) continue;

        const centroidLngLat = polygonCentroidLngLat(outerRing);
        if (centroidLngLat.lng < west || centroidLngLat.lng > east
          || centroidLngLat.lat < south || centroidLngLat.lat > north) continue;

        const id = feature.geometry.type === 'Polygon' && sourceId !== undefined
          ? sourceId
          : `building:${centroidLngLat.lng.toFixed(6)}:${centroidLngLat.lat.toFixed(6)}`;
        const localRing = outerRing.map(([lng, lat]) => toLocal(lng, lat));
        if (!isEligibleFacadeFootprint(localRing)) continue;
        footprintCandidates.push({
          ring: localRing,
          centroid: centroidLngLat,
          center: polygonCentroidLocal(localRing),
          bounds: polygonBounds(localRing),
          area: polygonArea(localRing),
          id,
          renderHeight,
          renderMinHeight,
          wallHeight,
        });
      }
    }

    const sortedCandidates = yield* sortBuildingCandidates(footprintCandidates, (first, second) => second.area - first.area);
    const acceptedByCell = new Map<string, FacadeFootprint[]>();
    const facades: Array<{ geometry: THREE.BufferGeometry }> = [];
    let vertexCount = 0;
    for (const footprint of sortedCandidates) {
      yield;
      if (facades.length >= FACADE_MAX_BUILDINGS) break;
      if (hasNearbyDuplicate(footprint, acceptedByCell)) continue;
      addAcceptedFootprint(footprint, acceptedByCell);

      const numericId = typeof footprint.id === 'number'
        ? footprint.id : hashString(footprint.id);

      const groundElevation = map.queryTerrainElevation(footprint.centroid) ?? 0;
      const wallBaseY = groundElevation + footprint.renderMinHeight
        - this.sceneOriginElevation;

      const candidate: FacadeCandidate = {
        ring: footprint.ring,
        wallHeight: footprint.wallHeight,
        featureId: footprint.id,
        maxWindows: view.zoom < 16 ? 128 : view.zoom < 17 ? 256 : 512,
      };
      const facadeData = generateFacadeGeometry(candidate);
      if (!facadeData) continue;

      const vertices = facadeData.positions.length / 3;
      if (vertexCount + vertices > FACADE_MAX_VERTICES) continue;
      vertexCount += vertices;
      const geometry = facadeMeshDataToBufferGeometry(facadeData);
      geometry.translate(facadeData.offset[0], wallBaseY, facadeData.offset[1]);
      const variation = FACADE_GLASS_VARIATION[Math.abs(numericId) % FACADE_GLASS_VARIATION.length];
      bakeVertexColors(geometry, variation);
      facades.push({ geometry });
    }

    const merged = yield* mergeBuildingGeometries(facades.map((entry) => entry.geometry));
    if (this.facadeMesh) {
      this.facadeMesh.geometry.dispose();
      this.facadeMesh.geometry = merged;
      this.facadeMesh.visible = facades.length > 0;
    } else {
      merged.dispose();
    }
    // Retain counts only; the merged buffer owns all rendered vertex data.
    this.sampledFacadeCount = facades.length;
    this.completedView = view;
    return true;
  }

  private clearMesh() {
    if (!this.facadeMesh) return;

    this.facadeMesh.geometry.dispose();

    this.facadeMesh.geometry = new THREE.BufferGeometry();
    this.facadeMesh.visible = false;
  }
}

// --- Helpers ----------------------------------------------------------------

function polygonCentroidLngLat(ring: Array<[number, number]>): maplibregl.LngLat {
  const pointCount = ring.length > 1 && pointsEqual(ring[0], ring[ring.length - 1])
    ? ring.length - 1
    : ring.length;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < pointCount; index++) {
    const [lng, lat] = ring[index];
    cx += lng;
    cy += lat;
  }
  return new maplibregl.LngLat(cx / pointCount, cy / pointCount);
}

function polygonCentroidLocal(ring: Array<[number, number]>): [number, number] {
  const pointCount = ring.length > 1 && pointsEqual(ring[0], ring[ring.length - 1])
    ? ring.length - 1
    : ring.length;
  let x = 0;
  let y = 0;
  for (let index = 0; index < pointCount; index++) {
    x += ring[index][0];
    y += ring[index][1];
  }
  return [x / pointCount, y / pointCount];
}

function polygonArea(ring: Array<[number, number]>): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

function polygonBounds(ring: Array<[number, number]>): FacadeFootprint['bounds'] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function pointsEqual(first: [number, number], second: [number, number]): boolean {
  return first[0] === second[0] && first[1] === second[1];
}

function footprintCell(center: [number, number]): [number, number] {
  return [
    Math.floor(center[0] / FACADE_DEDUPLICATION_CELL_METERS),
    Math.floor(center[1] / FACADE_DEDUPLICATION_CELL_METERS),
  ];
}

function footprintCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function hasNearbyDuplicate(
  footprint: FacadeFootprint,
  acceptedByCell: Map<string, FacadeFootprint[]>,
): boolean {
  const [cellX, cellY] = footprintCell(footprint.center);
  const checked = new Set<FacadeFootprint>();
  for (let x = cellX - 1; x <= cellX + 1; x++) {
    for (let y = cellY - 1; y <= cellY + 1; y++) {
      const nearby = acceptedByCell.get(footprintCellKey(x, y));
      if (!nearby) continue;
      for (const accepted of nearby) {
        if (checked.has(accepted)) continue;
        checked.add(accepted);
        if (Math.abs(footprint.renderHeight - accepted.renderHeight) > 0.5) continue;
        const centerDistance = Math.hypot(
          footprint.center[0] - accepted.center[0],
          footprint.center[1] - accepted.center[1],
        );
        const areaRatio = footprint.area / accepted.area;
        if (centerDistance <= FACADE_DUPLICATE_CENTER_DISTANCE_METERS
          && areaRatio >= FACADE_DUPLICATE_MIN_AREA_RATIO) return true;
        if (pointInPolygon(footprint.center, accepted.ring)) return true;
      }
    }
  }
  return false;
}

function addAcceptedFootprint(
  footprint: FacadeFootprint,
  acceptedByCell: Map<string, FacadeFootprint[]>,
) {
  const [minCellX, minCellY] = footprintCell([footprint.bounds.minX, footprint.bounds.minY]);
  const [maxCellX, maxCellY] = footprintCell([footprint.bounds.maxX, footprint.bounds.maxY]);
  for (let x = minCellX; x <= maxCellX; x++) {
    for (let y = minCellY; y <= maxCellY; y++) {
      const key = footprintCellKey(x, y);
      const footprints = acceptedByCell.get(key);
      if (footprints) {
        footprints.push(footprint);
      } else {
        acceptedByCell.set(key, [footprint]);
      }
    }
  }
}

function pointInPolygon(point: [number, number], ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[previous];
    const [x2, y2] = ring[current];
    const cross = (point[0] - x1) * (y2 - y1) - (point[1] - y1) * (x2 - x1);
    const onSegment = Math.abs(cross) < 0.05
      && point[0] >= Math.min(x1, x2) - 0.05 && point[0] <= Math.max(x1, x2) + 0.05
      && point[1] >= Math.min(y1, y2) - 0.05 && point[1] <= Math.max(y1, y2) + 0.05;
    if (onSegment) return true;
    if ((y1 > point[1]) !== (y2 > point[1])
      && point[0] < ((x2 - x1) * (point[1] - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function* featureFootprintRings(
  feature: ReturnType<MaplibreMap['querySourceFeatures']>[number],
): Generator<Array<[number, number]>> {
  const geometry = feature.geometry;
  if (!geometry) return;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const polygon of polygons) {
    if (polygon[0]) yield polygon[0] as Array<[number, number]>;
  }
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

function bakeVertexColors(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const posAttr = geometry.getAttribute('position');
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
