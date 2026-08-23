import maplibregl, {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type GeoJSONSource,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';

// Power features are available from z10, and the map opens at z11. Keep the
// infrastructure visible at the default view while still avoiding the broad
// overview zooms.
const MIN_ZOOM = 10;
const MAX_POWER_TOWERS = 180;
const MAX_LANDMARKS = 160;
const MAX_TUNNEL_ENTRANCES = 120;
const REFERENCE = new maplibregl.LngLat(23.7609, 61.4981);

type SourceFeature = ReturnType<MaplibreMap['querySourceFeatures']>[number];
type Point = { x: number; z: number; ground: number };
type Direction = { x: number; z: number };
type LineSegment = { start: Direction; end: Direction };
type TunnelEndpoint = {
  point: Point;
  direction: Direction;
  sourceLayer: string;
  className: string;
  distance: number;
};
type TransportEndpoint = {
  point: Direction;
  sourceLayer: string;
};
type TunnelEntranceFeature = {
  type: 'Feature';
  properties: { transport: 'road' | 'railway' };
  geometry: { type: 'LineString'; coordinates: number[][] };
};

function sourceFeatures(map: MaplibreMap, sourceLayer: string): SourceFeature[] {
  try {
    return map.querySourceFeatures('tampere', { sourceLayer });
  } catch (error) {
    console.warn(`Could not query optional source layer ${sourceLayer}`, error);
    return [];
  }
}

function parts(feature: SourceFeature): number[][][] {
  const geometry = feature.geometry;
  if (geometry?.type === 'Point') return [[geometry.coordinates as number[]]];
  if (geometry?.type === 'MultiPoint') {
    return (geometry.coordinates as number[][]).map((coordinate) => [coordinate]);
  }
  if (geometry?.type === 'LineString') return [geometry.coordinates as number[][]];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates as number[][][];
  if (geometry?.type === 'Polygon') return geometry.coordinates as number[][][];
  if (geometry?.type === 'MultiPolygon') {
    return (geometry.coordinates as number[][][][]).flat();
  }
  return [];
}

function metricPoint(coordinates: number[], origin: maplibregl.LngLat, units: number) {
  if (coordinates.length < 2) return undefined;
  const point = maplibregl.MercatorCoordinate.fromLngLat([coordinates[0], coordinates[1]]);
  const originPoint = maplibregl.MercatorCoordinate.fromLngLat(origin);
  return { x: (point.x - originPoint.x) / units, z: (originPoint.y - point.y) / units };
}

function featurePoint(coordinate: number[], map: MaplibreMap, origin: maplibregl.LngLat, units: number): Point | undefined {
  const metric = metricPoint(coordinate, origin, units);
  if (!metric) return undefined;
  const elevation = map.queryTerrainElevation([coordinate[0], coordinate[1]]) ?? 0;
  const originElevation = map.queryTerrainElevation(origin) ?? 0;
  return { ...metric, ground: elevation - originElevation };
}

function disposeGroup(group: THREE.Group | undefined) {
  group?.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (object.material instanceof THREE.Material) object.material.dispose();
    }
  });
}

function nearestLineDirection(point: Point, segments: LineSegment[]) {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestDirection: Direction | undefined;
  for (const segment of segments) {
    const dx = segment.end.x - segment.start.x;
    const dz = segment.end.z - segment.start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 0.01) continue;
    const progress = Math.min(1, Math.max(0, (
      (point.x - segment.start.x) * dx + (point.z - segment.start.z) * dz
    ) / lengthSquared));
    const closestX = segment.start.x + dx * progress;
    const closestZ = segment.start.z + dz * progress;
    const distance = Math.hypot(point.x - closestX, point.z - closestZ);
    if (distance < nearestDistance) {
      const length = Math.sqrt(lengthSquared);
      nearestDistance = distance;
      nearestDirection = { x: dx / length, z: dz / length };
    }
  }
  return nearestDistance <= 40 ? nearestDirection : undefined;
}

