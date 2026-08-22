import maplibregl, {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';

const ROOF_MIN_ZOOM = 14;
const MAX_ROOF_FEATURES = 2200;
const DEFAULT_ROOF_COLOR = '#c9b9ae';
const REFERENCE = new maplibregl.LngLat(23.7609, 61.4981);
const BUILDING_PALETTES: Record<string, [string[], string[]]> = {
  default: [
    ['#e2e4e3', '#e4ded9', '#dedfe9', '#e2e8df'],
    ['#eceeed', '#eee9e5', '#e9e9f0', '#ebf0e9'],
  ],
  residential: [
    ['#e8d9d3', '#e3dce8', '#e8dfca', '#dfe8e5'],
    ['#f0e5e0', '#ede8f0', '#f0e9dc', '#e8f0ed'],
  ],
  apartments: [
    ['#d9dce8', '#ded8e7', '#d8e5e8', '#e4d9e8'],
    ['#e7e9f0', '#eae5ef', '#e6eef0', '#eee7f0'],
  ],
  commercial: [
    ['#d8e2eb', '#d9ddec', '#e2d9e8', '#d9e7e2'],
    ['#e5edf3', '#e6e9f3', '#ede6f0', '#e7f0eb'],
  ],
  industrial: [
    ['#d6dedc', '#d3dcda', '#dfe0d5', '#d3dce5'],
    ['#e1e7e5', '#dfe6e4', '#e9e8df', '#dfe7ed'],
  ],
  civic: [
    ['#eadfca', '#dddbea', '#e6ddd0', '#dce8e5'],
    ['#f0e8d8', '#e7e5ef', '#eee6dc', '#e6f0ed'],
  ],
};

type SourceFeature = ReturnType<MaplibreMap['querySourceFeatures']>[number];
type MetricPoint = [number, number];
type RoofVertex = [number, number, number];
type AxisFrame = {
  center: MetricPoint;
  longAxis: MetricPoint;
  shortAxis: MetricPoint;
  minLong: number;
  maxLong: number;
  minShort: number;
  maxShort: number;
};

function polygons(feature: SourceFeature): number[][][][] {
  const geometry = feature.geometry;
  if (geometry?.type === 'Polygon') return [geometry.coordinates as number[][][]];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates as number[][][][];
  return [];
}

function metricPoint(coordinates: number[], origin: maplibregl.MercatorCoordinate, units: number) {
  if (coordinates.length < 2) return undefined;
  const point = maplibregl.MercatorCoordinate.fromLngLat([coordinates[0], coordinates[1]]);
  return [(point.x - origin.x) / units, (origin.y - point.y) / units] as MetricPoint;
}

function cleanRing(ring: MetricPoint[]) {
  if (ring.length > 1) {
    const [firstX, firstZ] = ring[0];
    const [lastX, lastZ] = ring[ring.length - 1];
    if (Math.abs(firstX - lastX) < 0.001 && Math.abs(firstZ - lastZ) < 0.001) {
      ring = ring.slice(0, -1);
    }
  }
  return ring.length >= 3 ? ring : undefined;
}

function metricRings(source: number[][][], origin: maplibregl.MercatorCoordinate, units: number) {
  return source
    .map((sourceRing) => cleanRing(sourceRing
      .map((coordinates) => metricPoint(coordinates, origin, units))
      .filter((point): point is MetricPoint => point !== undefined)))
    .filter((ring): ring is MetricPoint[] => ring !== undefined);
}

function isConvex(ring: MetricPoint[]) {
  let winding = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const previous = ring[(index + ring.length - 1) % ring.length];
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const cross = (current[0] - previous[0]) * (next[1] - current[1])
      - (current[1] - previous[1]) * (next[0] - current[0]);
    if (Math.abs(cross) < 0.001) continue;
    const sign = Math.sign(cross);
    if (winding === 0) winding = sign;
    else if (sign !== winding) return false;
  }
  return winding !== 0;
}

