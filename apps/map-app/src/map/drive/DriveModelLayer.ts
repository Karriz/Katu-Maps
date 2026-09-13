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
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_COLOR,
  sunCartesian,
} from '../CartoonLighting';
import type { DayNightAppearance } from '../DayNightAppearance';
import {
  DRIVE_WHEEL_CONTACT_OFFSET_METERS,
  driveRearTireContacts,
  type DriveState,
  type DriveTireContact,
} from './DriveDynamics';

const CONTACT_SHADOW_BASE_OPACITY = 0.28;
const SKID_MAX_SAMPLES = 160;
const SKID_MIN_SPACING_METERS = 0.45;
const SKID_MARK_WIDTH_METERS = 0.22;
const EARTH_RADIUS_METERS = 6_378_137;

type SkidSample = DriveTireContact;

function metersBetween(a: SkidSample, b: SkidSample) {
  const meanLat = (a.latitude + b.latitude) * 0.5 * Math.PI / 180;
  const east = (b.longitude - a.longitude) * Math.PI / 180 * EARTH_RADIUS_METERS * Math.cos(meanLat);
  const north = (b.latitude - a.latitude) * Math.PI / 180 * EARTH_RADIUS_METERS;
  return Math.hypot(east, north);
}

function disposeObject(object: THREE.Object3D | undefined) {
  object?.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function createShadowTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normalizedX = (x + 0.5) / size * 2 - 1;
      const normalizedY = (y + 0.5) / size * 2 - 1;
      const distance = Math.hypot(normalizedX, normalizedY);
      const falloff = Math.max(0, Math.min(1, 1 - distance));
      const strength = falloff * falloff * (3 - 2 * falloff);
      const offset = (y * size + x) * 4;
      const value = Math.round(strength * 255);
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function createContactShadow(texture: THREE.DataTexture) {
  const geometry = new THREE.CircleGeometry(1, 24);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: CARTOON_SHADOW_COLOR,
    transparent: true,
    opacity: CONTACT_SHADOW_BASE_OPACITY,
    alphaMap: texture,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
  const shadow = new THREE.Mesh(geometry, material);
  shadow.scale.set(2.4, 1, 4.2);
  shadow.frustumCulled = false;
  shadow.renderOrder = -1;
  return shadow;
}

function createCar(dark: boolean) {
  const car = new THREE.Group();
  const bodyColor = new THREE.Color(0xf97316);
  const accentColor = new THREE.Color(0xfff7ed);
  const trimColor = new THREE.Color(dark ? 0x1a222c : 0x243447);
  if (dark) {
    bodyColor.multiplyScalar(0.32);
    accentColor.multiplyScalar(0.34);
  }
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
  const accentMaterial = new THREE.MeshLambertMaterial({ color: accentColor, flatShading: true });
  const trimMaterial = new THREE.MeshLambertMaterial({ color: trimColor, flatShading: true });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: dark ? 0x8a6230 : 0x79c7e8,
    emissive: dark ? 0xffc14d : 0x3d7a94,
    emissiveIntensity: dark ? 0.85 : 0.1,
    roughness: 0.45,
    metalness: 0.05,
    flatShading: true,
  });

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.72, 3.4), bodyMaterial);
  cabin.position.y = 0.55;
  car.add(cabin);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.42, 1.15), bodyMaterial);
  hood.position.set(0, 0.42, 1.55);
  car.add(hood);

  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.48, 0.85), bodyMaterial);
  trunk.position.set(0, 0.45, -1.55);
  car.add(trunk);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 1.7), accentMaterial);
  roof.position.set(0, 1.05, -0.15);
  car.add(roof);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.42, 0.08), glassMaterial);
  windshield.position.set(0, 0.95, 0.78);
  windshield.rotation.x = -0.55;
  car.add(windshield);

  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.38, 0.08), glassMaterial);
  rearGlass.position.set(0, 0.95, -1.05);
  rearGlass.rotation.x = 0.45;
  car.add(rearGlass);

  for (const side of [-1, 1] as const) {
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 1.35), glassMaterial);
    window.position.set(side * 0.9, 0.92, -0.1);
    car.add(window);
  }

  const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.28, 0.28), trimMaterial);
  bumperFront.position.set(0, 0.28, 2.15);
  car.add(bumperFront);
  const bumperRear = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.28, 0.28), trimMaterial);
  bumperRear.position.set(0, 0.28, -2.05);
  car.add(bumperRear);

  const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12);
  wheelGeometry.rotateZ(Math.PI / 2);
  // Model origin sits DRIVE_WHEEL_CONTACT_OFFSET_METERS above the tyre contact plane.
  const wheelY = -DRIVE_WHEEL_CONTACT_OFFSET_METERS + 0.34;
  for (const [x, z] of [[-0.85, 1.2], [0.85, 1.2], [-0.85, -1.25], [0.85, -1.25]] as const) {
    const wheel = new THREE.Mesh(wheelGeometry, trimMaterial);
    wheel.position.set(x, wheelY, z);
    car.add(wheel);
  }

  const leftLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.16, 0.1),
    new THREE.MeshBasicMaterial({ color: dark ? 0xfff4d4 : 0xf8fafc }),
  );
  leftLight.position.set(-0.55, 0.48, 2.28);
  car.add(leftLight);
  const rightLight = leftLight.clone();
  rightLight.position.x = 0.55;
  car.add(rightLight);

  const leftTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.14, 0.08),
    new THREE.MeshBasicMaterial({ color: dark ? 0xff3b3b : 0xb91c1c }),
  );
  leftTail.position.set(-0.6, 0.5, -2.18);
  car.add(leftTail);
  const rightTail = leftTail.clone();
  rightTail.position.x = 0.6;
  car.add(rightTail);

  if (dark) {
    const cabinLight = new THREE.PointLight(0xffc56a, 1.1, 5, 2);
    cabinLight.position.set(0, 0.9, 0.2);
    car.add(cabinLight);
    const headGlow = new THREE.PointLight(0xfff1c8, 1.4, 8, 2);
    headGlow.position.set(0, 0.5, 2.4);
    car.add(headGlow);
  }

  car.traverse((child) => {
    if (child instanceof THREE.Mesh) child.frustumCulled = false;
  });
  car.rotation.order = 'YXZ';
  return car;
}

