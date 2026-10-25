import { expect, it } from 'vitest';
import * as THREE from 'three';
import { WindowSkyReflection } from './WindowSkyReflection';

it('recovers the local eye position from MapLibre projection and model-view transforms', () => {
  const reflection = new WindowSkyReflection();
  const material = new THREE.MeshStandardMaterial();
  reflection.apply(material);
  const shader = { ...THREE.ShaderLib.standard, uniforms: {} };
  material.onBeforeCompile(shader as never, {} as never);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  camera.position.set(150, -270, 350);
  camera.lookAt(20, 30, 0);
  camera.updateMatrixWorld();
  const combined = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  reflection.updateCamera(combined, camera.projectionMatrix.elements);
  const eye = (shader.uniforms as Record<string, THREE.IUniform>).katuWindowEye.value as THREE.Vector3;
  expect(eye.distanceTo(camera.position)).toBeLessThan(1e-8);
  // A different layer origin must change the local eye by the same offset.
  const rebased = combined.clone().multiply(new THREE.Matrix4().makeTranslation(80, -40, 12));
  reflection.updateCamera(rebased, camera.projectionMatrix.elements);
  expect(eye.distanceTo(camera.position.clone().sub(new THREE.Vector3(80, -40, 12)))).toBeLessThan(1e-8);
  material.dispose();
});
