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
  CARTOON_SUN_COLOR,
} from './CartoonLighting';
import type { TransitVehiclePose } from './TransitStopsLayer';

const MODEL_MIN_ZOOM = 12;
const RECENTER_DISTANCE_METERS = 20_000;

type VehicleDimensions = {
  length: number;
  width: number;
  height: number;
};

type LocalPartPose = {
  position: THREE.Vector3;
  heading: number;
};

function dimensionsForMode(mode: string): VehicleDimensions {
  if (mode === 'TRAM') return { length: 8.4, width: 2.65, height: 3.35 };
  if (mode === 'SUBWAY') return { length: 16, width: 2.85, height: 3.55 };
  if (['RAIL', 'SUBURBAN', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL'].includes(mode)) {
    return { length: 18, width: 2.95, height: 3.8 };
  }
  return { length: 12, width: 2.55, height: 3.25 };
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function addBusWheel(parent: THREE.Object3D, x: number, z: number) {
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.2, 12),
    new THREE.MeshLambertMaterial({ color: 0x202528 }),
  );
  tire.rotation.z = Math.PI / 2;
  tire.position.set(x, 0.42, z);
  parent.add(tire);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.215, 12),
    new THREE.MeshLambertMaterial({ color: 0x879093 }),
  );
  hub.rotation.z = Math.PI / 2;
  hub.position.copy(tire.position);
  parent.add(hub);
}

function roundedShellGeometry(width: number, height: number, length: number) {
  const radius = Math.min(0.32, width * 0.13, height * 0.13);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height - radius);
  shape.quadraticCurveTo(width / 2, height, width / 2 - radius, height);
  shape.lineTo(-width / 2 + radius, height);
  shape.quadraticCurveTo(-width / 2, height, -width / 2, height - radius);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
    curveSegments: 3,
  });
  geometry.translate(0, 0, -length / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function createTramSection(
  dimensions: VehicleDimensions,
  color: string,
  index: number,
  sectionCount: number,
) {
  const root = new THREE.Group();
  const bodyColor = new THREE.Color(color);
  const skirtColor = bodyColor.clone().multiplyScalar(0.72);
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: bodyColor });
  const skirtMaterial = new THREE.MeshLambertMaterial({ color: skirtColor });
  const glassMaterial = new THREE.MeshLambertMaterial({ color: 0x172d39 });
  const collarMaterial = new THREE.MeshLambertMaterial({ color: 0x30373b });
  const roofMaterial = new THREE.MeshLambertMaterial({ color: 0xabb5b6 });
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1bd });
  const { length, width, height } = dimensions;
  const floor = 0.22;
  const shellHeight = height - 0.28;
  const rearCab = index === 0;
  const frontCab = index === sectionCount - 1;

  const shell = new THREE.Mesh(
    roundedShellGeometry(width, shellHeight, length * 0.97),
    bodyMaterial,
  );
  shell.position.y = floor;
  root.add(shell);

  // A low uninterrupted skirt hides the bogies and gives the tram the clean,
  // low-floor silhouette of a modern city vehicle.
  addBox(root, [width * 1.01, 0.62, length * 0.98], [0, floor + 0.31, 0], skirtMaterial);

  const windowY = floor + shellHeight * 0.63;
  const windowHeight = shellHeight * 0.38;
  const windowLength = length * 0.78;
  addBox(root, [0.035, windowHeight, windowLength], [width * 0.501, windowY, 0], glassMaterial);
  addBox(root, [0.035, windowHeight, windowLength], [-width * 0.501, windowY, 0], glassMaterial);

  // Internal ends get a near-full-height flexible collar, making the three
  // independently turning sections read as one articulated tram.
  if (index > 0) {
    addBox(root, [width * 0.88, height * 0.76, 0.12], [0, floor + height * 0.48, -length * 0.488], collarMaterial);
  }
  if (index < sectionCount - 1) {
    addBox(root, [width * 0.88, height * 0.76, 0.12], [0, floor + height * 0.48, length * 0.488], collarMaterial);
  }

  for (const direction of [-1, 1] as const) {
    const isCab = direction < 0 ? rearCab : frontCab;
    if (!isCab) continue;
    const windshield = addBox(
      root,
      [width * 0.74, shellHeight * 0.43, 0.055],
      [0, floor + shellHeight * 0.66, direction * length * 0.488],
      glassMaterial,
    );
    windshield.rotation.x = -direction * 0.14;
    for (const x of [-width * 0.31, width * 0.31]) {
      addBox(
        root,
        [0.2, 0.13, 0.065],
        [x, floor + 0.72, direction * length * 0.493],
        lightMaterial,
      );
    }
  }

  // Roof equipment stays low and neutral so the colored shell remains the
  // dominant shape from the map camera.
  addBox(
    root,
    [width * 0.48, 0.12, length * (index === 1 ? 0.42 : 0.24)],
    [0, floor + shellHeight + 0.06, 0],
    roofMaterial,
  );

  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x21332e,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), shadowMaterial);
  shadow.scale.set(width * 0.67, length * 0.45, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.035;
  root.add(shadow);
  return root;
}

