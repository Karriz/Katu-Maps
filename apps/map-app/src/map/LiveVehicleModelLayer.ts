import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MaplibreMap } from 'maplibre-gl';
import { routeSectionPoses, type LiveVehicle } from './LiveVehicles';
import { createVehicleSection, dimensionsForMode, type BridgeDeckSource } from './TransitVehicleModelLayer';
import { CARTOON_SUN_COLOR, CARTOON_SUN_AZIMUTH_DEGREES, CARTOON_SUN_POLAR_DEGREES, sunCartesian } from './CartoonLighting';

const COLORS = { bus: '#1769e8', tram: '#8554c7', metro: '#e87524', train: '#21845b' };
const MODES = { bus: 'BUS', tram: 'TRAM', metro: 'SUBWAY', train: 'RAIL' };
const MAX_DETAILED_VEHICLES = 12;
const RECENTER_DISTANCE_METERS = 20_000;
const MAX_PITCH_RADIANS = 0.22;
const METERS_PER_DEGREE_LAT = Math.PI / 180 * 6_378_137;

export function vehicleSurfaceElevation(bridgeElevation: number | null | undefined,
  terrainElevation: () => number | null | undefined, fallback: number) {
  return bridgeElevation ?? terrainElevation() ?? fallback;
}

export function vehicleSlopePitch(ahead: number, behind: number, length: number) {
  return Math.max(-MAX_PITCH_RADIANS, Math.min(MAX_PITCH_RADIANS,
    -Math.atan2(ahead - behind, length)));
}

type VehicleModel = {
  root: THREE.Group;
  sections: THREE.Group[];
  connectors: THREE.Mesh[];
  targets: Array<{ position: THREE.Vector3; heading: number; pitch: number }>;
  kind: LiveVehicle['kind'];
  color: string;
  dimensions: ReturnType<typeof dimensionsForMode>;
  lastTerrainSample: number;
};

