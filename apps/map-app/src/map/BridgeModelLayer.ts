import maplibregl, {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';

// Roads and railways are available from z10; paths start at z12. Keeping the
// custom layer at z10 lets the map's default z11 view show road/rail bridges.
const MIN_ZOOM = 10;
const MAX_BRIDGES = 350;
const REFERENCE = new maplibregl.LngLat(23.7609, 61.4981);
const REFERENCE_UNITS_PER_METER = maplibregl.MercatorCoordinate
  .fromLngLat(REFERENCE)
  .meterInMercatorCoordinateUnits();

type SourceFeature = ReturnType<MaplibreMap['querySourceFeatures']>[number];
type Point = { x: number; z: number; elevation: number; ground: number };
type BridgeSurfaceStrip = {
  sourceLayer: string;
  offset: number;
  width: number;
  className: string;
  surface: string;
};

function bridgeCoordinateParts(feature: SourceFeature): number[][][] {
  const geometry = feature.geometry;
  if (geometry?.type === 'LineString') return [geometry.coordinates as number[][]];
  if (geometry?.type === 'MultiLineString') {
    return geometry.coordinates as number[][][];
  }
  return [];
}

function metricPoint(coordinates: number[], origin: maplibregl.LngLat, units: number) {
  if (coordinates.length < 2) return undefined;
  const location = maplibregl.MercatorCoordinate.fromLngLat([coordinates[0], coordinates[1]]);
  const originMercator = maplibregl.MercatorCoordinate.fromLngLat(origin);
  return {
    x: (location.x - originMercator.x) / units,
    z: (originMercator.y - location.y) / units,
  };
}

function widthFor(
  sourceLayer: string,
  className: string,
  widthValue: unknown,
  lanesValue: unknown,
) {
  const taggedWidth = Number(widthValue);
  if (Number.isFinite(taggedWidth) && taggedWidth > 0) {
    return Math.min(30, Math.max(sourceLayer === 'paths' ? 1 : 2.5, taggedWidth));
  }
  if (sourceLayer === 'railways') return 3.2;
  if (sourceLayer === 'paths') {
    if (className === 'track') return 3.5;
    if (className === 'cycleway') return 3;
    if (className === 'pedestrian') return 4;
    if (className === 'footway') return 2;
    return className === 'path' ? 1.5 : 2;
  }
  const classWidth = className === 'motorway' ? 12
    : className === 'trunk' ? 10
      : className === 'primary' ? 8
        : className === 'secondary' ? 7
          : className === 'tertiary' ? 6
            : className === 'residential' ? 5.5
              : className === 'service' ? 4
                : 5;
  const lanes = Number(lanesValue);
  if (Number.isFinite(lanes) && lanes > 0) {
    return Math.min(30, Math.max(classWidth, lanes * 3.25));
  }
  return classWidth;
}

function clearanceFor(sourceLayer: string, className: string) {
  if (sourceLayer === 'railways') return 0.65;
  if (className === 'footway' || className === 'path' || className === 'cycleway') return 0.35;
  return 0.5;
}

function bridgeColor(sourceLayer: string) {
  if (sourceLayer === 'railways') return 0xaeb7bb;
  if (sourceLayer === 'paths') return 0xcbd2d3;
  return 0xdfe4e5;
}

function pathSurfaceColor(className: string, surface: string) {
  if (className === 'cycleway') return 0xc97872;
  if (surface === 'asphalt') return 0x9ea7a6;
  if (surface === 'gravel') return 0xc9b083;
  if (surface === 'dirt' || surface === 'ground') return 0xb59468;
  if (surface === 'sand') return 0xdfbf75;
  return 0xb8aa89;
}

function roadSurfaceColor(surface: string) {
  if (surface === 'gravel') return 0xd8cfbd;
  if (surface === 'unpaved') return 0xddd2bc;
  if (surface === 'dirt' || surface === 'ground') return 0xd4c09e;
  if (surface === 'sand') return 0xead9ad;
  if (surface === 'cobblestone') return 0x7d8281;
  if (surface === 'paving_stones') return 0x898e8c;
  if (surface === 'concrete') return 0xaeb5b4;
  return 0x697174;
}

function transportSurfaceColor(strip: BridgeSurfaceStrip) {
  return strip.sourceLayer === 'roads'
    ? roadSurfaceColor(strip.surface)
    : pathSurfaceColor(strip.className, strip.surface);
}

type BridgeCandidate = {
  sourceLayer: string;
  className: string;
  surface: string;
  bridgeName: string;
  points: Point[];
  width: number;
  structure: string;
  midpoint: Point;
  direction: [number, number];
  surfaceStrips: BridgeSurfaceStrip[];
};

function bridgeCandidate(
  sourceLayer: string,
  className: string,
  surface: string,
  bridgeName: string,
  points: Point[],
  width: number,
  structure: string,
): BridgeCandidate {
  const first = points[0];
  const last = points[points.length - 1];
  const length = Math.max(0.001, Math.hypot(last.x - first.x, last.z - first.z));
  return {
    sourceLayer,
    className,
    surface,
    bridgeName,
    points,
    width,
    structure,
    midpoint: points[Math.floor(points.length / 2)] ?? first,
    direction: [(last.x - first.x) / length, (last.z - first.z) / length],
    surfaceStrips: sourceLayer === 'roads' || sourceLayer === 'paths'
      ? [{ sourceLayer, offset: 0, width, className, surface }]
      : [],
  };
}

function sameBridgeCorridor(first: BridgeCandidate, second: BridgeCandidate) {
  if (first.bridgeName && second.bridgeName && first.bridgeName !== second.bridgeName) return false;
  const firstIsHeavyRail = first.sourceLayer === 'railways'
    && !['tram', 'light_rail', 'monorail'].includes(first.className);
  const secondIsHeavyRail = second.sourceLayer === 'railways'
    && !['tram', 'light_rail', 'monorail'].includes(second.className);
  // A road deck and its mapped foot/cycle ways are commonly separate OSM
  // ways, but visually they form one physical bridge. Keep rail bridges in
  // their own corridor so a nearby railway overpass is not absorbed.
  if (firstIsHeavyRail !== secondIsHeavyRail) return false;
  const directionAlignment = Math.abs(
    first.direction[0] * second.direction[0] + first.direction[1] * second.direction[1],
  );
  const sameName = Boolean(first.bridgeName && first.bridgeName === second.bridgeName);
  if (directionAlignment < (sameName ? 0.94 : 0.97)) return false;

  const directionX = first.direction[0];
  const directionZ = first.direction[1];
  const perpendicularX = -directionZ;
  const perpendicularZ = directionX;
  const extent = (candidate: BridgeCandidate, axisX: number, axisZ: number) => {
    const projections = candidate.points.map((point) => point.x * axisX + point.z * axisZ);
    return [Math.min(...projections), Math.max(...projections)] as const;
  };
  const intervalGap = (firstExtent: readonly [number, number], secondExtent: readonly [number, number]) => (
    Math.max(0, Math.max(firstExtent[0], secondExtent[0]) - Math.min(firstExtent[1], secondExtent[1]))
  );
  const alongGap = intervalGap(
    extent(first, directionX, directionZ),
    extent(second, directionX, directionZ),
  );
  const acrossGap = intervalGap(
    extent(first, perpendicularX, perpendicularZ),
    extent(second, perpendicularX, perpendicularZ),
  ) - (first.width + second.width) / 2;

  // Matching names help fragmented ways reconnect, but geometry must still
  // describe one nearby, parallel deck. This avoids merging separate spans
  // merely because they share a bridge name.
  return alongGap <= (sameName ? 20 : 8)
    && acrossGap <= (firstIsHeavyRail ? 2.5 : 4);
}

function candidateLength(candidate: BridgeCandidate) {
  const first = candidate.points[0];
  const last = candidate.points[candidate.points.length - 1];
  return Math.hypot(last.x - first.x, last.z - first.z);
}

function candidatePriority(candidate: BridgeCandidate) {
  if (candidate.sourceLayer === 'roads') return 0;
  if (candidate.sourceLayer === 'paths') return 1;
  if (['tram', 'light_rail', 'monorail'].includes(candidate.className)) return 2;
  return 3;
}

function mergeBridgeGroup(group: BridgeCandidate[]) {
  if (group.length === 1) return group[0];
  const spine = [...group].sort((first, second) => (
    candidatePriority(first) - candidatePriority(second)
    || candidateLength(second) - candidateLength(first)
  ))[0];
  const [directionX, directionZ] = spine.direction;
  const perpendicularX = -directionZ;
  const perpendicularZ = directionX;
  const origin = spine.midpoint;
  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  let minAcross = Number.POSITIVE_INFINITY;
  let maxAcross = Number.NEGATIVE_INFINITY;
  let lowestGround = Number.POSITIVE_INFINITY;
  let startSample = spine.points[0];
  let endSample = spine.points[spine.points.length - 1];

  for (const candidate of group) {
    for (const point of candidate.points) {
      const offsetX = point.x - origin.x;
      const offsetZ = point.z - origin.z;
      const along = offsetX * directionX + offsetZ * directionZ;
      const across = offsetX * perpendicularX + offsetZ * perpendicularZ;
      if (along < minAlong) {
        minAlong = along;
        startSample = point;
      }
      if (along > maxAlong) {
        maxAlong = along;
        endSample = point;
      }
      minAcross = Math.min(minAcross, across - candidate.width / 2);
      maxAcross = Math.max(maxAcross, across + candidate.width / 2);
      lowestGround = Math.min(lowestGround, point.ground);
    }
  }

  const centerAcross = (minAcross + maxAcross) / 2;
  const pointAt = (along: number, sample: Point): Point => ({
    x: origin.x + directionX * along + perpendicularX * centerAcross,
    z: origin.z + directionZ * along + perpendicularZ * centerAcross,
    elevation: sample.elevation,
    ground: sample.ground,
  });
  const start = pointAt(minAlong, startSample);
  const end = pointAt(maxAlong, endSample);
  const middle: Point = {
    x: (start.x + end.x) / 2,
    z: (start.z + end.z) / 2,
    elevation: (start.elevation + end.elevation) / 2 + 1.1,
    ground: lowestGround,
  };
  const structure = group.find((candidate) => candidate.structure.includes('arch'))?.structure
    ?? group.find((candidate) => candidate.structure !== 'yes')?.structure
    ?? spine.structure;
  const surfaceStrips: BridgeSurfaceStrip[] = [];
  for (const candidate of group.filter((item) => (
    item.sourceLayer === 'roads' || item.sourceLayer === 'paths'
  ))) {
    const offsetX = candidate.midpoint.x - origin.x;
    const offsetZ = candidate.midpoint.z - origin.z;
    const offset = offsetX * perpendicularX + offsetZ * perpendicularZ - centerAcross;
    const existing = surfaceStrips.find((strip) => (
      strip.sourceLayer === candidate.sourceLayer
      && Math.abs(strip.offset - offset) <= Math.max(strip.width, candidate.width) * 0.6
    ));
    if (existing) {
      existing.offset = (existing.offset + offset) / 2;
      existing.width = Math.max(existing.width, candidate.width);
      if (candidate.className === 'cycleway') {
        existing.className = candidate.className;
        existing.surface = candidate.surface;
      }
    } else {
      surfaceStrips.push({
        sourceLayer: candidate.sourceLayer,
        offset,
        width: candidate.width,
        className: candidate.className,
        surface: candidate.surface,
      });
    }
  }

  const roadStrip = surfaceStrips.find((strip) => strip.sourceLayer === 'roads');
  if (roadStrip) {
    const roadMin = roadStrip.offset - roadStrip.width / 2;
    const roadMax = roadStrip.offset + roadStrip.width / 2;
    for (const strip of surfaceStrips.filter((item) => item.sourceLayer === 'paths')) {
      const stripMin = strip.offset - strip.width / 2;
      const stripMax = strip.offset + strip.width / 2;
      if (strip.offset >= roadStrip.offset) {
        const gap = stripMin - roadMax;
        if (gap > 0 && gap <= 3) {
          strip.width = stripMax - roadMax;
          strip.offset = (stripMax + roadMax) / 2;
        }
      } else {
        const gap = roadMin - stripMax;
        if (gap > 0 && gap <= 3) {
          strip.width = roadMin - stripMin;
          strip.offset = (roadMin + stripMin) / 2;
        }
      }
    }
  }

  return {
    ...spine,
    sourceLayer: group.some((candidate) => candidate.sourceLayer === 'roads') ? 'roads' : spine.sourceLayer,
    points: [start, middle, end],
    width: Math.min(30, Math.max(spine.width, maxAcross - minAcross)),
    structure,
    midpoint: middle,
    surfaceStrips,
  };
}

function consolidateBridgeCandidates(candidates: BridgeCandidate[]) {
  const namedCandidates = candidates.filter((candidate) => candidate.bridgeName);
  const filteredCandidates = candidates.filter((candidate) => {
    if (candidate.bridgeName || candidate.sourceLayer !== 'paths' || candidateLength(candidate) >= 20) {
      return true;
    }
    // Tiny unnamed foot/cycle bridge ways at the end of a named bridge are
    // usually connector fragments within the same physical deck. Rendering
    // them independently creates narrow shards beyond the merged envelope.
    return !namedCandidates.some((named) => candidate.points.some((point) => (
      named.points.some((namedPoint) => Math.hypot(point.x - namedPoint.x, point.z - namedPoint.z) < 8)
    )));
  });
  const groups: BridgeCandidate[][] = [];
  for (const candidate of filteredCandidates) {
    const group = groups.find((existing) => (
      existing.some((member) => sameBridgeCorridor(member, candidate))
    ));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  return groups.map(mergeBridgeGroup);
}

function closestDeckElevation(point: Point, deck: BridgeCandidate) {
  let closestDistance = Number.POSITIVE_INFINITY;
  let elevation: number | undefined;
  for (let index = 1; index < deck.points.length; index += 1) {
    const start = deck.points[index - 1];
    const end = deck.points[index];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const progress = lengthSquared > 0
      ? Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
      : 0;
    const x = start.x + dx * progress;
    const z = start.z + dz * progress;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < closestDistance) {
      closestDistance = distance;
      elevation = start.elevation + (end.elevation - start.elevation) * progress;
    }
  }
  return { distance: closestDistance, elevation };
}

function snapConnectingWalkways(candidates: BridgeCandidate[]) {
  const mainDecks = candidates.filter((candidate) => candidateLength(candidate) >= 40);
  for (const connector of candidates) {
    if (connector.sourceLayer !== 'paths' || candidateLength(connector) > 35 || connector.points.length < 2) continue;
    for (const endpointIndex of [0, connector.points.length - 1]) {
      const endpoint = connector.points[endpointIndex];
      let bestDistance = Number.POSITIVE_INFINITY;
      let snappedElevation: number | undefined;
      for (const deck of mainDecks) {
        if (deck === connector) continue;
        const closest = closestDeckElevation(endpoint, deck);
        if (closest.distance <= deck.width / 2 + 4 && closest.distance < bestDistance) {
          bestDistance = closest.distance;
          snappedElevation = closest.elevation;
        }
      }
      if (snappedElevation !== undefined) endpoint.elevation = snappedElevation;
    }

    const first = connector.points[0];
    const last = connector.points[connector.points.length - 1];
    for (let index = 1; index < connector.points.length - 1; index += 1) {
      const progress = index / (connector.points.length - 1);
      connector.points[index].elevation = first.elevation
        + (last.elevation - first.elevation) * progress
        + Math.sin(progress * Math.PI) * 0.2;
    }
  }
  return candidates;
}

function addDeck(
  group: THREE.Group,
  start: Point,
  end: Point,
  width: number,
  thickness: number,
  material: THREE.Material,
  verticalOffset = 0,
) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.5) return;
  // Slight overlap prevents hairline seams where adjacent sloped deck
  // segments meet, especially at a pier or a sharp mapped vertex.
  const geometry = new THREE.BoxGeometry(width, thickness, length + 0.3);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    (start.x + end.x) / 2,
    (start.elevation + end.elevation) / 2 + verticalOffset,
    (start.z + end.z) / 2,
  );
  const forward = new THREE.Vector3(dx, end.elevation - start.elevation, dz).normalize();
  const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const orientation = new THREE.Matrix4().makeBasis(right, up, forward);
  mesh.quaternion.setFromRotationMatrix(orientation);
  group.add(mesh);
}