function dot([x, z]: MetricPoint, [axisX, axisZ]: MetricPoint) {
  return x * axisX + z * axisZ;
}

function axisFrame(ring: MetricPoint[], orientation: unknown): AxisFrame {
  let centerX = 0;
  let centerZ = 0;
  let longestSquared = 0;
  let longAxis: MetricPoint = [1, 0];
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    centerX += current[0];
    centerZ += current[1];
    const deltaX = next[0] - current[0];
    const deltaZ = next[1] - current[1];
    const lengthSquared = deltaX ** 2 + deltaZ ** 2;
    if (lengthSquared > longestSquared) {
      longestSquared = lengthSquared;
      const length = Math.sqrt(lengthSquared);
      longAxis = [deltaX / length, deltaZ / length];
    }
  }
  const center: MetricPoint = [centerX / ring.length, centerZ / ring.length];
  let shortAxis: MetricPoint = [-longAxis[1], longAxis[0]];
  if (String(orientation ?? '').toLowerCase() === 'across') {
    [longAxis, shortAxis] = [shortAxis, longAxis];
  }

  let minLong = Number.POSITIVE_INFINITY;
  let maxLong = Number.NEGATIVE_INFINITY;
  let minShort = Number.POSITIVE_INFINITY;
  let maxShort = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    const relative: MetricPoint = [point[0] - center[0], point[1] - center[1]];
    const along = dot(relative, longAxis);
    const across = dot(relative, shortAxis);
    minLong = Math.min(minLong, along);
    maxLong = Math.max(maxLong, along);
    minShort = Math.min(minShort, across);
    maxShort = Math.max(maxShort, across);
  }
  return { center, longAxis, shortAxis, minLong, maxLong, minShort, maxShort };
}

function paletteKind(building: string) {
  if (building === 'apartments') return 'apartments';
  if (['residential', 'house', 'detached', 'terrace'].includes(building)) return 'residential';
  if (['commercial', 'office', 'retail'].includes(building)) return 'commercial';
  if (['industrial', 'warehouse'].includes(building)) return 'industrial';
  if (['school', 'public', 'civic'].includes(building)) return 'civic';
  return 'default';
}

