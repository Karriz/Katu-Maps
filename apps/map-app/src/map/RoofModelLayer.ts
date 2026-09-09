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
import { roofClimateForLatitude } from './RoofClimate';
import {
  generateFlatRoofGeometry,
  generateRoofGeometry,
  isEligibleFlatRoofFootprint,
  isEligibleFootprint,
  roofMeshDataToBufferGeometry,
  type RoofCandidate,
  type RoofMeshData,
} from './RoofGeometry';

export const ROOF_MODEL_LAYER_ID = 'roof-models-3d';

const ROOF_MIN_ZOOM = 14;
const ROOF_MAX_BUILDINGS = 1200;
const ROOF_MAX_VERTICES = 120_000;
const ROOF_RECENTER_DISTANCE_METERS = 3000;
const ROOF_Z_OFFSET = 0.02;
/**
 * Flat roof slabs are coplanar with the fill-extrusion top, so the small
 * pitched-roof offset is not enough to avoid z-fighting. Lift the slab
 * clear of the extrusion surface.
 */
const FLAT_ROOF_Z_OFFSET = 0.15;
const ROOF_DEDUPLICATION_CELL_METERS = 8;
const ROOF_DUPLICATE_CENTER_DISTANCE_METERS = 4;
const ROOF_DUPLICATE_MIN_AREA_RATIO = 0.6;
const ROOF_FRAME_BUDGET_MS = 4;

/**
 * Calm, low-saturation roof palette for light mode. All colours sit in a
 * narrow lightness band so they read as a family rather than a rainbow.
 * Clay red is the accent; the rest are warm neutrals that sit comfortably
 * against the pastel building walls.
 */
const ROOF_PALETTE_LIGHT = [
  new THREE.Color('#c8958a'), // soft clay red (slightly desaturated)
  new THREE.Color('#b4b0a8'), // light warm gray
  new THREE.Color('#bea99a'), // light brown
  new THREE.Color('#aca8a0'), // faded taupe
];
/**
 * Dark-mode multiplier applied to the light palette via material.color.
 * Cools and darkens the vertex colours without re-baking them.
 */
const ROOF_DARK_MULTIPLIER = new THREE.Color('#4a4a52');

/**
 * Light, muted palette for flat roof slabs. These sit inset on the larger
 * building outlines; the building's fill-extrusion top forms a parapet rim
 * around them. The tones are lighter than the building walls so the roof
 * reads as a sun-bleached cap rather than a shadow.
 */
const FLAT_ROOF_PALETTE_LIGHT = [
  new THREE.Color('#c4c0b6'), // light warm gray
  new THREE.Color('#bcb8ae'), // light taupe
  new THREE.Color('#c8c2b4'), // light warm stone
  new THREE.Color('#c0c2ba'), // light cool gray
];

const NASINNEULA_BUILDING_OUTLINE_ID = 6_807_253_782;



type RoofFootprint = {
  ring: Array<[number, number]>;
  /** Whether the source polygon has inner rings (courtyards, atriums). */
  hasHoles: boolean;
  centroid: maplibregl.LngLat;
  center: [number, number];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
  id: number | string;
  renderHeight: number;
  wallHeight: number;
};

export class RoofModelLayer implements CustomLayerInterface {
  readonly id = ROOF_MODEL_LAYER_ID;
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
  private sampledRoofCount = 0;
  private completedView?: BuildingView;
  private roofMesh?: THREE.Mesh;
  private roofMaterial?: THREE.MeshLambertMaterial;
  private userEnabled = true;
  private darkMode = false;
  private nightMix = 0;
  private latitude = 61.4981;
  private lastViewSignature = '';
  private flightMode = false;
  private flightRefreshRequested = false;
  private sourceRevision = 0;
  private roofJob?: { generator: Generator<void, boolean, void>; signature: string; revision: number };
  private hemisphereLight?: THREE.HemisphereLight;
  private sunlight?: THREE.DirectionalLight;

  constructor(private readonly sourceId: string = OPENFREEMAP_SOURCE_ID) {}

  setFlightMode(enabled: boolean) {
    if (this.flightMode === enabled) return;
    this.flightMode = enabled;
    this.roofJob = undefined;
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
    this.applyRoofColors();
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
    this.applyRoofColors();
    this.map?.triggerRepaint();
  }

  setEnabled(enabled: boolean) {
    if (this.userEnabled === enabled) return;
    this.userEnabled = enabled;
    if (!enabled) {
      this.roofJob = undefined;
      this.completedView = undefined;
      this.sampledRoofCount = 0;
      this.clearMesh();
      this.map?.triggerRepaint();
      return;
    }
    this.lastViewSignature = '';
    this.map?.triggerRepaint();
  }

