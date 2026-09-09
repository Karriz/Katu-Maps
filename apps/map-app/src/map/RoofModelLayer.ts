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
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_COLOR,
  CARTOON_SUN_POLAR_DEGREES,
  sunCartesian,
} from './CartoonLighting';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';
import { roofClimateForLatitude } from './RoofClimate';
import {
  generateRoofGeometry,
  isEligibleFootprint,
  roofMeshDataToBufferGeometry,
  type RoofCandidate,
} from './RoofGeometry';

export const ROOF_MODEL_LAYER_ID = 'roof-models-3d';

const ROOF_MIN_ZOOM = 13;
const ROOF_MAX_BUILDINGS = 1200;
const ROOF_RECENTER_DISTANCE_METERS = 3000;
const ROOF_Z_OFFSET = 0.02;
const ROOF_DEDUPLICATION_CELL_METERS = 8;
const ROOF_DUPLICATE_CENTER_DISTANCE_METERS = 4;
const ROOF_DUPLICATE_MIN_AREA_RATIO = 0.6;

const ROOF_COLOR_LIGHT = new THREE.Color('#b8704a');
const ROOF_COLOR_LIGHT_ALT = new THREE.Color('#9a8478');
const ROOF_COLOR_DARK = new THREE.Color('#3d3528');
const ROOF_COLOR_DARK_ALT = new THREE.Color('#2e3340');

const NASINNEULA_BUILDING_OUTLINE_ID = 6_807_253_782;

type SampledRoof = {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
};