function featureSeed(id: SourceFeature['id']) {
  if (typeof id === 'number' && Number.isFinite(id)) return Math.abs(Math.trunc(id));
  const value = String(id ?? '0');
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isReligiousBuilding(properties: Record<string, unknown>) {
  const building = String(properties.building ?? '').toLowerCase();
  return ['church', 'chapel', 'religious', 'cathedral', 'bell_tower'].includes(building)
    || String(properties.amenity ?? '').toLowerCase() === 'place_of_worship'
    || isChurchTower(properties);
}

function topStoreyColor(properties: Record<string, unknown>, id: SourceFeature['id']) {
  const levels = Math.max(1, Math.round(Number(properties.levels) || 1));
  const useAlternate = (levels - 1) % 2 === 1;
  const tagged = useAlternate
    ? properties.building_color_alt ?? properties.building_color
    : properties.building_color ?? properties.building_color_alt;
  if (typeof tagged === 'string' && tagged) return tagged;
  const palettes = BUILDING_PALETTES[paletteKind(String(properties.building ?? '').toLowerCase())];
  const palette = palettes[useAlternate ? 1 : 0];
  return palette[featureSeed(id) % palette.length];
}

function roofColor(properties: Record<string, unknown>, id: SourceFeature['id']) {
  if (typeof properties.roof_color === 'string' && properties.roof_color) {
    return properties.roof_color;
  }
  const levels = Number(properties.levels);
  if (Number.isFinite(levels) && levels >= 10 && !isReligiousBuilding(properties)) {
    return topStoreyColor(properties, id);
  }
  return DEFAULT_ROOF_COLOR;
}

function wallColor(properties: Record<string, unknown>) {
  const value = properties.building_color_alt ?? properties.building_color;
  return typeof value === 'string' && value ? value : '#dedbd4';
}

function isChurchTower(properties: Record<string, unknown>) {
  const towerType = String(properties.tower_type ?? '').toLowerCase();
  return towerType === 'church'
    || towerType === 'bell_tower'
    || String(properties.building ?? '').toLowerCase() === 'bell_tower';
}

function effectiveRoofShape(properties: Record<string, unknown>) {
  const taggedShape = String(properties.roof_shape ?? '').toLowerCase();
  if (taggedShape) return taggedShape;
  return isChurchTower(properties) ? 'pyramidal' : '';
}

function addTriangle(
  positions: number[],
  colors: number[],
  color: THREE.Color,
  first: RoofVertex,
  second: RoofVertex,
  third: RoofVertex,
) {
  positions.push(...first, ...second, ...third);
  for (let vertex = 0; vertex < 3; vertex += 1) colors.push(color.r, color.g, color.b);
}

function ridgePoint(frame: AxisFrame, along: number, height: number): RoofVertex {
  const clamped = Math.max(frame.minLong, Math.min(frame.maxLong, along));
  return [
    frame.center[0] + frame.longAxis[0] * clamped,
    height,
    frame.center[1] + frame.longAxis[1] * clamped,
  ];
}

function emitRidgeRoof(
  ring: MetricPoint[],
  frame: AxisFrame,
  base: number,
  apex: number,
  hipInset: number,
  positions: number[],
  colors: number[],
  roof: THREE.Color,
  wall: THREE.Color,
) {
  const originalMin = frame.minLong;
  const originalMax = frame.maxLong;
  frame.minLong = Math.min(originalMax, originalMin + hipInset);
  frame.maxLong = Math.max(frame.minLong, originalMax - hipInset);
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const currentRelative: MetricPoint = [current[0] - frame.center[0], current[1] - frame.center[1]];
    const nextRelative: MetricPoint = [next[0] - frame.center[0], next[1] - frame.center[1]];
    const currentRidge = ridgePoint(frame, dot(currentRelative, frame.longAxis), apex);
    const nextRidge = ridgePoint(frame, dot(nextRelative, frame.longAxis), apex);
    const currentEave: RoofVertex = [current[0], base, current[1]];
    const nextEave: RoofVertex = [next[0], base, next[1]];
    const ridgeEdgeLengthSquared = (currentRidge[0] - nextRidge[0]) ** 2
      + (currentRidge[2] - nextRidge[2]) ** 2;
    const isGableEnd = hipInset === 0 && ridgeEdgeLengthSquared <= 0.001;
    addTriangle(positions, colors, isGableEnd ? wall : roof, currentEave, nextEave, nextRidge);
    if (ridgeEdgeLengthSquared > 0.001) {
      addTriangle(positions, colors, roof, currentEave, nextRidge, currentRidge);
    }
  }
  frame.minLong = originalMin;
  frame.maxLong = originalMax;
}

function emitPyramidRoof(
  ring: MetricPoint[],
  center: MetricPoint,
  base: number,
  apex: number,
  positions: number[],
  colors: number[],
  roof: THREE.Color,
) {
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    addTriangle(
      positions, colors, roof,
      [current[0], base, current[1]],
      [next[0], base, next[1]],
      [center[0], apex, center[1]],
    );
  }
}

function emitTieredRoof(
  ring: MetricPoint[],
  center: MetricPoint,
  base: number,
  apex: number,
  tiers: Array<[number, number]>,
  positions: number[],
  colors: number[],
  color: THREE.Color,
) {
  let previous = ring.map(([x, z]) => [x, base, z] as RoofVertex);
  for (const [scale, heightFraction] of tiers) {
    const next = ring.map(([x, z]) => [
      center[0] + (x - center[0]) * scale,
      base + (apex - base) * heightFraction,
      center[1] + (z - center[1]) * scale,
    ] as RoofVertex);
    for (let index = 0; index < ring.length; index += 1) {
      const following = (index + 1) % ring.length;
      addTriangle(positions, colors, color, previous[index], previous[following], next[following]);
      addTriangle(positions, colors, color, previous[index], next[following], next[index]);
    }
    previous = next;
  }
  for (let index = 0; index < previous.length; index += 1) {
    addTriangle(
      positions, colors, color,
      previous[index],
      previous[(index + 1) % previous.length],
      [center[0], apex, center[1]],
    );
  }
}