  /** Mark the current sample stale without rebuilding once per arriving tile. */
  invalidateSource() {
    this.lastViewSignature = '';
    this.completedView = undefined;
    this.sourceRevision += 1;
    // Streamed tiles invalidate the next sample, without starving this one.
    if (!this.flightMode) this.roofJob = undefined;
  }

  private applyRoofColors() {
    if (!this.roofMaterial) return;
    const night = Math.max(this.darkMode ? 1 : 0, this.nightMix);
    this.roofMaterial.color.set(0xffffff).lerp(ROOF_DARK_MULTIPLIER, night);
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.sceneOrigin = map.getCenter();
    this.sceneOriginElevation = map.queryTerrainElevation(this.sceneOrigin) ?? 0;
    this.latitude = this.sceneOrigin.lat;
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

    this.roofMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });
    this.applyRoofColors();
    this.roofMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.roofMaterial);
    this.roofMesh.frustumCulled = false;
    this.scene.add(this.roofMesh);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  onRemove() {
    this.roofJob = undefined;
    this.map = undefined;
    this.roofMesh?.geometry.dispose();
    this.roofMaterial?.dispose();
    this.renderer?.dispose();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer) return;
    if (!this.userEnabled) return;

    // Recenter if drifted too far. This must happen before updateRoofs so the
    // new job uses the correct scene origin, and roofs from the previous
    // coordinate frame are cleared before they can be rendered against the
    // wrong origin (which would place them at incorrect positions/angles).
    const center = map.getCenter();
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const centerMercator = maplibregl.MercatorCoordinate.fromLngLat(center);
    const units = originMercator.meterInMercatorCoordinateUnits();
    const drift = Math.hypot(
      (centerMercator.x - originMercator.x) / units,
      (centerMercator.y - originMercator.y) / units,
    );
    if (drift > ROOF_RECENTER_DISTANCE_METERS) {
      this.sceneOrigin = center;
      this.sceneOriginElevation = map.queryTerrainElevation(center) ?? 0;
      this.lastViewSignature = '';
      this.roofJob = undefined;
      this.completedView = undefined;
      this.sampledRoofCount = 0;
      this.clearMesh();
    }

    const zoom = map.getZoom();
    if (zoom < ROOF_MIN_ZOOM) {
      this.roofJob = undefined;
      if (this.sampledRoofCount > 0) {
        this.completedView = undefined;
        this.lastViewSignature = '';
        this.sampledRoofCount = 0;
        this.clearMesh();
      }
    } else {
      this.updateRoofs();
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

  updateRoofs(): boolean {
    const map = this.map;
    if (!map || !this.userEnabled || map.getZoom() < ROOF_MIN_ZOOM) return false;
    // Keep the last complete scene during gestures. Idle resumes generation.
    if (!this.flightMode && map.isMoving?.()) {
      this.roofJob = undefined;
      return false;
    }
    if (this.flightMode && !this.roofJob && !this.flightRefreshRequested) return false;
    const view = this.flightMode ? flightBuildingView(map) : buildingView(map);
    const signature = JSON.stringify(view);
    if (!this.flightMode) {
      if ((this.completedView && containsBuildingView(this.completedView, view))
        || signature === this.lastViewSignature) {
        this.roofJob = undefined;
        return false;
      }
      if (this.roofJob && this.roofJob.signature !== signature) this.roofJob = undefined;
    }
    // Flight consumes loaded tiles while more stream in. Tile arrivals request
    // a later pass, rather than requiring the entire horizon to finish loading.
    if (!map.getSource(this.sourceId)
      || (!this.flightMode && !map.isSourceLoaded(this.sourceId))) return false;
    if (!this.roofJob) {
      this.latitude = map.getCenter().lat;
      this.flightRefreshRequested = false;
      this.roofJob = {
        generator: this.sampleRoofsJob(map, this.flightMode ? view : buildingView(map, 0.15)),
        signature,
        revision: this.sourceRevision,
      };
    }

    // Advance bounded geometry steps under a frame budget. The MapLibre
    // source query itself is synchronous and cannot be preempted.
    const deadline = performance.now() + (this.flightMode ? 1.5 : ROOF_FRAME_BUDGET_MS);
    for (let step = 0; step < 128 && performance.now() < deadline; step += 1) {
      const job = this.roofJob;
      const result = job.generator.next();
      if (result.done) {
        this.roofJob = undefined;
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

  private *sampleRoofsJob(map: MaplibreMap, view: BuildingView): Generator<void, boolean, void> {
    if (!map.getSource(this.sourceId)) return false;

    let features: ReturnType<MaplibreMap['querySourceFeatures']> = [];
    try {
      features = map.querySourceFeatures(this.sourceId, {
        sourceLayer: 'building',
      });
    } catch {
      return false;
    }

    const climate = roofClimateForLatitude(this.latitude);

    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(
      this.sceneOrigin, this.sceneOriginElevation,
    );
    const units = originMercator.meterInMercatorCoordinateUnits();
    const toLocal = (lng: number, lat: number): [number, number] => {
      const pt = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
      return [(pt.x - originMercator.x) / units, (originMercator.y - pt.y) / units];
    };

    const footprintCandidates: RoofFootprint[] = [];
    const { west, east, south, north } = view;

    for (const feature of features) {
      yield;
      const sourceId = feature.id ?? feature.properties?.osm_id;
      if (sourceId === NASINNEULA_BUILDING_OUTLINE_ID) continue;
      if (feature.properties?.hide_3d) continue;

      const renderHeight = Number(feature.properties?.render_height ?? 6);
      const renderMinHeight = Number(feature.properties?.render_min_height ?? 0);
      // Skip building parts that start above ground level — these are
      // individual sections of a larger building complex, not standalone
      // houses. Ground-level parts are indistinguishable from whole buildings
      // in the tile data, so only elevated parts are excluded.
      if (renderMinHeight > 0.5) continue;
      const wallHeight = Math.max(0, renderHeight - renderMinHeight);

      // OpenFreeMap groups many ordinary buildings that share properties into
      // one MultiPolygon feature. Treat every polygon as its own footprint;
      // rejecting the feature type here used to discard most detached houses.
      for (const { ring: outerRing, hasHoles } of featureFootprintRings(feature)) {
        yield;
        if (outerRing.length < 4 || outerRing.length > 33) continue;

        // Skip buildings outside the current viewport so the instance cap
        // is spent on visible buildings, not off-screen ones in loaded tiles.
        const centroidLngLat = polygonCentroidLngLat(outerRing);
        if (centroidLngLat.lng < west || centroidLngLat.lng > east
          || centroidLngLat.lat < south || centroidLngLat.lat > north) continue;

        // MultiPolygon feature IDs identify a group, not one building. Add a
        // quantized centroid so roof selection stays local to each footprint
        // and remains stable when neighboring tiles use different group IDs.
        const id = feature.geometry.type === 'Polygon' && sourceId !== undefined
          ? sourceId
          : `building:${centroidLngLat.lng.toFixed(6)}:${centroidLngLat.lat.toFixed(6)}`;
        const localRing = outerRing.map(([lng, lat]) => toLocal(lng, lat));
        // Pitched roofs apply to small rectangular houses; flat roof slabs
        // apply to larger building outlines. The two ranges are disjoint, so
        // a footprint qualifies for at most one roof type.
        if (!isEligibleFootprint(localRing) && !isEligibleFlatRoofFootprint(localRing)) continue;
        footprintCandidates.push({
          ring: localRing,
          hasHoles,
          centroid: centroidLngLat,
          center: polygonCentroid(localRing),
          bounds: polygonBounds(localRing),
          area: polygonArea(localRing),
          id,
          renderHeight,
          wallHeight,
        });
      }
    }

    // Buffered vector tiles repeat buildings near their edges under different
    // grouped feature IDs. Keep the largest (least-clipped) outline before
    // generating roofs so duplicate outlines cannot produce crossed ridges.
    const sortedCandidates = yield* sortBuildingCandidates(footprintCandidates, (first, second) => second.area - first.area);
    const acceptedByCell = new Map<string, RoofFootprint[]>();
    const roofs: Array<{ geometry: THREE.BufferGeometry }> = [];
    let vertexCount = 0;
    for (const footprint of sortedCandidates) {
      yield;
      if (roofs.length >= ROOF_MAX_BUILDINGS) break;
      if (hasNearbyDuplicate(footprint, acceptedByCell)) continue;
      addAcceptedFootprint(footprint, acceptedByCell);

      const numericId = typeof footprint.id === 'number'
        ? footprint.id : hashString(footprint.id);
      const bucket = Math.abs(Math.floor(numericId / 10)) % 100;

      const groundElevation = map.queryTerrainElevation(footprint.centroid) ?? 0;
      const wallTopUp = groundElevation + footprint.renderHeight
        - this.sceneOriginElevation;

      // Pitched/hipped roofs: small houses in pitched climates that win the
      // per-building bucket. Taller small footprints (towers) stay flat so a
      // gable never dwarfs the walls.
      const pitchedEligible = isEligibleFootprint(footprint.ring);
      const canPitch = pitchedEligible
        && climate.pitchedFraction > 0
        && footprint.wallHeight <= 15
        && bucket < climate.pitchedFraction * 100;

      let roofData: RoofMeshData | null = null;
      let palette: THREE.Color | null = null;
      let zOffset = ROOF_Z_OFFSET;
      if (canPitch) {
        const candidate: RoofCandidate = {
          ring: footprint.ring,
          wallHeight: footprint.wallHeight,
          type: climate.type,
          pitchDegrees: climate.pitchDegrees,
          featureId: footprint.id,
        };
        roofData = generateRoofGeometry(candidate);
        palette = ROOF_PALETTE_LIGHT[Math.abs(numericId) % ROOF_PALETTE_LIGHT.length];
      } else if (!footprint.hasHoles && isEligibleFlatRoofFootprint(footprint.ring) && footprint.wallHeight <= 45) {
        // Larger buildings get an inset flat roof slab in every climate,
        // leaving a parapet rim of the building top around it. The larger
        // z-offset avoids z-fighting with the coplanar fill-extrusion top.
        zOffset = FLAT_ROOF_Z_OFFSET;
        const candidate: RoofCandidate = {
          ring: footprint.ring,
          wallHeight: footprint.wallHeight,
          type: 'flat',
          pitchDegrees: 0,
          featureId: footprint.id,
        };
        roofData = generateFlatRoofGeometry(candidate);
        palette = FLAT_ROOF_PALETTE_LIGHT[Math.abs(numericId) % FLAT_ROOF_PALETTE_LIGHT.length];
      }
      if (!roofData || !palette) continue;

      const vertices = roofData.positions.length / 3;
      if (vertexCount + vertices > ROOF_MAX_VERTICES) continue;
      vertexCount += vertices;
      const geometry = roofMeshDataToBufferGeometry(roofData);
      geometry.translate(roofData.offset[0], wallTopUp + zOffset, roofData.offset[1]);
      // Always bake the light palette into vertex colours. Dark-mode and
      // day/night darkening are applied uniformly via the material color in
      // applyRoofColors, so pre-multiplying here would double-darken roofs
      // whenever they are regenerated while a dark style is active.
      const color = palette.clone();
      bakeVertexColors(geometry, color);
      roofs.push({ geometry });
    }

    const merged = yield* mergeBuildingGeometries(roofs.map((entry) => entry.geometry));
    if (this.roofMesh) {
      this.roofMesh.geometry.dispose();
      this.roofMesh.geometry = merged;
      this.roofMesh.visible = roofs.length > 0;
    } else {
      merged.dispose();
    }
    // Retain counts only; the merged buffer owns all rendered vertex data.
    this.sampledRoofCount = roofs.length;
    this.completedView = view;
    return true;
  }

  private clearMesh() {
    if (!this.roofMesh) return;

    this.roofMesh.geometry.dispose();

    this.roofMesh.geometry = new THREE.BufferGeometry();
    this.roofMesh.visible = false;
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

function polygonCentroid(ring: Array<[number, number]>): [number, number] {
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

function polygonBounds(ring: Array<[number, number]>): RoofFootprint['bounds'] {
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
    Math.floor(center[0] / ROOF_DEDUPLICATION_CELL_METERS),
    Math.floor(center[1] / ROOF_DEDUPLICATION_CELL_METERS),
  ];
}

function footprintCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function hasNearbyDuplicate(
  footprint: RoofFootprint,
  acceptedByCell: Map<string, RoofFootprint[]>,
): boolean {
  const [cellX, cellY] = footprintCell(footprint.center);
  const checked = new Set<RoofFootprint>();
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
        if (centerDistance <= ROOF_DUPLICATE_CENTER_DISTANCE_METERS
          && areaRatio >= ROOF_DUPLICATE_MIN_AREA_RATIO) return true;
        // Building outlines and their ground-level parts can have very
        // different areas and centers. Since candidates are largest-first,
        // a smaller footprint whose center lies inside an accepted outline
        // is an overlapping part and must not receive a second roof.
        if (pointInPolygon(footprint.center, accepted.ring)) return true;
      }
    }
  }
  return false;
}

function addAcceptedFootprint(
  footprint: RoofFootprint,
  acceptedByCell: Map<string, RoofFootprint[]>,
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

type FootprintRing = {
  ring: Array<[number, number]>;
  hasHoles: boolean;
};

function* featureFootprintRings(
  feature: ReturnType<MaplibreMap['querySourceFeatures']>[number],
): Generator<FootprintRing> {
  const geometry = feature.geometry;
  if (!geometry) return;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const polygon of polygons) {
    if (polygon[0]) yield { ring: polygon[0] as Array<[number, number]>, hasHoles: polygon.length > 1 };
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