function distanceToSegments(point: Direction, segments: LineSegment[]) {
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const dx = segment.end.x - segment.start.x;
    const dz = segment.end.z - segment.start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 0.01) continue;
    const progress = Math.min(1, Math.max(0, (
      (point.x - segment.start.x) * dx + (point.z - segment.start.z) * dz
    ) / lengthSquared));
    nearestDistance = Math.min(nearestDistance, Math.hypot(
      point.x - (segment.start.x + dx * progress),
      point.z - (segment.start.z + dz * progress),
    ));
  }
  return nearestDistance;
}

function terrainRisesIntoTunnel(
  map: MaplibreMap,
  endpoint: TunnelEndpoint,
  origin: maplibregl.LngLat,
  units: number,
  originElevation: number,
  minimumRise: number,
) {
  const originCoordinate = maplibregl.MercatorCoordinate.fromLngLat(origin);
  let maximumRise = Number.NEGATIVE_INFINITY;
  let sampled = false;
  for (const distance of [8, 16, 24]) {
    const sampleCoordinate = new maplibregl.MercatorCoordinate(
      originCoordinate.x + (endpoint.point.x + endpoint.direction.x * distance) * units,
      originCoordinate.y - (endpoint.point.z + endpoint.direction.z * distance) * units,
      0,
    );
    const elevation = map.queryTerrainElevation(sampleCoordinate.toLngLat());
    if (elevation === null) continue;
    sampled = true;
    maximumRise = Math.max(
      maximumRise,
      elevation - originElevation - endpoint.point.ground,
    );
  }
  // Keep entrance markers available if terrain rendering has been disabled.
  // When DEM samples exist, require the tunnel axis to enter rising ground.
  return !sampled || maximumRise >= minimumRise;
}

function tunnelEntranceFeature(
  endpoint: TunnelEndpoint,
  origin: maplibregl.LngLat,
  units: number,
): TunnelEntranceFeature {
  const originCoordinate = maplibregl.MercatorCoordinate.fromLngLat(origin);
  const halfLength = endpoint.sourceLayer === 'railways'
    ? 5
    : ['motorway', 'trunk'].includes(endpoint.className) ? 7 : 6;
  const right = { x: endpoint.direction.z, z: -endpoint.direction.x };
  const coordinate = (side: number) => {
    const point = new maplibregl.MercatorCoordinate(
      originCoordinate.x + (endpoint.point.x + right.x * halfLength * side) * units,
      originCoordinate.y - (endpoint.point.z + right.z * halfLength * side) * units,
      0,
    ).toLngLat();
    return [point.lng, point.lat];
  };
  return {
    type: 'Feature',
    properties: { transport: endpoint.sourceLayer === 'railways' ? 'railway' : 'road' },
    geometry: { type: 'LineString', coordinates: [coordinate(-1), coordinate(1)] },
  };
}

function addTransmissionTower(
  group: THREE.Group,
  point: Point,
  heightValue: unknown,
  material: THREE.Material,
  lineDirection?: Direction,
) {
  const taggedHeight = Number(heightValue);
  const height = Number.isFinite(taggedHeight) && taggedHeight > 4
    ? Math.min(taggedHeight, 80)
    : 24;
  const orientation = lineDirection
    ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(lineDirection.z, 0, -lineDirection.x),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(lineDirection.x, 0, lineDirection.z),
      ))
    : undefined;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 1.65, height, 4),
    material,
  );
  shaft.position.set(point.x, point.ground + height / 2 + 0.08, point.z);
  if (orientation) shaft.quaternion.copy(orientation);
  group.add(shaft);

  const addCrossbar = (width: number, elevation: number, thickness: number) => {
    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(width, thickness, Math.max(0.28, thickness * 0.8)),
      material,
    );
    crossbar.position.set(point.x, point.ground + height * elevation, point.z);
    if (orientation) crossbar.quaternion.copy(orientation);
    group.add(crossbar);
  };
  addCrossbar(7.5, 0.62, 0.38);
  addCrossbar(9, 0.77, 0.42);
  addCrossbar(6.8, 0.9, 0.36);
}