function directionAxis(direction: unknown, fallback: MetricPoint): MetricPoint {
  const bearing = Number(direction);
  if (!Number.isFinite(bearing)) return fallback;
  const radians = bearing * Math.PI / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

function emitSkillionRoof(
  rings: MetricPoint[][],
  frame: AxisFrame,
  direction: unknown,
  base: number,
  apex: number,
  positions: number[],
  colors: number[],
  roof: THREE.Color,
  wall: THREE.Color,
) {
  const slopeDown = directionAxis(direction, frame.shortAxis);
  const points = rings.flat();
  let minSlope = Number.POSITIVE_INFINITY;
  let maxSlope = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const slope = dot(point, slopeDown);
    minSlope = Math.min(minSlope, slope);
    maxSlope = Math.max(maxSlope, slope);
  }
  const span = Math.max(maxSlope - minSlope, 0.01);
  const heightAt = (point: MetricPoint) => apex
    - ((dot(point, slopeDown) - minSlope) / span) * (apex - base);
  const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = rings.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  for (const [firstIndex, secondIndex, thirdIndex] of faces) {
    const first = points[firstIndex];
    const second = points[secondIndex];
    const third = points[thirdIndex];
    addTriangle(
      positions, colors, roof,
      [first[0], heightAt(first), first[1]],
      [second[0], heightAt(second), second[1]],
      [third[0], heightAt(third), third[1]],
    );
  }
  // A skillion is a sloped plane above a level wall extrusion. Close the
  // exposed triangular/trapezoidal fascia around every outer and inner edge.
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      const currentTop: RoofVertex = [current[0], heightAt(current), current[1]];
      const nextTop: RoofVertex = [next[0], heightAt(next), next[1]];
      const currentBase: RoofVertex = [current[0], base, current[1]];
      const nextBase: RoofVertex = [next[0], base, next[1]];
      addTriangle(positions, colors, wall, currentBase, nextBase, nextTop);
      addTriangle(positions, colors, wall, currentBase, nextTop, currentTop);
    }
  }
}

function inferredRoofHeight(shape: string, frame: AxisFrame, properties: Record<string, unknown>) {
  const tagged = Number(properties.roof_height);
  if (Number.isFinite(tagged) && tagged > 0.35) return tagged;
  const shortSpan = frame.maxShort - frame.minShort;
  const towerLimit = isChurchTower(properties) ? 10 : 4.5;
  return Math.min(towerLimit, Math.max(1.8, shortSpan * (shape === 'skillion' ? 0.18 : 0.32)));
}

export class BuildingRoofLayer implements CustomLayerInterface {
  readonly id = 'building-roofs-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private sceneOrigin = REFERENCE;
  private sceneOriginElevation = 0;
  private roofMesh?: THREE.Mesh;

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.scene.add(new THREE.HemisphereLight(0xfff5e8, 0x536158, 1.9));
    const sunlight = new THREE.DirectionalLight(0xffe5bd, 2.6);
    sunlight.position.set(-70, 110, -50);
    this.scene.add(sunlight);
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  updateRoofs() {
    const map = this.map;
    if (!map) return;
    this.roofMesh?.geometry.dispose();
    (this.roofMesh?.material as THREE.Material | undefined)?.dispose();
    if (this.roofMesh) this.scene.remove(this.roofMesh);
    this.roofMesh = undefined;

    if (map.getZoom() < ROOF_MIN_ZOOM) {
      map.triggerRepaint();
      return;
    }

    this.sceneOrigin = map.getCenter();
    this.sceneOriginElevation = map.queryTerrainElevation(this.sceneOrigin) ?? 0;
    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin);
    const units = origin.meterInMercatorCoordinateUnits();
    const positions: number[] = [];
    const colors: number[] = [];
    const roof = new THREE.Color();
    const wall = new THREE.Color();
    let featureCount = 0;

