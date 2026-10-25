import * as THREE from 'three';

/** Different surface finishes inside the existing merged building draw call. */
export function applyBuildingSurfaceMaterial(material: THREE.MeshStandardMaterial) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${previousKey}:building-surfaces-v2`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = `attribute vec2 buildingContact;
varying vec2 vBuildingContact;
varying vec2 vBuildingMetres;
varying float vBuildingRoof;
${shader.vertexShader}`.replace('#include <begin_vertex>', `
#include <begin_vertex>
vBuildingMetres = uv * 8.0;
vBuildingContact = buildingContact;
vBuildingRoof = step(0.5, normal.y);`);
    shader.fragmentShader = `varying vec2 vBuildingContact;
varying vec2 vBuildingMetres;
varying float vBuildingRoof;
${shader.fragmentShader}`.replace('#include <roughnessmap_fragment>', `
#include <roughnessmap_fragment>
// Matte plaster walls, with a slightly smoother mineral roof finish.
roughnessFactor = mix(0.94, 0.78, vBuildingRoof);`).replace('#include <color_fragment>', `
#include <color_fragment>
// Fine roof-panel joints fade before they become subpixel noise.
vec2 roofFootprint = max(fwidth(vBuildingMetres), vec2(0.001));
vec2 roofDistance = abs(fract(vBuildingMetres / vec2(0.6, 1.2) + 0.5) - 0.5)
  * vec2(0.6, 1.2);
vec2 roofJoint = 1.0 - smoothstep(vec2(0.008) - roofFootprint * 0.5,
  vec2(0.008) + roofFootprint * 0.5, roofDistance);
float roofDetail = 1.0 - smoothstep(0.04, 0.18, max(roofFootprint.x, roofFootprint.y));
vec3 roofFinish = vec3(0.70, 0.73, 0.76)
  * (1.0 - max(roofJoint.x, roofJoint.y) * roofDetail * 0.07);
diffuseColor.rgb *= mix(vec3(1.0), roofFinish, vBuildingRoof);`).replace('#include <aomap_fragment>', `
#include <aomap_fragment>
// Local contact approximation, confined to ambient light. Elevated building
// parts carry a negative base distance and receive no ground-contact shading.
float baseOcclusion = step(0.0, vBuildingContact.x) * 0.30
  * exp(-max(0.0, vBuildingContact.x) / 1.5);
float roofOcclusion = 0.14 * exp(-max(0.0, vBuildingContact.y) / 0.65);
float contactVisibility = 1.0 - (baseOcclusion + roofOcclusion) * (1.0 - vBuildingRoof);
reflectedLight.indirectDiffuse *= contactVisibility;
reflectedLight.indirectSpecular *= contactVisibility;`);
  };
  material.needsUpdate = true;
}