function representativePoint(
  coordinatePart: number[][],
  map: MaplibreMap,
  origin: maplibregl.LngLat,
  units: number,
) {
  if (coordinatePart.length === 0) return undefined;
  if (coordinatePart.length === 1) return featurePoint(coordinatePart[0], map, origin, units);
  const metricPoints = coordinatePart
    .map((coordinate) => metricPoint(coordinate, origin, units))
    .filter((point): point is Direction => point !== undefined);
  if (metricPoints.length === 0) return undefined;
  const center = metricPoints.reduce(
    (total, point) => ({ x: total.x + point.x, z: total.z + point.z }),
    { x: 0, z: 0 },
  );
  center.x /= metricPoints.length;
  center.z /= metricPoints.length;
  const sample = coordinatePart[Math.floor(coordinatePart.length / 2)];
  const elevation = map.queryTerrainElevation([sample[0], sample[1]]) ?? 0;
  const originElevation = map.queryTerrainElevation(origin) ?? 0;
  return { ...center, ground: elevation - originElevation };
}

function addWindTurbine(
  group: THREE.Group,
  point: Point,
  heightValue: unknown,
  material: THREE.Material,
) {
  const taggedHeight = Number(heightValue);
  const height = Number.isFinite(taggedHeight) && taggedHeight > 20
    ? Math.min(taggedHeight, 180)
    : 45;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 2.1, height, 10), material);
  tower.position.set(point.x, point.ground + height / 2, point.z);
  group.add(tower);
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.2, 2.4), material);
  nacelle.position.set(point.x, point.ground + height + 0.6, point.z);
  group.add(nacelle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.6, 10), material);
  hub.rotateX(Math.PI / 2);
  hub.position.set(point.x, point.ground + height, point.z + 1.9);
  group.add(hub);
  const bladeLength = Math.min(42, height * 0.42);
  for (let index = 0; index < 3; index += 1) {
    const angle = index * Math.PI * 2 / 3;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(bladeLength, 0.65, 0.3),
      material,
    );
    blade.rotation.z = angle;
    blade.position.set(
      point.x + Math.cos(angle) * bladeLength / 2,
      point.ground + height + Math.sin(angle) * bladeLength / 2,
      point.z + 2.1,
    );
    group.add(blade);
  }
}

function addLandmark(
  group: THREE.Group,
  point: Point,
  className: string,
  heightValue: unknown,
  material: THREE.Material,
) {
  const taggedHeight = Number(heightValue);
  const defaultHeight = className === 'chimney' ? 8.75
    : className === 'tower' || className === 'communications_tower' ? 15
      : className === 'water_tower' ? 12 : 7;
  const height = Number.isFinite(taggedHeight) && taggedHeight > 3
    ? Math.min(taggedHeight, 120)
    : defaultHeight;
  if (className === 'chimney') {
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 2.5, height, 10), material);
    chimney.position.set(point.x, point.ground + height / 2, point.z);
    group.add(chimney);
    return;
  }
  if (className === 'water_tower') {
    const tankRadius = Math.min(4.2, Math.max(1.8, height * 0.18));
    const tankRadiusY = Math.min(2.85, height * 0.16);
    const stemHeight = Math.max(height * 0.5, height - tankRadiusY * 2);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, stemHeight, 10), material);
    stem.position.set(point.x, point.ground + stemHeight / 2, point.z);
    group.add(stem);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(tankRadius, 10, 7), material);
    tank.scale.y = tankRadiusY / tankRadius;
    tank.position.set(point.x, point.ground + height - tankRadiusY, point.z);
    group.add(tank);
    return;
  }
  if (className === 'tower' || className === 'communications_tower') {
    const antennaHeight = Math.min(5, Math.max(1.5, height * 0.14));
    const towerHeight = height - antennaHeight;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 2.1, towerHeight, 4), material);
    tower.position.set(point.x, point.ground + towerHeight / 2, point.z);
    group.add(tower);
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, antennaHeight, 6), material,
    );
    antenna.position.set(point.x, point.ground + towerHeight + antennaHeight / 2, point.z);
    group.add(antenna);
    return;
  }
  const radius = className === 'gasometer' || className === 'storage_tank' ? 5 : 3.6;
  const roofHeight = className === 'silo' ? Math.min(2.8, height * 0.2) : 0;
  const bodyHeight = height - roofHeight;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, bodyHeight, 12), material);
  body.position.set(point.x, point.ground + bodyHeight / 2, point.z);
  group.add(body);
  if (className === 'silo') {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(radius, roofHeight, 12), material);
    roof.position.set(point.x, point.ground + bodyHeight + roofHeight / 2, point.z);
    group.add(roof);
  }
}

