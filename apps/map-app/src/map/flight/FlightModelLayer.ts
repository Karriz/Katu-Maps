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
} from '../CartoonLighting';
import type { FlightState } from './FlightDynamics';

function disposeObject(object: THREE.Object3D | undefined) {
  object?.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function createAircraft() {
  const aircraft = new THREE.Group();
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xf97316, flatShading: true });
  const accentMaterial = new THREE.MeshLambertMaterial({ color: 0xfff7ed, flatShading: true });
  const darkMaterial = new THREE.MeshLambertMaterial({ color: 0x243447, flatShading: true });
  const glassMaterial = new THREE.MeshLambertMaterial({ color: 0x79c7e8, flatShading: true });

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

  const propellerHub = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 5), darkMaterial);
  propellerHub.position.z = 6.65;
  aircraft.add(propellerHub);
  const propeller = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.16, 0.12), darkMaterial);
  propeller.position.z = 6.85;
  aircraft.add(propeller);

  aircraft.traverse((child) => {
    if (child instanceof THREE.Mesh) child.frustumCulled = false;
  });
  aircraft.rotation.order = 'YXZ';
  return aircraft;
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
  private pose: FlightState | null = null;

  setPose(pose: FlightState | null) {
    this.pose = pose;
    if (this.aircraft) this.aircraft.visible = Boolean(pose);
    this.map?.triggerRepaint();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    // Match the other custom layers: local x=east, y=up, z=north.
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
    this.aircraft = createAircraft();
    this.aircraft.visible = false;
    this.scene.add(this.aircraft);
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

    aircraft.rotation.set(-pose.pitch, pose.heading, -pose.roll, 'YXZ');
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
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.aircraft = undefined;
    this.map = undefined;
  }
}