    for (const feature of map.querySourceFeatures('tampere', { sourceLayer: 'buildings' })) {
      if (featureCount >= MAX_ROOF_FEATURES) break;
      const properties = feature.properties ?? {};
      const shape = effectiveRoofShape(properties);
      const buildingHeight = Number(properties.height);
      if (!shape || shape === 'flat' || shape === 'none' || !Number.isFinite(buildingHeight)) continue;
      roof.set(roofColor(properties, feature.id));
      wall.set(wallColor(properties));

      for (const sourcePolygon of polygons(feature)) {
        const rings = metricRings(sourcePolygon, origin, units);
        const outerRing = rings[0];
        if (!outerRing) continue;
        const frame = axisFrame(outerRing, properties.roof_orientation);
        const roofHeight = inferredRoofHeight(shape, frame, properties);
        const location = new maplibregl.LngLat(
          this.sceneOrigin.lng + (frame.center[0] / 111320) / Math.cos(this.sceneOrigin.lat * Math.PI / 180),
          this.sceneOrigin.lat + frame.center[1] / 110540,
        );
        const elevation = map.queryTerrainElevation(location) ?? this.sceneOriginElevation;
        const apex = elevation - this.sceneOriginElevation + buildingHeight;
        const base = apex - roofHeight;

        if (shape === 'skillion') {
          emitSkillionRoof(
            rings, frame, properties.roof_direction, base, apex, positions, colors, roof, wall,
          );
        } else {
          if (rings.length !== 1 || !isConvex(outerRing)) continue;
          const shortSpan = frame.maxShort - frame.minShort;
          if (shape === 'gabled' || shape === 'saltbox' || shape === 'gambrel'
            || shape === 'half-hipped' || shape === 'gabled_height_moved') {
            emitRidgeRoof(outerRing, frame, base, apex, 0, positions, colors, roof, wall);
          } else if (shape === 'hipped' || shape === 'side_hipped') {
            emitRidgeRoof(
              outerRing, frame, base, apex, shortSpan / 2, positions, colors, roof, wall,
            );
          } else if (shape === 'mansard') {
            emitTieredRoof(outerRing, frame.center, base, apex, [[0.56, 1]], positions, colors, roof);
          } else if (shape === 'dome' || shape === 'round') {
            emitTieredRoof(
              outerRing, frame.center, base, apex, [[0.82, 0.5], [0.38, 0.88]], positions, colors, roof,
            );
          } else if (shape === 'onion') {
            emitTieredRoof(
              outerRing, frame.center, base, apex, [[0.88, 0.38], [0.62, 0.68], [0.2, 0.9]],
              positions, colors, roof,
            );
          } else {
            emitPyramidRoof(outerRing, frame.center, base, apex, positions, colors, roof);
          }
        }
        featureCount += 1;
      }
    }

    if (positions.length === 0) {
      map.triggerRepaint();
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.roofMesh = new THREE.Mesh(geometry, material);
    this.roofMesh.frustumCulled = false;
    this.scene.add(this.roofMesh);
    map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    const renderer = this.renderer;
    if (!map || !renderer || map.getZoom() < ROOF_MIN_ZOOM || !this.roofMesh) return;
    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.sceneOrigin, this.sceneOriginElevation);
    const scale = origin.meterInMercatorCoordinateUnits();
    this.sceneScale.set(scale, -scale, scale);
    this.sceneTransform.makeTranslation(origin.x, origin.y, origin.z).scale(this.sceneScale);
    this.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(this.sceneTransform);
    this.camera.projectionMatrix.copy(this.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    renderer.resetState();
    renderer.render(this.scene, this.camera);
  }

  onRemove() {
    this.roofMesh?.geometry.dispose();
    (this.roofMesh?.material as THREE.Material | undefined)?.dispose();
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }
}