function addVerticalSupport(group: THREE.Group, point: Point, width: number, material: THREE.Material) {
  const height = point.elevation - point.ground;
  if (height < 1.2) return;
  const geometry = new THREE.CylinderGeometry(Math.max(0.22, width * 0.12), Math.max(0.3, width * 0.16), height, 6);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(point.x, point.ground + height / 2, point.z);
  group.add(mesh);
}

function addTower(group: THREE.Group, point: Point, width: number, material: THREE.Material, extraHeight: number) {
  const baseHeight = Math.max(0, point.elevation - point.ground);
  const height = baseHeight + extraHeight;
  const geometry = new THREE.CylinderGeometry(Math.max(0.28, width * 0.1), Math.max(0.36, width * 0.14), height, 6);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(point.x, point.ground + height / 2, point.z);
  group.add(mesh);
  return { ...point, elevation: point.elevation + extraHeight };
}

function addCable(group: THREE.Group, points: THREE.Vector3[], material: THREE.Material, radius = 0.12) {
  if (points.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 4), radius, 5, false);
  group.add(new THREE.Mesh(geometry, material));
}

function addSuspensionStructure(group: THREE.Group, points: Point[], width: number, material: THREE.Material) {
  if (points.length < 5) return;
  const firstTowerIndex = Math.floor(points.length / 3);
  const secondTowerIndex = Math.floor(points.length * 2 / 3);
  const towerHeight = Math.max(5, width * 1.4);
  const firstTower = addTower(group, points[firstTowerIndex], width, material, towerHeight);
  const secondTower = addTower(group, points[secondTowerIndex], width, material, towerHeight);
  for (const side of [-1, 1]) {
    const offset = side * width * 0.38;
    addCable(group, [
      new THREE.Vector3(points[0].x + offset, points[0].elevation + 1.2, points[0].z),
      new THREE.Vector3(firstTower.x + offset, firstTower.elevation, firstTower.z),
      new THREE.Vector3(points[Math.floor(points.length / 2)].x + offset, points[Math.floor(points.length / 2)].elevation + 1.4, points[Math.floor(points.length / 2)].z),
      new THREE.Vector3(secondTower.x + offset, secondTower.elevation, secondTower.z),
      new THREE.Vector3(points[points.length - 1].x + offset, points[points.length - 1].elevation + 1.2, points[points.length - 1].z),
    ], material, 0.13);
  }
}

