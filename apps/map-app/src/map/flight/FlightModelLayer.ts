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
import { FLIGHT_SKID_CONTACT_OFFSET_METERS, type FlightState } from './FlightDynamics';

const CONTACT_SHADOW_FADE_HEIGHT_METERS = 140;
const CONTACT_SHADOW_BASE_OPACITY = 0.22;

function disposeObject(object: THREE.Object3D | undefined) {
  object?.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

/** Soft radial alpha map matching tree contact shadows. */
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
  // Rough aircraft footprint: wide wings, longer fuselage.
  shadow.scale.set(7.2, 1, 5.0);
  shadow.frustumCulled = false;
  shadow.renderOrder = -1;
  return shadow;
}

function createAircraft(dark: boolean) {
  const aircraft = new THREE.Group();
  const bodyColor = new THREE.Color(0xf97316);
  const accentColor = new THREE.Color(0xfff7ed);
  if (dark) {
    bodyColor.multiplyScalar(0.28);
    accentColor.multiplyScalar(0.3);
  }
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
  const accentMaterial = new THREE.MeshLambertMaterial({ color: accentColor, flatShading: true });
  const darkMaterial = new THREE.MeshLambertMaterial({ color: dark ? 0x10161c : 0x243447, flatShading: true });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: dark ? 0x8a6230 : 0x79c7e8,
    emissive: dark ? 0xffc14d : 0x3d7a94,
    emissiveIntensity: dark ? 0.95 : 0.12,
    roughness: 0.42,
    metalness: 0.06,
    flatShading: true,
  });

  const fuselageGeometry = new THREE.CylinderGeometry(0.72, 0.92, 8.8, 10, 1);
  fuselageGeometry.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuselageGeometry, bodyMaterial);
  aircraft.add(fuselage);

  const noseGeometry = new THREE.ConeGeometry(0.72, 2.2, 10, 1);
  noseGeometry.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(noseGeometry, accentMaterial);
  nose.position.z = 5.5;
  aircraft.add(nose);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.24, 2.5), bodyMaterial);
  wing.position.set(0, -0.05, 0.25);
  aircraft.add(wing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 1.25), accentMaterial);
  tailWing.position.set(0, 0.2, -3.65);
  aircraft.add(tailWing);

  const verticalTail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.3, 1.55), bodyMaterial);
  verticalTail.position.set(0, 1.05, -3.75);
  verticalTail.rotation.x = -0.15;
  aircraft.add(verticalTail);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 6), glassMaterial);
  cockpit.scale.set(0.8, 0.62, 1.35);
  cockpit.position.set(0, 0.6, 2.15);
  aircraft.add(cockpit);

  const leftNav = new THREE.Mesh(
    new THREE.SphereGeometry(dark ? 0.18 : 0.1, 8, 6),
    new THREE.MeshBasicMaterial({ color: dark ? 0xff3b3b : 0xb91c1c }),
  );
  leftNav.position.set(-6.7, 0.1, 0.45);
  aircraft.add(leftNav);
  const rightNav = new THREE.Mesh(
    new THREE.SphereGeometry(dark ? 0.18 : 0.1, 8, 6),
    new THREE.MeshBasicMaterial({ color: dark ? 0x4ade80 : 0x15803d }),
  );
  rightNav.position.set(6.7, 0.1, 0.45);
  aircraft.add(rightNav);
  const tailNav = new THREE.Mesh(
    new THREE.SphereGeometry(dark ? 0.14 : 0.08, 8, 6),
    new THREE.MeshBasicMaterial({ color: dark ? 0xfff4d4 : 0xe7e5e4 }),
  );
  tailNav.position.set(0, 2.05, -3.95);
  aircraft.add(tailNav);

  if (dark) {
    const cabinLight = new THREE.PointLight(0xffc56a, 1.6, 7, 2);
    cabinLight.position.set(0, 0.55, 2.05);
    aircraft.add(cabinLight);
    const portGlow = new THREE.PointLight(0xff3344, 0.7, 4, 2);
    portGlow.position.copy(leftNav.position);
    aircraft.add(portGlow);
    const starboardGlow = new THREE.PointLight(0x4ade80, 0.55, 4, 2);
    starboardGlow.position.copy(rightNav.position);
    aircraft.add(starboardGlow);
  }

  const propellerHub = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 5), darkMaterial);
  propellerHub.position.z = 6.65;
  aircraft.add(propellerHub);
  const propeller = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.16, 0.12), darkMaterial);
  propeller.position.z = 6.85;
  aircraft.add(propeller);

  // Landing skids — bottom face sits at -FLIGHT_SKID_CONTACT_OFFSET_METERS.
  const skidThickness = 0.14;
  const skidBottom = -FLIGHT_SKID_CONTACT_OFFSET_METERS;
  const skidCenterY = skidBottom + skidThickness / 2;
  const skidTrack = 1.15;
  for (const side of [-1, 1] as const) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.22, skidThickness, 4.6), darkMaterial);
    skid.position.set(side * skidTrack, skidCenterY, 0.15);
    aircraft.add(skid);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, skidThickness, 0.85), darkMaterial);
    tip.position.set(side * skidTrack, skidCenterY + 0.08, 2.55);
    tip.rotation.x = -0.45;
    aircraft.add(tip);

    for (const strutZ of [1.1, -1.35] as const) {
      const strutHeight = Math.abs(skidCenterY) - 0.35;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, strutHeight, 0.09), darkMaterial);
      strut.position.set(side * (skidTrack * 0.55), skidCenterY + strutHeight / 2, strutZ);
      strut.rotation.z = side * 0.28;
      aircraft.add(strut);
    }
  }
  const crossBrace = new THREE.Mesh(new THREE.BoxGeometry(skidTrack * 2, 0.08, 0.1), darkMaterial);
  crossBrace.position.set(0, skidCenterY + 0.35, -0.2);
  aircraft.add(crossBrace);

  aircraft.traverse((child) => {
    if (child instanceof THREE.Mesh) child.frustumCulled = false;
  });
  aircraft.rotation.order = 'YXZ';
  return { aircraft, propeller };
}