type RoofFootprint = {
  ring: Array<[number, number]>;
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
  private sampledRoofs: SampledRoof[] = [];
  private roofMesh?: THREE.Mesh;
  private roofMaterial?: THREE.MeshLambertMaterial;
  private userEnabled = true;
  private darkMode = false;
  private latitude = 61.4981;
  private lastViewSignature = '';
  private hemisphereLight?: THREE.HemisphereLight;
  private sunlight?: THREE.DirectionalLight;

  constructor(private readonly sourceId: string = OPENFREEMAP_SOURCE_ID) {}

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    this.applyRoofColors();
    this.map?.triggerRepaint();
  }

  setEnabled(enabled: boolean) {
    if (this.userEnabled === enabled) return;
    this.userEnabled = enabled;
    if (!enabled) {
      this.sampledRoofs = [];
      this.rebuildMesh();
      this.map?.triggerRepaint();
      return;
    }
    this.lastViewSignature = '';
    this.map?.triggerRepaint();
  }

  /** Mark the current sample stale without rebuilding once per arriving tile. */
  invalidateSource() {
    this.lastViewSignature = '';
  }

  private applyRoofColors() {
    if (!this.roofMaterial) return;
    if (this.darkMode) {
      this.roofMaterial.color.set(ROOF_COLOR_DARK);
    } else {
      this.roofMaterial.color.set(ROOF_COLOR_LIGHT);
    }
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
      color: this.darkMode ? ROOF_COLOR_DARK : ROOF_COLOR_LIGHT,
      flatShading: true,
    });
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
    this.roofMesh?.geometry.dispose();
    this.roofMaterial?.dispose();
    this.renderer?.dispose();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer) return;
    if (!this.userEnabled) return;

    const zoom = map.getZoom();
    if (zoom < ROOF_MIN_ZOOM) {
      if (this.sampledRoofs.length > 0) {
        this.sampledRoofs = [];
        this.rebuildMesh();
      }
    } else {
      this.updateRoofs();
    }

    // Recenter if drifted too far.
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

  private viewSignature(map: MaplibreMap): string {
    const bounds = map.getBounds();
    const zoom = Math.round(map.getZoom() * 2) / 2;
    const lat = Math.round(map.getCenter().lat * 10) / 10;
    return [
      zoom.toFixed(2),
      lat.toFixed(1),
      bounds.getWest().toFixed(4),
      bounds.getSouth().toFixed(4),
      bounds.getEast().toFixed(4),
      bounds.getNorth().toFixed(4),
    ].join(',');
  }

  updateRoofs(): boolean {
    const map = this.map;
    if (!map || !this.userEnabled || map.getZoom() < ROOF_MIN_ZOOM) return false;
    const signature = this.viewSignature(map);
    if (signature === this.lastViewSignature) return false;
    // querySourceFeatures only sees currently loaded tiles. Preserve the old
    // roof mesh and leave this signature pending until the visible source has
    // finished loading, otherwise the first partial sample becomes permanent.
    if (!map.getSource(this.sourceId) || !map.isSourceLoaded(this.sourceId)) return false;
    this.latitude = map.getCenter().lat;
    if (!this.sampleRoofs(map)) return false;
    this.rebuildMesh();
    this.lastViewSignature = signature;
    return true;
  }

  private sampleRoofs(map: MaplibreMap): boolean {
    if (!map.getSource(this.sourceId)) {
      return false;
    }

    let features: ReturnType<MaplibreMap['querySourceFeatures']> = [];
    try {
      features = map.querySourceFeatures(this.sourceId, {
        sourceLayer: 'building',
      });
    } catch {
      return false;
    }

    const climate = roofClimateForLatitude(this.latitude);
    if (climate.type === 'flat' || climate.pitchedFraction === 0) {
      this.sampledRoofs = [];
      return true;
    }

    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(
      this.sceneOrigin, this.sceneOriginElevation,
    );
    const units = originMercator.meterInMercatorCoordinateUnits();
    const toLocal = (lng: number, lat: number): [number, number] => {
      const pt = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
      return [(pt.x - originMercator.x) / units, (originMercator.y - pt.y) / units];
    };

    const footprintCandidates: RoofFootprint[] = [];
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();

    for (const feature of features) {
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
      if (wallHeight > 15) continue;

      // OpenFreeMap groups many ordinary buildings that share properties into
      // one MultiPolygon feature. Treat every polygon as its own footprint;
      // rejecting the feature type here used to discard most detached houses.
      for (const outerRing of featureFootprintRings(feature)) {
        if (outerRing.length < 4) continue;

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
        if (!isEligibleFootprint(localRing)) continue;
        footprintCandidates.push({
          ring: localRing,
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
    footprintCandidates.sort((first, second) => second.area - first.area);
    const acceptedByCell = new Map<string, RoofFootprint[]>();
    const roofs: SampledRoof[] = [];
    for (const footprint of footprintCandidates) {
      if (roofs.length >= ROOF_MAX_BUILDINGS) break;
      if (hasNearbyDuplicate(footprint, acceptedByCell)) continue;
      addAcceptedFootprint(footprint, acceptedByCell);

      const numericId = typeof footprint.id === 'number'
        ? footprint.id : hashString(footprint.id);
      const bucket = Math.abs(Math.floor(numericId / 10)) % 100;
      if (bucket >= climate.pitchedFraction * 100) continue;

      const groundElevation = map.queryTerrainElevation(footprint.centroid) ?? 0;
      const wallTopUp = groundElevation + footprint.renderHeight
        - this.sceneOriginElevation + ROOF_Z_OFFSET;
      const candidate: RoofCandidate = {
        ring: footprint.ring,
        wallHeight: footprint.wallHeight,
        type: climate.type,
        pitchDegrees: climate.pitchDegrees,
        featureId: footprint.id,
      };
      const roofData = generateRoofGeometry(candidate);
      if (!roofData) continue;

      const geometry = roofMeshDataToBufferGeometry(roofData);
      geometry.translate(roofData.offset[0], wallTopUp, roofData.offset[1]);
      const color = this.darkMode
        ? (numericId % 2 === 0 ? ROOF_COLOR_DARK : ROOF_COLOR_DARK_ALT)
        : (numericId % 2 === 0 ? ROOF_COLOR_LIGHT : ROOF_COLOR_LIGHT_ALT);
      roofs.push({ geometry, color });
    }

    this.sampledRoofs = roofs;
    return true;
  }

  private rebuildMesh() {
    if (!this.roofMesh) return;

    this.roofMesh.geometry.dispose();

    if (this.sampledRoofs.length === 0) {
      this.roofMesh.geometry = new THREE.BufferGeometry();
      this.roofMesh.visible = false;
      return;
    }

    this.roofMesh.visible = true;
    this.roofMesh.geometry = mergeGeometries(this.sampledRoofs.map((r) => r.geometry));
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

function featureFootprintRings(
  feature: ReturnType<MaplibreMap['querySourceFeatures']>[number],
): Array<Array<[number, number]>> {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] ? [geometry.coordinates[0] as Array<[number, number]>] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon[0] as Array<[number, number]> | undefined)
      .filter((ring): ring is Array<[number, number]> => Boolean(ring));
  }
  return [];
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalPositions = 0;
  let totalIndices = 0;
  for (const g of geometries) {
    const posAttr = g.getAttribute('position');
    totalPositions += posAttr.count * 3;
    totalIndices += g.getIndex()?.count ?? 0;
  }

  const positions = new Float32Array(totalPositions);
  const normals = new Float32Array(totalPositions);
  const useUint32 = totalIndices > 65535;
  const indices = useUint32 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let posOffset = 0;
  let idxOffset = 0;
  let vertexOffset = 0;
  for (const g of geometries) {
    const posAttr = g.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = g.getAttribute('normal') as THREE.BufferAttribute;
    const idxAttr = g.getIndex() as THREE.BufferAttribute;

    positions.set(posAttr.array as Float32Array, posOffset);
    normals.set(normAttr.array as Float32Array, posOffset);

    const idxArray = idxAttr.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idxArray.length; i++) {
      indices[idxOffset + i] = idxArray[i] + vertexOffset;
    }

    posOffset += posAttr.array.length;
    idxOffset += idxArray.length;
    vertexOffset += posAttr.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}
