import * as THREE from 'three';
import { CARTOON_SUN_AZIMUTH_DEGREES, CARTOON_SUN_POLAR_DEGREES, CARTOON_SUN_COLOR, sunCartesian } from './CartoonLighting';

type SkyPalette = { sky: string; horizon: string; land: string };

/** Analytic sky reflections: no scene capture, remote imagery, or PMREM rebuilds. */
export class WindowSkyReflection {
  private readonly uniforms = {
    katuWindowEye: { value: new THREE.Vector3(0, 0, 1000) },
    katuWindowSky: { value: new THREE.Color() },
    katuWindowHorizon: { value: new THREE.Color() },
    katuWindowGround: { value: new THREE.Color() },
    katuWindowReflection: { value: 1.0 },
    katuWindowSun: { value: new THREE.Vector3() },
    katuWindowSunColor: { value: new THREE.Color(CARTOON_SUN_COLOR) },
    katuWindowSunStrength: { value: 2.5 },
  };
  private readonly cameraWorld = new THREE.Matrix4();

  constructor() {
    this.setAppearance(undefined, 0);
    this.setSun(CARTOON_SUN_AZIMUTH_DEGREES, CARTOON_SUN_POLAR_DEGREES);
  }

  setSun(azimuth: number, polar: number) {
    const sun = sunCartesian(azimuth, polar, 1);
    this.uniforms.katuWindowSun.value.set(sun.x, sun.z, sun.y).normalize();
  }

  setAppearance(palette: SkyPalette | undefined, night: number) {
    this.uniforms.katuWindowSky.value.set(palette?.sky ?? '#7ec8ea');
    this.uniforms.katuWindowHorizon.value.set(palette?.horizon ?? '#f3f8fb');
    this.uniforms.katuWindowGround.value.set(palette?.land ?? '#9caea6');
    const mix = THREE.MathUtils.clamp(night, 0, 1);
    if (!palette) {
      this.uniforms.katuWindowSky.value.lerp(new THREE.Color('#071525'), mix);
      this.uniforms.katuWindowHorizon.value.lerp(new THREE.Color('#24334b'), mix);
      this.uniforms.katuWindowGround.value.lerp(new THREE.Color('#101b24'), mix);
    }
    this.uniforms.katuWindowReflection.value = 1 - mix * 0.35;
    this.uniforms.katuWindowSunStrength.value = 2.5 * (1 - mix);
  }

  /** Undo MapLibre's projection, retaining the layer's local east/north/up frame. */
  updateCamera(combined: THREE.Matrix4, projection?: ArrayLike<number>) {
    if (!projection) return;
    this.cameraWorld.fromArray(projection).invert().multiply(combined).invert();
    this.uniforms.katuWindowEye.value.setFromMatrixPosition(this.cameraWorld);
  }

  apply(material: THREE.MeshStandardMaterial) {
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    material.customProgramCacheKey = () => `${previousKey}:window-sky-v2`;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `varying vec2 vWindowUv;
varying vec3 vWindowWorldPosition;
${shader.vertexShader}`.replace('#include <project_vertex>', `
vWindowWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWindowUv = uv;
#include <project_vertex>`);
      shader.fragmentShader = `uniform vec3 katuWindowEye;
uniform vec3 katuWindowSky;
uniform vec3 katuWindowHorizon;
uniform vec3 katuWindowGround;
uniform float katuWindowReflection;
uniform vec3 katuWindowSun;
uniform vec3 katuWindowSunColor;
uniform float katuWindowSunStrength;
varying vec2 vWindowUv;
varying vec3 vWindowWorldPosition;
${shader.fragmentShader}`.replace('#include <normal_fragment_maps>', `
#include <normal_fragment_maps>
// A shallow parallax reveal gives the glass a recessed appearance while
// retaining one quad per window and the existing facade vertex budget.
vec3 windowView = normalize(katuWindowEye - vWindowWorldPosition);
vec3 windowHorizontal = cross(vec3(0.0, 0.0, 1.0), normal);
windowHorizontal = length(windowHorizontal) > 0.001 ? normalize(windowHorizontal) : vec3(1.0, 0.0, 0.0);
vec3 windowVertical = normalize(cross(normal, windowHorizontal));
vec2 windowParallax = vec2(dot(windowView, windowHorizontal), dot(windowView, windowVertical))
  * 0.07 / max(abs(dot(windowView, normal)), 0.3);
vec2 paneUv = vWindowUv - windowParallax;
vec2 paneEdge = min(paneUv, 1.0 - paneUv);
float windowAa = max(max(fwidth(vWindowUv.x), fwidth(vWindowUv.y)), 0.001);
float windowPane = smoothstep(0.10 - windowAa, 0.10 + windowAa, min(paneEdge.x, paneEdge.y));
vec2 trimEdge = min(vWindowUv, 1.0 - vWindowUv);
float windowTrim = 1.0 - smoothstep(0.04 - windowAa, 0.04 + windowAa, min(trimEdge.x, trimEdge.y));
diffuseColor.rgb = mix(vec3(0.16, 0.19, 0.20), diffuseColor.rgb, windowPane);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.45, 0.46), windowTrim);
roughnessFactor = mix(0.78, 0.10, windowPane);`)
        .replace('#include <emissivemap_fragment>', `
#include <emissivemap_fragment>
totalEmissiveRadiance *= windowPane;`)
        .replace('#include <lights_fragment_begin>',
        THREE.ShaderChunk.lights_fragment_begin.replace('normalize( vViewPosition )',
          'normalize( katuWindowEye - vWindowWorldPosition )'))
        .replace('#include <aomap_fragment>', `
// The map layers' world axes are east, north, up; sky elevation is Z.
vec3 windowDirection = reflect(-geometryViewDir, geometryNormal);
float windowElevation = clamp(windowDirection.z, -1.0, 1.0);
vec3 windowEnvironment = mix(katuWindowHorizon,
  windowElevation >= 0.0 ? katuWindowSky : katuWindowGround,
  pow(abs(windowElevation), 0.55));
float windowFresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), 5.0);
float windowSun = pow(max(0.0, dot(windowDirection, katuWindowSun)), 256.0);
reflectedLight.indirectSpecular += (windowEnvironment * windowFresnel * katuWindowReflection
  + katuWindowSunColor * windowSun * katuWindowSunStrength) * windowPane;
reflectedLight.indirectDiffuse *= mix(0.55, 1.0, max(windowPane, windowTrim));
#include <aomap_fragment>`);
    };
    material.needsUpdate = true;
  }
}