function addCableStayedStructure(group: THREE.Group, points: Point[], width: number, material: THREE.Material) {
  if (points.length < 5) return;
  const towerIndex = Math.floor(points.length / 2);
  const tower = addTower(group, points[towerIndex], width, material, Math.max(5, width * 1.5));
  for (const side of [-1, 1]) {
    const offset = side * width * 0.38;
    for (const index of [1, Math.floor(points.length / 4), Math.floor(points.length * 3 / 4), points.length - 2]) {
      addCable(group, [
        new THREE.Vector3(tower.x + offset, tower.elevation, tower.z),
        new THREE.Vector3(points[index].x + offset, points[index].elevation + 0.25, points[index].z),
      ], material, 0.1);
    }
  }
}

function addFloatingStructure(group: THREE.Group, points: Point[], width: number, material: THREE.Material) {
  const step = Math.max(1, Math.floor(points.length / 6));
  for (let index = 0; index < points.length; index += step) {
    const point = points[index];
    const geometry = new THREE.CylinderGeometry(width * 0.45, width * 0.55, 0.65, 8);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(point.x, point.ground + 0.25, point.z);
    group.add(mesh);
  }
}

function addArch(group: THREE.Group, points: Point[], width: number, material: THREE.Material) {
  if (points.length < 2) return;
  const start = points[0];
  const end = points[points.length - 1];
  const middle = points[Math.floor(points.length / 2)];
  const archDepth = Math.min(8, Math.max(2.2, Math.abs(start.elevation - middle.elevation) * 0.72));
  for (const side of [-1, 1]) {
    const archPoints = points.map((point, index) => {
      const progress = index / (points.length - 1);
      const sag = Math.sin(progress * Math.PI) * archDepth;
      return new THREE.Vector3(point.x + side * width * 0.38, point.elevation - 0.35 - sag, point.z);
    });
    // A tube gives the approximate arched rib a readable silhouette at map scale.
    const curve = new THREE.CatmullRomCurve3(archPoints);
    const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), 0.22, 5, false);
    group.add(new THREE.Mesh(geometry, material));
  }
  addVerticalSupport(group, start, width, material);
  addVerticalSupport(group, end, width, material);
}