function disposeModel(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function sectionLayout(kind: LiveVehicle['kind']) {
  if (kind === 'tram') return { count: 3, gap: 0.8 };
  if (kind === 'train' || kind === 'metro') return { count: 5, gap: 1.2 };
  return { count: 1, gap: 0 };
}

/** Uses the same procedural sections as the detailed selected-trip model. */
export class LiveVehicleModelLayer implements CustomLayerInterface {
  readonly id = 'live-vehicle-models-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly projection = new THREE.Matrix4();
  private readonly transform = new THREE.Matrix4();
  private readonly transformScale = new THREE.Vector3();
  private readonly models = new Map<string, VehicleModel>();
  private origin = new maplibregl.LngLat(23.7609, 61.4981);
  private originElevation = 0;
  private hasOrigin = false;
  private lastFrameTime = 0;
  private darkMode = false;
  private currentVehicles: LiveVehicle[] = [];
  private bridgeDeckSource: BridgeDeckSource | null = null;

  setBridgeDeckSource(source: BridgeDeckSource | null) {
    this.bridgeDeckSource = source;
  }

  private sampleElevation(map: MaplibreMap, lng: number, lat: number, heading: number) {
    return vehicleSurfaceElevation(this.bridgeDeckSource?.deckPlacementAt(lng, lat, heading),
      () => map.queryTerrainElevation(new maplibregl.LngLat(lng, lat)), this.originElevation);
  }

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    this.clearModels();
    this.setVehicles(this.currentVehicles);
  }

  setVehicles(vehicles: LiveVehicle[]) {
    this.currentVehicles = vehicles;
    const map = this.map;
    if (!map) return new Set<string>();
    if (map.getZoom() < 15 || !vehicles.length) {
      this.clearModels();
      map.triggerRepaint();
      return new Set<string>();
    }
    const center = map.getCenter();
    const centreMercator = maplibregl.MercatorCoordinate.fromLngLat(center);
    if (!this.hasOrigin) {
      this.origin = center;
      this.originElevation = map.queryTerrainElevation(center) ?? 0;
      this.hasOrigin = true;
    } else {
      const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.origin);
      const metres = originMercator.meterInMercatorCoordinateUnits();
      if (Math.hypot((centreMercator.x - originMercator.x) / metres, (centreMercator.y - originMercator.y) / metres) > RECENTER_DISTANCE_METERS) {
        this.clearModels();
        this.origin = center;
        this.originElevation = map.queryTerrainElevation(center) ?? 0;
      }
    }
    const distance = (vehicle: LiveVehicle) => {
      const longitude = (vehicle.coordinates[0] - center.lng) * Math.cos(center.lat * Math.PI / 180);
      const latitude = vehicle.coordinates[1] - center.lat;
      return longitude * longitude + latitude * latitude;
    };
    const ranked = [...vehicles].sort((left, right) => distance(left) - distance(right)).slice(0, MAX_DETAILED_VEHICLES);
    const retained = new Set(ranked.map((vehicle) => vehicle.id));
    for (const [id, model] of this.models) {
      if (retained.has(id)) continue;
      this.scene.remove(model.root);
      disposeModel(model.root);
      this.models.delete(id);
    }
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.origin);
    const units = originMercator.meterInMercatorCoordinateUnits();
    for (const vehicle of ranked) {
      let model = this.models.get(vehicle.id);
      const color = vehicle.color ?? COLORS[vehicle.kind];
      if (model && (model.kind !== vehicle.kind || model.color !== color)) {
        this.scene.remove(model.root);
        disposeModel(model.root);
        this.models.delete(vehicle.id);
        model = undefined;
      }
      if (!model) {
        const root = new THREE.Group();
        const mode = MODES[vehicle.kind];
        const dimensions = dimensionsForMode(mode);
        const { count, gap } = sectionLayout(vehicle.kind);
        const sections: THREE.Group[] = [];
        const connectors: THREE.Mesh[] = [];
        const connectorMaterial = new THREE.MeshLambertMaterial({ color: vehicle.kind === 'tram' ? 0x32343b : 0x3a4245 });
        for (let index = 0; index < count - 1; index += 1) {
          const connector = new THREE.Mesh(new THREE.BoxGeometry(dimensions.width * (vehicle.kind === 'tram' ? 0.84 : 0.78),
            dimensions.height * (vehicle.kind === 'tram' ? 0.74 : 0.68), 1), connectorMaterial);
          connector.rotation.order = 'YXZ';
          root.add(connector);
          connectors.push(connector);
        }
        for (let index = 0; index < count; index += 1) {
          const section = createVehicleSection(dimensions, color, mode, index, count, this.darkMode);
          section.rotation.order = 'YXZ';
          root.add(section);
          sections.push(section);
        }
        this.scene.add(root);
        model = { root, sections, connectors, targets: [], kind: vehicle.kind, color, dimensions, lastTerrainSample: 0 };
        this.models.set(vehicle.id, model);
      }
      const layout = sectionLayout(vehicle.kind);
      const spacing = dimensionsForMode(MODES[vehicle.kind]).length + layout.gap;
      const poses = routeSectionPoses(vehicle.coordinates, vehicle.geometry, layout.count, spacing, vehicle.heading ?? 0);
      const sampleTerrain = performance.now() - model.lastTerrainSample >= 250 || !model.targets.length;
      model.targets = poses.map((pose, index) => {
        const coordinate = maplibregl.MercatorCoordinate.fromLngLat(pose.coordinates);
        const heading = pose.heading * Math.PI / 180;
        const prior = model.targets[index];
        if (!sampleTerrain && prior) return { position: new THREE.Vector3((coordinate.x - originMercator.x) / units,
          prior.position.y, (originMercator.y - coordinate.y) / units), heading, pitch: prior.pitch };
        const elevation = this.sampleElevation(map, pose.coordinates[0], pose.coordinates[1], heading);
        const halfLength = model.dimensions.length * 0.5;
        const eastStep = Math.sin(heading) * halfLength;
        const northStep = Math.cos(heading) * halfLength;
        const lngStep = eastStep / (METERS_PER_DEGREE_LAT * Math.max(0.1, Math.cos(pose.coordinates[1] * Math.PI / 180)));
        const latStep = northStep / METERS_PER_DEGREE_LAT;
        const ahead = this.sampleElevation(map, pose.coordinates[0] + lngStep, pose.coordinates[1] + latStep, heading);
        const behind = this.sampleElevation(map, pose.coordinates[0] - lngStep, pose.coordinates[1] - latStep, heading);
        const pitch = vehicleSlopePitch(ahead, behind, halfLength * 2);
        return { position: new THREE.Vector3((coordinate.x - originMercator.x) / units,
          elevation - this.originElevation, (originMercator.y - coordinate.y) / units),
        heading, pitch };
      });
      if (sampleTerrain) model.lastTerrainSample = performance.now();
      if (model.sections[0].position.lengthSq() === 0) model.sections.forEach((section, index) => {
        section.position.copy(model.targets[index].position);
        section.rotation.y = model.targets[index].heading;
        section.rotation.x = model.targets[index].pitch;
      });
    }
    map.triggerRepaint();
    return retained;
  }

  private clearModels() {
    for (const model of this.models.values()) {
      this.scene.remove(model.root);
      disposeModel(model.root);
    }
    this.models.clear();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.scene.add(new THREE.HemisphereLight(0xdce8f2, 0x627673, 2.2));
    const sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR, 2.8);
    const position = sunCartesian(CARTOON_SUN_AZIMUTH_DEGREES, CARTOON_SUN_POLAR_DEGREES);
    sunlight.position.set(position.x, position.y, position.z);
    this.scene.add(sunlight);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.map || !this.renderer || this.map.getZoom() < 15 || this.models.size === 0) return;
    const now = performance.now();
    const elapsed = this.lastFrameTime ? Math.min(0.1, (now - this.lastFrameTime) / 1000) : 1 / 60;
    this.lastFrameTime = now;
    const amount = 1 - Math.exp(-8 * elapsed);
    let moving = false;
    for (const model of this.models.values()) {
      model.sections.forEach((section, index) => {
        const target = model.targets[index];
        if (!target) return;
        if (section.position.distanceToSquared(target.position) > 0.01) moving = true;
        section.position.lerp(target.position, amount);
        const difference = Math.atan2(Math.sin(target.heading - section.rotation.y), Math.cos(target.heading - section.rotation.y));
        if (Math.abs(difference) > 0.001) moving = true;
        section.rotation.y += difference * amount;
        if (Math.abs(target.pitch - section.rotation.x) > 0.001) moving = true;
        section.rotation.x += (target.pitch - section.rotation.x) * amount;
      });
      model.connectors.forEach((connector, index) => {
        const first = model.sections[index];
        const second = model.sections[index + 1];
        const dx = second.position.x - first.position.x;
        const dz = second.position.z - first.position.z;
        connector.position.set((first.position.x + second.position.x) / 2,
          (first.position.y + second.position.y) / 2 + model.dimensions.height * 0.54,
          (first.position.z + second.position.z) / 2);
        connector.rotation.y = Math.atan2(dx, dz);
        connector.rotation.x = (first.rotation.x + second.rotation.x) * 0.5;
        connector.scale.z = Math.max(0.25, Math.hypot(dx, dz) - model.dimensions.length * 1.02);
      });
    }
    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.origin, this.originElevation);
    const scale = origin.meterInMercatorCoordinateUnits();
    this.transformScale.set(scale, -scale, scale);
    this.transform.makeTranslation(origin.x, origin.y, origin.z).scale(this.transformScale);
    this.projection.fromArray(options.defaultProjectionData.mainMatrix).multiply(this.transform);
    this.camera.projectionMatrix.copy(this.projection);
    this.camera.projectionMatrixInverse.copy(this.projection).invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (moving) this.map.triggerRepaint();
  }

  onRemove() {
    this.clearModels();
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }
}