/** Shared-context Three.js layer for the player car. */
export class DriveModelLayer implements CustomLayerInterface {
  readonly id = 'drive-car-model-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private car?: THREE.Group;
  private contactShadow?: THREE.Mesh;
  private shadowTexture?: THREE.DataTexture;
  private skidMesh?: THREE.Mesh;
  private skidGeometry?: THREE.BufferGeometry;
  private skidMaterial?: THREE.MeshBasicMaterial;
  private readonly skidTracks: [SkidSample[], SkidSample[]] = [[], []];
  private hemisphereLight?: THREE.HemisphereLight;
  private sunlight?: THREE.DirectionalLight;
  private pose: DriveState | null = null;
  private terrainElevation: number | null = null;
  private darkMode = false;
  private dayNight: DayNightAppearance | null = null;

  setDayNightLighting(appearance: DayNightAppearance | null) {
    this.dayNight = appearance;
    this.applySceneLighting();
    this.map?.triggerRepaint();
  }

  setTheme(dark: boolean) {
    if (this.darkMode === dark) return;
    this.darkMode = dark;
    this.applySceneLighting();
    if (this.car) this.rebuildCar();
    this.map?.triggerRepaint();
  }

  setPose(pose: DriveState | null, terrainElevation?: number) {
    this.pose = pose;
    this.terrainElevation = pose == null
      ? null
      : (terrainElevation ?? this.terrainElevation);
    if (pose == null) {
      this.skidTracks[0].length = 0;
      this.skidTracks[1].length = 0;
    } else {
      this.depositSkidMarks(pose);
    }
    if (this.car) this.car.visible = Boolean(pose);
    if (this.contactShadow) this.contactShadow.visible = Boolean(pose);
    if (this.skidMesh) this.skidMesh.visible = Boolean(pose) && this.skidTracks[0].length > 1;
    this.map?.triggerRepaint();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.hemisphereLight = new THREE.HemisphereLight(
      CARTOON_AMBIENT_SKY_COLOR,
      CARTOON_AMBIENT_GROUND_COLOR,
      2.2,
    );
    this.scene.add(this.hemisphereLight);
    this.sunlight = new THREE.DirectionalLight(CARTOON_SUN_COLOR, 2.8);
    this.sunlight.position.set(-60, 110, -45);
    this.scene.add(this.sunlight);
    this.applySceneLighting();
    this.rebuildCar();
    this.ensureSkidMesh();
    if (this.car) this.car.visible = false;
    if (this.contactShadow) this.contactShadow.visible = false;
    if (this.skidMesh) this.skidMesh.visible = false;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const pose = this.pose;
    const car = this.car;
    const renderer = this.renderer;
    if (!pose || !car || !renderer) return;

    car.rotation.set(-pose.pitch, pose.heading, -pose.roll, 'YXZ');
    this.updateContactShadow(pose);
    this.updateSkidGeometry(pose);

    const origin = maplibregl.MercatorCoordinate.fromLngLat(
      [pose.longitude, pose.latitude],
      pose.altitude,
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

  onRemove() {
    disposeObject(this.car);
    disposeObject(this.contactShadow);
    disposeObject(this.skidMesh);
    this.skidGeometry?.dispose();
    this.skidMaterial?.dispose();
    this.shadowTexture?.dispose();
    this.shadowTexture = undefined;
    this.skidTracks[0].length = 0;
    this.skidTracks[1].length = 0;
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.car = undefined;
    this.contactShadow = undefined;
    this.skidMesh = undefined;
    this.skidGeometry = undefined;
    this.skidMaterial = undefined;
    this.hemisphereLight = undefined;
    this.sunlight = undefined;
    this.terrainElevation = null;
    this.map = undefined;
  }

  private depositSkidMarks(pose: DriveState) {
    const contacts = driveRearTireContacts(pose);
    if (!contacts) return;
    contacts.forEach((contact, trackIndex) => {
      const track = this.skidTracks[trackIndex];
      const previous = track[track.length - 1];
      if (previous && metersBetween(previous, contact) < SKID_MIN_SPACING_METERS) {
        previous.intensity = Math.max(previous.intensity, contact.intensity);
        previous.altitude = contact.altitude;
        return;
      }
      track.push(contact);
      if (track.length > SKID_MAX_SAMPLES) track.shift();
    });
  }

  private ensureSkidMesh() {
    if (this.skidMesh) return;
    this.skidGeometry = new THREE.BufferGeometry();
    this.skidMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      fog: false,
    });
    this.skidMesh = new THREE.Mesh(this.skidGeometry, this.skidMaterial);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = -2;
    this.skidMesh.visible = false;
    this.scene.add(this.skidMesh);
  }