export class BridgeModelLayer implements CustomLayerInterface {
  readonly id = 'bridge-models-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private origin = REFERENCE;
  private originElevation = 0;
  private bridgeGroup?: THREE.Group;

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.scene.add(new THREE.HemisphereLight(0xfff5df, 0x46505b, 2));
    const sunlight = new THREE.DirectionalLight(0xffedc2, 2.5);
    sunlight.position.set(-80, 120, -60);
    this.scene.add(sunlight);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  updateBridges() {
    const map = this.map;
    if (!map) return;
    this.bridgeGroup?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (object.material instanceof THREE.Material) object.material.dispose();
      }
    });
    if (this.bridgeGroup) this.scene.remove(this.bridgeGroup);
    this.bridgeGroup = new THREE.Group();
    if (map.getZoom() < MIN_ZOOM) {
      map.triggerRepaint();
      return;
    }

    this.origin = map.getCenter();
    this.originElevation = map.queryTerrainElevation(this.origin) ?? 0;
    const units = maplibregl.MercatorCoordinate.fromLngLat(this.origin).meterInMercatorCoordinateUnits();
    const seen = new Set<string>();
    const candidates: BridgeCandidate[] = [];
    let count = 0;
    for (const sourceLayer of ['roads', 'paths', 'railways']) {
      for (const feature of map.querySourceFeatures('tampere', { sourceLayer })) {
        if (count >= MAX_BRIDGES) break;
        const properties = feature.properties ?? {};
        if (!properties.bridge || properties.bridge === 'no') continue;
        for (const coordinates of bridgeCoordinateParts(feature)) {
          if (coordinates.length < 2 || count >= MAX_BRIDGES) continue;
          const featureKey = `${sourceLayer}:${feature.id ?? ''}:${coordinates[0].join(',')}:${coordinates[coordinates.length - 1].join(',')}`;
          if (seen.has(featureKey)) continue;
          seen.add(featureKey);
          const first = metricPoint(coordinates[0], this.origin, units);
          const last = metricPoint(coordinates[coordinates.length - 1], this.origin, units);
          if (!first || !last) continue;
          const className = String(properties.class ?? 'road');
          const surface = String(properties.surface ?? '');
          const width = widthFor(sourceLayer, className, properties.width, properties.lanes);
          const clearance = clearanceFor(sourceLayer, className);
          const endpointA = map.queryTerrainElevation([coordinates[0][0], coordinates[0][1]]) ?? this.originElevation;
          const endpointB = map.queryTerrainElevation([coordinates[coordinates.length - 1][0], coordinates[coordinates.length - 1][1]]) ?? this.originElevation;
          const segmentDistances = coordinates.map((coordinatesAtPoint, index) => {
            if (index === 0) return 0;
            const previous = metricPoint(coordinates[index - 1], this.origin, units)!;
            const current = metricPoint(coordinatesAtPoint, this.origin, units)!;
            return Math.hypot(current.x - previous.x, current.z - previous.z);
          });
          const pathLength = Math.max(1, segmentDistances.reduce((total, distanceAtPoint) => total + distanceAtPoint, 0));
          const middleRise = sourceLayer === 'railways' ? 1.4 : sourceLayer === 'paths' ? 0.7 : 1.1;
          let travelled = 0;
          const bridgePoints: Point[] = coordinates.map((coordinatesAtPoint, index) => {
            const metric = metricPoint(coordinatesAtPoint, this.origin, units)!;
            if (index > 0) travelled += segmentDistances[index];
            const progress = Math.min(1, Math.max(0, travelled / pathLength));
            const terrain = map.queryTerrainElevation([coordinatesAtPoint[0], coordinatesAtPoint[1]]) ?? this.originElevation;
            const interpolated = endpointA + (endpointB - endpointA) * progress;
            const crownedDeck = interpolated + clearance + Math.sin(progress * Math.PI) * middleRise;
            return {
              x: metric.x,
              z: metric.z,
              // The bridge profile is continuous and deliberately independent
              // of noisy DEM samples beneath the span. It meets the approaches
              // at both ends and has a modest raised crown at mid-span.
              elevation: Math.max(terrain + clearance, crownedDeck) - this.originElevation,
              ground: terrain - this.originElevation,
            };
          });
          const structure = String(properties.bridge_structure ?? properties.bridge).toLowerCase();
          const bridgeName = String(properties.bridge_name ?? '').trim().toLowerCase();
          candidates.push(bridgeCandidate(
            sourceLayer,
            className,
            surface,
            bridgeName,
            bridgePoints,
            width,
            structure,
          ));
          count += 1;
        }
      }
    }

    const decks = snapConnectingWalkways(consolidateBridgeCandidates(candidates));
    for (const candidate of decks) {
        const material = new THREE.MeshLambertMaterial({
          color: bridgeColor(candidate.sourceLayer),
          flatShading: true,
        });
        for (let index = 1; index < candidate.points.length; index += 1) {
          addDeck(this.bridgeGroup, candidate.points[index - 1], candidate.points[index], candidate.width, 0.35, material);
        }
        if (candidate.structure.includes('arch')) {
          addArch(this.bridgeGroup, candidate.points, candidate.width, material);
        } else if (candidate.structure.includes('suspension')) {
          addSuspensionStructure(this.bridgeGroup, candidate.points, candidate.width, material);
        } else if (candidate.structure.includes('cable-stayed') || candidate.structure.includes('cable_stayed')) {
          addCableStayedStructure(this.bridgeGroup, candidate.points, candidate.width, material);
        } else if (candidate.structure.includes('floating')) {
          addFloatingStructure(this.bridgeGroup, candidate.points, candidate.width, material);
        } else if (candidate.structure.includes('beam') || candidate.structure.includes('girder') || candidate.structure.includes('cantilever')) {
          if (candidate.points.length > 3) {
            addVerticalSupport(this.bridgeGroup, candidate.points[Math.floor(candidate.points.length / 3)], candidate.width, material);
            addVerticalSupport(this.bridgeGroup, candidate.points[Math.floor(candidate.points.length * 2 / 3)], candidate.width, material);
          }
        } else if (candidate.points.length > 2) {
          addVerticalSupport(this.bridgeGroup, candidate.points[Math.floor(candidate.points.length / 2)], candidate.width, material);
        }
        const perpendicularX = -candidate.direction[1];
        const perpendicularZ = candidate.direction[0];
        for (const strip of candidate.surfaceStrips) {
          const stripMaterial = new THREE.MeshLambertMaterial({
            color: transportSurfaceColor(strip),
            flatShading: true,
          });
          const stripPoints = candidate.points.map((point) => ({
            ...point,
            x: point.x + perpendicularX * strip.offset,
            z: point.z + perpendicularZ * strip.offset,
          }));
          for (let index = 1; index < stripPoints.length; index += 1) {
            addDeck(
              this.bridgeGroup,
              stripPoints[index - 1],
              stripPoints[index],
              strip.width,
              0.04,
              stripMaterial,
              0.195,
            );
          }
        }
      }
    this.scene.add(this.bridgeGroup);
    map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.map || !this.renderer || !this.bridgeGroup || this.map.getZoom() < MIN_ZOOM) return;
    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.origin, this.originElevation);
    const scale = origin.meterInMercatorCoordinateUnits();
    this.sceneScale.set(scale, -scale, scale);
    this.sceneTransform.makeTranslation(origin.x, origin.y, origin.z).scale(this.sceneScale);
    this.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(this.sceneTransform);
    this.camera.projectionMatrix.copy(this.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove() {
    this.bridgeGroup?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (object.material instanceof THREE.Material) object.material.dispose();
      }
    });
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }
}