function createVehicleSection(
  dimensions: VehicleDimensions,
  color: string,
  mode: string,
  index: number,
  sectionCount: number,
) {
  if (mode === 'TRAM') {
    return createTramSection(dimensions, color, index, sectionCount);
  }
  const root = new THREE.Group();
  const bodyColor = new THREE.Color(color);
  const skirtColor = bodyColor.clone().multiplyScalar(0.7);
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: bodyColor });
  const skirtMaterial = new THREE.MeshLambertMaterial({ color: skirtColor });
  const glassMaterial = new THREE.MeshLambertMaterial({ color: 0x172d39 });
  const collarMaterial = new THREE.MeshLambertMaterial({ color: 0x3a4245 });
  const roofMaterial = new THREE.MeshLambertMaterial({ color: 0xaeb7b7 });
  const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1bd });
  const tailLightMaterial = new THREE.MeshBasicMaterial({ color: 0xb91c1c });
  const { length, width, height } = dimensions;
  const isBus = mode === 'BUS' || mode === 'TRANSIT';
  const floor = isBus ? 0.3 : 0.26;
  const shellHeight = height - floor - 0.08;

  const shell = new THREE.Mesh(
    roundedShellGeometry(width, shellHeight, length * 0.985),
    bodyMaterial,
  );
  shell.position.y = floor;
  root.add(shell);
  addBox(
    root,
    [width * 1.01, isBus ? 0.7 : 0.58, length * 0.99],
    [0, floor + (isBus ? 0.35 : 0.29), 0],
    skirtMaterial,
  );
  if (isBus) {
    for (const z of [-length * 0.31, length * 0.31]) {
      addBusWheel(root, -width * 0.51, z);
      addBusWheel(root, width * 0.51, z);
    }
  }

  const windowHeight = shellHeight * (isBus ? 0.42 : 0.38);
  const windowY = floor + shellHeight * (isBus ? 0.66 : 0.64);
  const windowLength = length * (isBus ? 0.76 : 0.82);
  addBox(root, [0.035, windowHeight, windowLength], [width * 0.501, windowY, 0], glassMaterial);
  addBox(root, [0.035, windowHeight, windowLength], [-width * 0.501, windowY, 0], glassMaterial);

  if (!isBus && index > 0) {
    addBox(root, [width * 0.84, height * 0.7, 0.12], [0, floor + height * 0.45, -length * 0.495], collarMaterial);
  }
  if (!isBus && index < sectionCount - 1) {
    addBox(root, [width * 0.84, height * 0.7, 0.12], [0, floor + height * 0.45, length * 0.495], collarMaterial);
  }

  const exposedEnds = isBus
    ? [{ direction: -1 as const, cab: false }, { direction: 1 as const, cab: true }]
    : [
        ...(index === 0 ? [{ direction: -1 as const, cab: true }] : []),
        ...(index === sectionCount - 1 ? [{ direction: 1 as const, cab: true }] : []),
      ];
  exposedEnds.forEach(({ direction, cab }) => {
    const windshield = addBox(
      root,
      [width * (cab ? 0.76 : 0.62), shellHeight * (cab ? 0.42 : 0.3), 0.055],
      [0, floor + shellHeight * 0.67, direction * length * 0.498],
      glassMaterial,
    );
    windshield.rotation.x = cab ? -direction * 0.15 : 0;
    for (const x of [-width * 0.31, width * 0.31]) {
      addBox(
        root,
        [0.18, 0.12, 0.065],
        [x, floor + 0.68, direction * length * 0.502],
        cab ? headlightMaterial : tailLightMaterial,
      );
    }
  });

  addBox(
    root,
    [width * 0.45, 0.1, length * (isBus ? 0.24 : 0.3)],
    [0, floor + shellHeight + 0.05, 0],
    roofMaterial,
  );

  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x21332e,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    shadowMaterial,
  );
  shadow.scale.set(width * 0.68, length * 0.44, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.035;
  root.add(shadow);
  return root;
}