  private updateSkidGeometry(pose: DriveState) {
    this.ensureSkidMesh();
    const geometry = this.skidGeometry;
    const mesh = this.skidMesh;
    if (!geometry || !mesh) return;

    const left = this.skidTracks[0];
    const right = this.skidTracks[1];
    if (left.length < 2 && right.length < 2) {
      mesh.visible = false;
      return;
    }

    const origin = maplibregl.MercatorCoordinate.fromLngLat(
      [pose.longitude, pose.latitude],
      pose.altitude,
    );
    const units = origin.meterInMercatorCoordinateUnits();
    const halfWidth = SKID_MARK_WIDTH_METERS * 0.5;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const appendTrack = (track: SkidSample[]) => {
      if (track.length < 2) return;
      const baseVertex = positions.length / 3;
      for (let index = 0; index < track.length; index += 1) {
        const sample = track[index];
        const mercator = maplibregl.MercatorCoordinate.fromLngLat(
          [sample.longitude, sample.latitude],
          sample.altitude,
        );
        const x = (mercator.x - origin.x) / units;
        const y = sample.altitude - pose.altitude;
        const z = (origin.y - mercator.y) / units;
        let dirX = 0;
        let dirZ = 1;
        if (index < track.length - 1) {
          const next = track[index + 1];
          const nextMercator = maplibregl.MercatorCoordinate.fromLngLat(
            [next.longitude, next.latitude],
            next.altitude,
          );
          dirX = (nextMercator.x - mercator.x) / units;
          dirZ = (origin.y - nextMercator.y) / units - z;
        } else if (index > 0) {
          const prev = track[index - 1];
          const prevMercator = maplibregl.MercatorCoordinate.fromLngLat(
            [prev.longitude, prev.latitude],
            prev.altitude,
          );
          dirX = x - (prevMercator.x - origin.x) / units;
          dirZ = z - (origin.y - prevMercator.y) / units;
        }
        const length = Math.hypot(dirX, dirZ) || 1;
        const nx = (-dirZ / length) * halfWidth;
        const nz = (dirX / length) * halfWidth;
        const ageFade = index / Math.max(1, track.length - 1);
        const strength = sample.intensity * (0.2 + ageFade * 0.8);
        const shade = 0.04 + (1 - strength) * 0.18;
        positions.push(x - nx, y, z - nz, x + nx, y, z + nz);
        colors.push(shade, shade, shade, shade, shade, shade);
      }
      for (let index = 0; index < track.length - 1; index += 1) {
        const a = baseVertex + index * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };

    appendTrack(left);
    appendTrack(right);
    if (indices.length === 0) {
      mesh.visible = false;
      return;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    mesh.visible = true;
  }

  private updateContactShadow(pose: DriveState) {
    const shadow = this.contactShadow;
    if (!shadow) return;
    const terrainElevation = this.terrainElevation;
    if (terrainElevation == null) {
      shadow.visible = false;
      return;
    }
    shadow.visible = true;
    shadow.position.set(0, -(pose.altitude - terrainElevation) + 0.12, 0);
    shadow.rotation.set(0, pose.heading, 0);
    const material = shadow.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = CONTACT_SHADOW_BASE_OPACITY;
    }
  }

  private applySceneLighting() {
    const appearance = this.dayNight;
    const night = appearance?.treeNightMix ?? (this.darkMode ? 1 : 0);
    if (this.hemisphereLight) {
      this.hemisphereLight.intensity = 0.55 + (1 - night) * 1.65;
      this.hemisphereLight.color.set(CARTOON_AMBIENT_SKY_COLOR);
      this.hemisphereLight.groundColor.set(CARTOON_AMBIENT_GROUND_COLOR);
      if (appearance) {
        this.hemisphereLight.color.lerp(new THREE.Color(appearance.palette.sky), 0.35);
        this.hemisphereLight.groundColor.lerp(new THREE.Color(appearance.palette.land), 0.25);
      }
    }
    if (this.sunlight) {
      this.sunlight.intensity = 0.45 + (1 - night) * 2.35;
      this.sunlight.color.set(appearance?.palette.sun ?? CARTOON_SUN_COLOR);
      if (appearance) {
        const position = sunCartesian(appearance.azimuth, appearance.polar);
        this.sunlight.position.set(position.x, position.y, position.z);
      } else this.sunlight.position.set(-60, 110, -45);
    }
    this.car?.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial)) return;
      child.material.color.set(0x79c7e8).lerp(new THREE.Color(0x8a6230), night);
      child.material.emissive.set(0x3d7a94).lerp(new THREE.Color(0xffc14d), night);
      child.material.emissiveIntensity = 0.1 + night * 0.75;
    });
  }

  private rebuildCar() {
    if (this.car) {
      this.scene.remove(this.car);
      disposeObject(this.car);
    }
    if (this.contactShadow) {
      this.scene.remove(this.contactShadow);
      disposeObject(this.contactShadow);
    }
    this.shadowTexture?.dispose();
    this.car = createCar(this.darkMode);
    this.shadowTexture = createShadowTexture();
    this.contactShadow = createContactShadow(this.shadowTexture);
    this.car.visible = Boolean(this.pose);
    this.contactShadow.visible = Boolean(this.pose);
    this.scene.add(this.contactShadow);
    this.scene.add(this.car);
    this.applySceneLighting();
  }
}