/** A small shared-context Three.js layer that renders the player aircraft. */
export class FlightModelLayer implements CustomLayerInterface {
  readonly id = 'flight-aircraft-model-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private aircraft?: THREE.Group;
  private propeller?: THREE.Mesh;
  private contactShadow?: THREE.Mesh;
  private shadowTexture?: THREE.DataTexture;
  private hemisphereLight?: THREE.HemisphereLight;
  private sunlight?: THREE.DirectionalLight;
  private propellerAngle = 0;
  private previousRenderTime?: number;
  private pose: FlightState | null = null;
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
    if (this.aircraft) this.rebuildAircraft();
    this.map?.triggerRepaint();
  }

  setPose(pose: FlightState | null, terrainElevation?: number) {
    this.pose = pose;
    this.terrainElevation = pose == null
      ? null
      : (terrainElevation ?? this.terrainElevation);
    if (this.aircraft) this.aircraft.visible = Boolean(pose);
    if (this.contactShadow) this.contactShadow.visible = Boolean(pose);
    if (!pose) this.previousRenderTime = undefined;
    this.map?.triggerRepaint();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    // Match the other custom layers: local x=east, y=up, z=north.
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
    this.rebuildAircraft();
    if (this.aircraft) this.aircraft.visible = false;
    if (this.contactShadow) this.contactShadow.visible = false;
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
    const aircraft = this.aircraft;
    const renderer = this.renderer;
    if (!pose || !aircraft || !renderer) return;

    const now = performance.now();
    const elapsedSeconds = this.previousRenderTime === undefined
      ? 0
      : Math.min((now - this.previousRenderTime) / 1_000, 0.05);
    this.previousRenderTime = now;
    this.propellerAngle = (
      this.propellerAngle + elapsedSeconds * (35 + pose.throttle * 85)
    ) % (Math.PI * 2);
    if (this.propeller) this.propeller.rotation.z = this.propellerAngle;

    aircraft.rotation.set(-pose.pitch, pose.heading, -pose.roll, 'YXZ');
    this.updateContactShadow(pose);

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
    disposeObject(this.aircraft);
    disposeObject(this.contactShadow);
    this.shadowTexture?.dispose();
    this.shadowTexture = undefined;
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.aircraft = undefined;
    this.propeller = undefined;
    this.contactShadow = undefined;
    this.hemisphereLight = undefined;
    this.sunlight = undefined;
    this.previousRenderTime = undefined;
    this.terrainElevation = null;
    this.map = undefined;
  }

  private updateContactShadow(pose: FlightState) {
    const shadow = this.contactShadow;
    if (!shadow) return;
    const terrainElevation = this.terrainElevation;
    if (terrainElevation == null) {
      shadow.visible = false;
      return;
    }

    const heightAboveContact = Math.max(
      0,
      pose.altitude - terrainElevation - FLIGHT_SKID_CONTACT_OFFSET_METERS,
    );
    const fade = Math.max(0, 1 - heightAboveContact / CONTACT_SHADOW_FADE_HEIGHT_METERS);
    if (fade <= 0.02) {
      shadow.visible = false;
      return;
    }

    shadow.visible = true;
    // Sit just above the DEM and rely on polygonOffset like tree shadows so
    // the disc does not z-fight or clip into the terrain mesh.
    shadow.position.set(0, -(pose.altitude - terrainElevation) + 0.2, 0);
    shadow.rotation.set(0, pose.heading, 0);
    const soften = 1 + heightAboveContact * 0.014;
    shadow.scale.set(7.2 * soften, 1, 5.0 * soften);
    const material = shadow.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = CONTACT_SHADOW_BASE_OPACITY * fade * fade;
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
    this.aircraft?.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial)) return;
      child.material.color.set(0x79c7e8).lerp(new THREE.Color(0x8a6230), night);
      child.material.emissive.set(0x3d7a94).lerp(new THREE.Color(0xffc14d), night);
      child.material.emissiveIntensity = 0.12 + night * 0.83;
    });
  }

  private rebuildAircraft() {
    if (this.aircraft) {
      this.scene.remove(this.aircraft);
      disposeObject(this.aircraft);
    }
    if (this.contactShadow) {
      this.scene.remove(this.contactShadow);
      disposeObject(this.contactShadow);
    }
    this.shadowTexture?.dispose();
    const { aircraft, propeller } = createAircraft(this.darkMode);
    this.aircraft = aircraft;
    this.propeller = propeller;
    this.shadowTexture = createShadowTexture();
    this.contactShadow = createContactShadow(this.shadowTexture);
    this.aircraft.visible = Boolean(this.pose);
    this.contactShadow.visible = Boolean(this.pose);
    this.scene.add(this.contactShadow);
    this.scene.add(this.aircraft);
    this.applySceneLighting();
  }
}