function disposeObject(object: THREE.Object3D | undefined) {
  object?.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function lerpAngle(current: number, target: number, amount: number) {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * amount;
}

export class TransitVehicleModelLayer implements CustomLayerInterface {
  readonly id = 'transit-vehicle-model-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private origin = new maplibregl.LngLat(23.7609, 61.4981);
  private originElevation = 0;
  private hasOrigin = false;
  private pose: TransitVehiclePose | null = null;
  private targetParts: LocalPartPose[] = [];
  private sectionRoots: THREE.Group[] = [];
  private connectors: THREE.Mesh[] = [];
  private modelGroup?: THREE.Group;
  private modelKey = '';
  private dimensions: VehicleDimensions = dimensionsForMode('BUS');
  private lastFrameTime = 0;
  private currentInitialized = false;

  setPose(pose: TransitVehiclePose | null) {
    this.pose = pose;
    if (!pose) {
      if (this.modelGroup) this.modelGroup.visible = false;
      this.targetParts = [];
      this.currentInitialized = false;
      this.map?.triggerRepaint();
      return;
    }
    if (this.map) this.applyPose(pose);
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    // Models use local metre coordinates: x=east, y=up, z=north.
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.scene.add(new THREE.HemisphereLight(
      CARTOON_AMBIENT_SKY_COLOR,
      CARTOON_AMBIENT_GROUND_COLOR,
      2.2,
    ));
    const sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR, 2.8);
    sunlight.position.set(-60, 110, -45);
    this.scene.add(sunlight);
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (this.pose) this.applyPose(this.pose);
  }

  private rebuildModel(pose: TransitVehiclePose) {
    disposeObject(this.modelGroup);
    if (this.modelGroup) this.scene.remove(this.modelGroup);
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.sectionRoots = [];
    this.connectors = [];
    this.dimensions = dimensionsForMode(pose.mode);

    const isTram = pose.mode === 'TRAM';
    const connectorMaterial = new THREE.MeshLambertMaterial({
      color: isTram ? 0x32343b : 0x3a4245,
    });
    for (let index = 0; index < pose.parts.length - 1; index += 1) {
      const connector = new THREE.Mesh(
        new THREE.BoxGeometry(
          this.dimensions.width * (isTram ? 0.84 : 0.78),
          this.dimensions.height * (isTram ? 0.74 : 0.68),
          1,
        ),
        connectorMaterial,
      );
      this.modelGroup.add(connector);
      this.connectors.push(connector);
    }
    pose.parts.forEach((_part, index) => {
      const section = createVehicleSection(
        this.dimensions,
        pose.color,
        pose.mode,
        index,
        pose.parts.length,
      );
      this.modelGroup!.add(section);
      this.sectionRoots.push(section);
    });
    this.modelKey = `${pose.mode}:${pose.color}:${pose.parts.length}`;
    this.currentInitialized = false;
  }

  private resetOrigin(pose: TransitVehiclePose) {
    const middle = pose.parts[Math.floor(pose.parts.length / 2)].coordinates;
    this.origin = new maplibregl.LngLat(middle[0], middle[1]);
    this.originElevation = this.map?.queryTerrainElevation(this.origin) ?? 0;
    this.hasOrigin = true;
    this.currentInitialized = false;
  }

  private applyPose(pose: TransitVehiclePose) {
    const map = this.map;
    if (!map || pose.parts.length === 0) return;
    const key = `${pose.mode}:${pose.color}:${pose.parts.length}`;
    if (key !== this.modelKey) this.rebuildModel(pose);
    if (!this.hasOrigin) this.resetOrigin(pose);

    const middle = pose.parts[Math.floor(pose.parts.length / 2)].coordinates;
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.origin);
    const middleMercator = maplibregl.MercatorCoordinate.fromLngLat(middle);
    const units = originMercator.meterInMercatorCoordinateUnits();
    if (Math.hypot(
      (middleMercator.x - originMercator.x) / units,
      (middleMercator.y - originMercator.y) / units,
    ) > RECENTER_DISTANCE_METERS) {
      this.resetOrigin(pose);
    }

    const nextOriginMercator = maplibregl.MercatorCoordinate.fromLngLat(this.origin);
    const nextUnits = nextOriginMercator.meterInMercatorCoordinateUnits();
    this.targetParts = pose.parts.map((part) => {
      const location = new maplibregl.LngLat(part.coordinates[0], part.coordinates[1]);
      const mercator = maplibregl.MercatorCoordinate.fromLngLat(location);
      const elevation = map.queryTerrainElevation(location) ?? this.originElevation;
      return {
        position: new THREE.Vector3(
          (mercator.x - nextOriginMercator.x) / nextUnits,
          elevation - this.originElevation,
          (nextOriginMercator.y - mercator.y) / nextUnits,
        ),
        heading: part.heading,
      };
    });
    if (this.modelGroup) this.modelGroup.visible = true;
    if (!this.currentInitialized) this.snapToTargets();
    map.triggerRepaint();
  }

  private snapToTargets() {
    this.sectionRoots.forEach((section, index) => {
      const target = this.targetParts[index];
      if (!target) return;
      section.position.copy(target.position);
      section.rotation.y = target.heading;
    });
    this.currentInitialized = true;
    this.updateConnectors();
  }

  private updateConnectors() {
    this.connectors.forEach((connector, index) => {
      const first = this.sectionRoots[index];
      const second = this.sectionRoots[index + 1];
      if (!first || !second) return;
      const dx = second.position.x - first.position.x;
      const dz = second.position.z - first.position.z;
      const horizontalDistance = Math.hypot(dx, dz);
      connector.position.set(
        (first.position.x + second.position.x) / 2,
        (first.position.y + second.position.y) / 2 + this.dimensions.height * 0.54,
        (first.position.z + second.position.z) / 2,
      );
      connector.rotation.y = Math.atan2(dx, dz);
      connector.scale.z = Math.max(0.25, horizontalDistance);
    });
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.renderer || !this.modelGroup || !this.pose || map.getZoom() < MODEL_MIN_ZOOM) return;
    const now = performance.now();
    const deltaSeconds = this.lastFrameTime > 0 ? Math.min(0.1, (now - this.lastFrameTime) / 1_000) : 1 / 60;
    this.lastFrameTime = now;
    const amount = 1 - Math.exp(-9 * deltaSeconds);
    // Keep the silhouette legible at transit-network zooms, then converge to
    // real-world dimensions once individual streets and platforms are visible.
    const visualScale = Math.max(1, Math.min(2.8, 2 ** ((16 - map.getZoom()) * 0.45)));
    this.sectionRoots.forEach((section, index) => {
      const target = this.targetParts[index];
      if (!target) return;
      section.position.lerp(target.position, amount);
      section.rotation.y = lerpAngle(section.rotation.y, target.heading, amount);
      section.scale.setScalar(visualScale);
    });
    this.updateConnectors();
    this.connectors.forEach((connector) => {
      connector.scale.x = visualScale;
      connector.scale.y = visualScale;
    });

    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.origin, this.originElevation);
    const scale = origin.meterInMercatorCoordinateUnits();
    this.sceneScale.set(scale, -scale, scale);
    this.sceneTransform.makeTranslation(origin.x, origin.y, origin.z).scale(this.sceneScale);
    this.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(this.sceneTransform);
    this.camera.projectionMatrix.copy(this.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    map.triggerRepaint();
  }

  onRemove() {
    disposeObject(this.modelGroup);
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }
}
