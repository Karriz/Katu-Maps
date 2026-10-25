import { describe, expect, it } from 'vitest';
import { MercatorCoordinate } from 'maplibre-gl';
import * as THREE from 'three';
import { ModelShadowReceiver, type ModelShadowMap } from './ModelShadowReceiver';

function fixture(kind: 'standard' | 'lambert' = 'standard') {
  const receiver = new ModelShadowReceiver();
  const material = kind === 'standard' ? new THREE.MeshStandardMaterial() : new THREE.MeshLambertMaterial();
  receiver.apply(material);
  const shader = { ...THREE.ShaderLib[kind], uniforms: {} };
  material.onBeforeCompile(shader as never, {} as never);
  return { receiver, shader, uniforms: shader.uniforms as Record<string, THREE.IUniform> };
}

describe('ModelShadowReceiver', () => {
  it.each(['standard', 'lambert'] as const)('adds shared shadows to %s direct lighting while preserving ambient light', (kind) => {
    const { receiver, shader } = fixture(kind);
    expect(shader.vertexShader).toContain('katuShadowMatrix * modelMatrix');
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse *= katuVisibility');
    expect(shader.fragmentShader).not.toContain('reflectedLight.indirectDiffuse *=');
    receiver.dispose();
  });

  it('maps a rebased scene into the completed shadow frame at a different latitude and elevation', () => {
    const { receiver, uniforms } = fixture();
    const origin = { longitude: 23.76, latitude: 61.5, elevation: 100 };
    const shadowOrigin = { longitude: 23.75, latitude: 61.49, elevation: 80 };
    const matrix = new THREE.Matrix4().makeScale(0.001, 0.001, 0.002);
    const texture = {} as WebGLTexture;
    receiver.setSource(() => ({ origin: shadowOrigin, texture, matrix }));
    expect(receiver.update(origin)).toBe(true);
    const receiverMercator = MercatorCoordinate.fromLngLat([origin.longitude, origin.latitude]);
    const shadowMercator = MercatorCoordinate.fromLngLat([shadowOrigin.longitude, shadowOrigin.latitude]);
    const point = new THREE.Vector3(12, 25, 7);
    const worldUnits = receiverMercator.meterInMercatorCoordinateUnits();
    const shadowUnits = shadowMercator.meterInMercatorCoordinateUnits();
    const expected = new THREE.Vector3(
      (receiverMercator.x + point.x * worldUnits - shadowMercator.x) / shadowUnits,
      (shadowMercator.y - receiverMercator.y + point.y * worldUnits) / shadowUnits,
      origin.elevation + point.z - shadowOrigin.elevation,
    ).applyMatrix4(matrix);
    const actual = point.applyMatrix4(uniforms.katuShadowMatrix.value);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
    expect(uniforms.katuShadowDepth.value.sourceTexture).toBe(texture);
    receiver.dispose();
  });

  it('disables sampling when the caster map is unavailable and follows replacement textures', () => {
    const { receiver, uniforms } = fixture();
    const origin = { longitude: 23.76, latitude: 61.5, elevation: 100 };
    let shadow: ModelShadowMap | undefined;
    receiver.setSource(() => shadow);
    expect(receiver.update(origin)).toBe(false);
    shadow = { origin, matrix: new THREE.Matrix4(), texture: {} as WebGLTexture };
    expect(receiver.update(origin)).toBe(true);
    const first = uniforms.katuShadowDepth.value.sourceTexture;
    shadow.texture = {} as WebGLTexture;
    receiver.update(origin);
    expect(uniforms.katuShadowDepth.value.sourceTexture).not.toBe(first);
    shadow = undefined;
    expect(receiver.update(origin)).toBe(false);
    expect(uniforms.katuShadowEnabled.value).toBe(false);
    expect(uniforms.katuShadowDepth.value.sourceTexture).toBeNull();
    receiver.dispose();
  });
});
