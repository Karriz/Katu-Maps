import { MercatorCoordinate } from 'maplibre-gl';
import * as THREE from 'three';

type Origin = { longitude: number; latitude: number; elevation: number };

export type ModelShadowMap = {
  texture: WebGLTexture;
  matrix: THREE.Matrix4;
  origin: Origin;
  /** Confidence in a local caster map whose texels may span whole buildings. */
  strength?: number;
};
export type ModelShadowSource = () => ModelShadowMap | undefined;

/** Reuse a completed caster pass across renderers sharing MapLibre's GL context. */
export class ModelShadowReceiver {
  private source?: ModelShadowSource;
  private readonly texture = new THREE.ExternalTexture();
  private readonly uniforms = {
    katuShadowDepth: { value: this.texture },
    katuShadowMatrix: { value: new THREE.Matrix4() },
    katuShadowEnabled: { value: false },
    katuShadowStrength: { value: 1 },
  };

  setSource(source: ModelShadowSource) { this.source = source; }

  isEnabled() { return this.uniforms.katuShadowEnabled.value; }

  apply(material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial) {
    material.customProgramCacheKey = () => 'katu-model-shadow-v2';
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `uniform mat4 katuShadowMatrix;
varying vec4 vKatuShadowPosition;
${shader.vertexShader}`.replace('#include <project_vertex>', `
vKatuShadowPosition = katuShadowMatrix * modelMatrix * vec4(transformed, 1.0);
#include <project_vertex>`);
      shader.fragmentShader = `uniform sampler2D katuShadowDepth;
uniform bool katuShadowEnabled;
uniform float katuShadowStrength;
varying vec4 vKatuShadowPosition;
float katuSunVisibility() {
  if (!katuShadowEnabled) return 1.0;
  vec3 shadow = vKatuShadowPosition.xyz / vKatuShadowPosition.w;
  // Derive the receiver plane before the per-fragment bounds branch. Each
  // filter tap needs the wall's depth at that texel, not at the center pixel.
  // A constant comparison depth produces diagonal self-shadow bands on walls.
  vec3 dx = dFdx(shadow);
  vec3 dy = dFdy(shadow);
  float determinant = dx.x * dy.y - dx.y * dy.x;
  vec2 depthGradient = vec2(0.0);
  if (abs(determinant) > 1e-12) {
    depthGradient = vec2(dy.y * dx.z - dx.y * dy.z,
      dx.x * dy.z - dy.x * dx.z) / determinant;
  }
  if (any(lessThan(shadow, vec3(0.0))) || any(greaterThan(shadow, vec3(1.0)))) return 1.0;
  ivec2 size = textureSize(katuShadowDepth, 0);
  vec2 position = shadow.xy * vec2(size) - 0.5;
  ivec2 center = ivec2(floor(position + 0.5));
  vec2 fraction = position - vec2(center);
  float covered = 0.0;
  float total = 0.0;
  for (int y = -1; y <= 1; ++y) {
    for (int x = -1; x <= 1; ++x) {
      ivec2 at = clamp(center + ivec2(x, y), ivec2(0), size - 1);
      float weight = max(0.0, 1.5 - abs(float(x) - fraction.x))
        * max(0.0, 1.5 - abs(float(y) - fraction.y));
      vec2 sampleOffset = (vec2(at) + 0.5) / vec2(size) - shadow.xy;
      float receiverDepth = shadow.z + dot(depthGradient, sampleOffset);
      covered += weight * float(receiverDepth - 0.0002 > texelFetch(katuShadowDepth, at, 0).r);
      total += weight;
    }
  }
  return 1.0 - covered / total * katuShadowStrength;
}
${shader.fragmentShader}`.replace('#include <lights_fragment_end>', `
#include <lights_fragment_end>
float katuVisibility = katuSunVisibility();
reflectedLight.directDiffuse *= katuVisibility;
reflectedLight.directSpecular *= katuVisibility;`);
    };
    material.needsUpdate = true;
  }

  update(origin: Origin): boolean {
    const shadow = this.source?.();
    this.uniforms.katuShadowEnabled.value = Boolean(shadow);
    this.uniforms.katuShadowStrength.value = THREE.MathUtils.clamp(shadow?.strength ?? 1, 0, 1);
    this.texture.sourceTexture = shadow?.texture ?? null;
    if (!shadow) return false;
    const receiver = MercatorCoordinate.fromLngLat([origin.longitude, origin.latitude]);
    const caster = MercatorCoordinate.fromLngLat([shadow.origin.longitude, shadow.origin.latitude]);
    const units = caster.meterInMercatorCoordinateUnits();
    const scale = receiver.meterInMercatorCoordinateUnits() / units;
    // Scene world axes are east, north, up. Keep subtraction in double precision.
    this.uniforms.katuShadowMatrix.value.makeTranslation(
      (receiver.x - caster.x) / units,
      (caster.y - receiver.y) / units,
      origin.elevation - shadow.origin.elevation,
    ).scale(new THREE.Vector3(scale, scale, 1)).premultiply(shadow.matrix);
    return true;
  }

  dispose() {
    // ExternalTexture does not own or delete the source renderer's depth map.
    this.texture.sourceTexture = null;
    this.texture.dispose();
  }
}