export class InfrastructureModelLayer implements CustomLayerInterface {
  readonly id = 'infrastructure-models-3d';
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
  private group?: THREE.Group;
  private tunnelEntranceDataKey = '[]';

  private setTunnelEntrances(features: TunnelEntranceFeature[]) {
    const dataKey = JSON.stringify(features);
    if (dataKey === this.tunnelEntranceDataKey) return;
    const source = this.map?.getSource('tunnel-entrances') as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: 'FeatureCollection', features });
    this.tunnelEntranceDataKey = dataKey;
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.scene.add(new THREE.HemisphereLight(0xfff5df, 0x46505b, 2));
    const light = new THREE.DirectionalLight(0xffedc2, 2.4);
    light.position.set(-80, 120, -60);
    this.scene.add(light);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  updateInfrastructure() {
    const map = this.map;
    if (!map) return;
    disposeGroup(this.group);
    if (this.group) this.scene.remove(this.group);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    if (map.getZoom() < MIN_ZOOM) {
      this.setTunnelEntrances([]);
      map.triggerRepaint();
      return;
    }
    this.origin = map.getCenter();
    this.originElevation = map.queryTerrainElevation(this.origin) ?? 0;
    const units = maplibregl.MercatorCoordinate.fromLngLat(this.origin).meterInMercatorCoordinateUnits();
    const powerMaterial = new THREE.MeshLambertMaterial({ color: 0x555b58, flatShading: true });
    const landmarkMaterial = new THREE.MeshLambertMaterial({ color: 0x9a9286, flatShading: true });
    const chimneyMaterial = new THREE.MeshLambertMaterial({ color: 0xb8b2a8, flatShading: true });
    const turbineMaterial = new THREE.MeshLambertMaterial({ color: 0xd8d9d5, flatShading: true });
    const powerFeatures = sourceFeatures(map, 'power');
    const lineSegments: LineSegment[] = [];
    for (const feature of powerFeatures) {
      if (String(feature.properties?.class ?? '') !== 'line') continue;
      for (const coordinatePart of parts(feature)) {
        const linePoints = coordinatePart
          .map((coordinate) => metricPoint(coordinate, this.origin, units))
          .filter((point): point is Direction => point !== undefined);
        for (let index = 1; index < linePoints.length; index += 1) {
          lineSegments.push({ start: linePoints[index - 1], end: linePoints[index] });
        }
      }
    }
    const towerCandidates: Array<{
      point: Point;
      height: unknown;
      distance: number;
    }> = [];
    const seenTowers = new Set<string>();
    for (const feature of powerFeatures) {
      const className = String(feature.properties?.class ?? '');
      if (className !== 'tower') continue;
      for (const coordinatePart of parts(feature)) {
        const point = featurePoint(coordinatePart[0], map, this.origin, units);
        if (!point) continue;
        const key = `${point.x.toFixed(1)}:${point.z.toFixed(1)}`;
        if (seenTowers.has(key)) continue;
        seenTowers.add(key);
        towerCandidates.push({
          point,
          height: feature.properties?.height,
          distance: Math.hypot(point.x, point.z),
        });
      }
    }
    towerCandidates
      .sort((first, second) => first.distance - second.distance)
      .slice(0, MAX_POWER_TOWERS)
      .forEach((candidate) => addTransmissionTower(
        this.group!,
        candidate.point,
        candidate.height,
        powerMaterial,
        nearestLineDirection(candidate.point, lineSegments),
      ));

    if (map.getZoom() >= 12) {
      const seenLandmarks = new Set<string>();
      const landmarkCandidates: Array<{
        point: Point;
        className: string;
        height: unknown;
        isWindTurbine: boolean;
        distance: number;
      }> = [];
      for (const feature of powerFeatures) {
        const properties = feature.properties ?? {};
        if (String(properties.class ?? '') !== 'generator'
          || !String(properties.generator_source ?? '').toLowerCase().split(';').includes('wind')) continue;
        for (const coordinatePart of parts(feature)) {
          const point = representativePoint(coordinatePart, map, this.origin, units);
          if (!point) continue;
          const key = `wind:${point.x.toFixed(1)}:${point.z.toFixed(1)}`;
          if (seenLandmarks.has(key)) continue;
          seenLandmarks.add(key);
          landmarkCandidates.push({
            point,
            className: 'wind_turbine',
            height: properties.height,
            isWindTurbine: true,
            distance: Math.hypot(point.x, point.z),
          });
        }
      }
      for (const feature of sourceFeatures(map, 'landmarks')) {
        const properties = feature.properties ?? {};
        const className = String(properties.class ?? '');
        for (const coordinatePart of parts(feature)) {
          const point = representativePoint(coordinatePart, map, this.origin, units);
          if (!point) continue;
          const key = `${className}:${point.x.toFixed(1)}:${point.z.toFixed(1)}`;
          if (seenLandmarks.has(key)) continue;
          seenLandmarks.add(key);
          landmarkCandidates.push({
            point,
            className,
            height: properties.height,
            isWindTurbine: false,
            distance: Math.hypot(point.x, point.z),
          });
        }
      }
      landmarkCandidates
        .sort((first, second) => first.distance - second.distance)
        .slice(0, MAX_LANDMARKS)
        .forEach((candidate) => {
          if (candidate.isWindTurbine) {
            addWindTurbine(this.group!, candidate.point, candidate.height, turbineMaterial);
          } else {
            addLandmark(
              this.group!,
              candidate.point,
              candidate.className,
              candidate.height,
              candidate.className === 'chimney' ? chimneyMaterial : landmarkMaterial,
            );
          }
        });
    }

    const tunnelEntranceFeatures: TunnelEntranceFeature[] = [];
    if (map.getZoom() >= 13) {
      const tunnelEndpoints: TunnelEndpoint[] = [];
      const surfaceEndpoints: TransportEndpoint[] = [];
      const seenTunnelParts = new Set<string>();
      for (const sourceLayer of ['roads', 'railways']) {
        for (const feature of sourceFeatures(map, sourceLayer)) {
          const properties = feature.properties ?? {};
          const tunnel = String(properties.tunnel ?? '').toLowerCase();
          const covered = String(properties.covered ?? '').toLowerCase();
          const isCovered = Boolean(covered) && !['no', 'false'].includes(covered);
          const isTunnel = Boolean(tunnel)
            && !['no', 'false', 'culvert', 'building_passage'].includes(tunnel)
            && !isCovered;
          const className = String(properties.class ?? '');
          for (const coordinatePart of parts(feature)) {
            if (coordinatePart.length < 2) continue;
            if (!isTunnel) {
              const first = metricPoint(coordinatePart[0], this.origin, units);
              const last = metricPoint(coordinatePart[coordinatePart.length - 1], this.origin, units);
              if (first) surfaceEndpoints.push({ point: first, sourceLayer });
              if (last) surfaceEndpoints.push({ point: last, sourceLayer });
              continue;
            }
            const first = featurePoint(coordinatePart[0], map, this.origin, units);
            const firstAdjacent = featurePoint(coordinatePart[1], map, this.origin, units);
            const last = featurePoint(
              coordinatePart[coordinatePart.length - 1], map, this.origin, units,
            );
            const lastAdjacent = featurePoint(
              coordinatePart[coordinatePart.length - 2], map, this.origin, units,
            );
            if (!first || !firstAdjacent || !last || !lastAdjacent) continue;
            const endKeys = [
              `${first.x.toFixed(1)}:${first.z.toFixed(1)}`,
              `${last.x.toFixed(1)}:${last.z.toFixed(1)}`,
            ].sort();
            const partKey = `${sourceLayer}:${endKeys[0]}:${endKeys[1]}`;
            if (seenTunnelParts.has(partKey)) continue;
            seenTunnelParts.add(partKey);
            const endpointData = [
              { point: first, adjacent: firstAdjacent },
              { point: last, adjacent: lastAdjacent },
            ];
            for (const endpoint of endpointData) {
              const dx = endpoint.adjacent.x - endpoint.point.x;
              const dz = endpoint.adjacent.z - endpoint.point.z;
              const length = Math.hypot(dx, dz);
              if (length < 0.1) continue;
              tunnelEndpoints.push({
                point: endpoint.point,
                direction: { x: dx / length, z: dz / length },
                sourceLayer,
                className,
                distance: Math.hypot(endpoint.point.x, endpoint.point.z),
              });
            }
          }
        }
      }

      const endpointBuckets: TunnelEndpoint[][] = [];
      for (const endpoint of tunnelEndpoints) {
        const bucket = endpointBuckets.find((candidates) => candidates.some((candidate) => (
          candidate.sourceLayer === endpoint.sourceLayer
          && Math.hypot(
            candidate.point.x - endpoint.point.x,
            candidate.point.z - endpoint.point.z,
          ) <= 4
        )));
        if (bucket) bucket.push(endpoint);
        else endpointBuckets.push([endpoint]);
      }

      const retainingWallSegments: LineSegment[] = [];
      for (const feature of sourceFeatures(map, 'barriers')) {
        if (String(feature.properties?.class ?? '') !== 'retaining_wall') continue;
        for (const coordinatePart of parts(feature)) {
          const wallPoints = coordinatePart
            .map((coordinate) => metricPoint(coordinate, this.origin, units))
            .filter((point): point is Direction => point !== undefined);
          for (let index = 1; index < wallPoints.length; index += 1) {
            retainingWallSegments.push({ start: wallPoints[index - 1], end: wallPoints[index] });
          }
        }
      }

      const entranceEndpoints = endpointBuckets
        .filter((bucket) => bucket.length === 1)
        .map((bucket) => bucket[0])
        .filter((endpoint) => surfaceEndpoints.some((surfaceEndpoint) => (
          surfaceEndpoint.sourceLayer === endpoint.sourceLayer
          && Math.hypot(
            surfaceEndpoint.point.x - endpoint.point.x,
            surfaceEndpoint.point.z - endpoint.point.z,
          ) <= 5
        )))
        .filter((endpoint) => terrainRisesIntoTunnel(
          map,
          endpoint,
          this.origin,
          units,
          this.originElevation,
          distanceToSegments(endpoint.point, retainingWallSegments) <= 12 ? 0.75 : 1.5,
        ))
        .sort((first, second) => first.distance - second.distance)
        .slice(0, MAX_TUNNEL_ENTRANCES);
      tunnelEntranceFeatures.push(...entranceEndpoints.map((endpoint) => (
        tunnelEntranceFeature(endpoint, this.origin, units)
      )));
    }
    this.setTunnelEntrances(tunnelEntranceFeatures);
    map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.map || !this.renderer || !this.group || this.map.getZoom() < MIN_ZOOM) return;
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
    disposeGroup(this.group);
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }
}
