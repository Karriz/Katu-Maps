import { expect, test } from '@playwright/test';

test('shared caster depth shadows standard and Lambert receivers across renderers', async ({ page }) => {
  await page.route('**/model-shadow-test', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
  }));
  await page.goto('/model-shadow-test');
  const result = await page.evaluate(async () => {
    // Exercise the actual GL programs and external texture binding, without map/provider timing.
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { ModelShadowReceiver } = await import('/src/map/ModelShadowReceiver.ts');
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
    const casterRenderer = new THREE.WebGLRenderer({ canvas, context: gl });
    casterRenderer.setSize(64, 64);
    casterRenderer.shadowMap.enabled = true;
    casterRenderer.shadowMap.type = THREE.BasicShadowMap;
    const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 30);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const casters = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(0, 0, 10);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 30 });
    sun.shadow.mapSize.set(128, 128);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    box.position.z = 1;
    box.castShadow = true;
    casters.add(sun, sun.target, box);
    casterRenderer.render(casters, camera);
    const depth = casterRenderer.properties.get(sun.shadow.map!.depthTexture).__webglTexture;
    const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    renderer.setSize(64, 64);
    const origin = { longitude: 23.76, latitude: 61.5, elevation: 0 };
    const samples = [];
    for (const kind of ['standard', 'lambert']) {
      const receiver = new ModelShadowReceiver();
      receiver.setSource(() => ({ texture: depth, matrix: sun.shadow.matrix, origin }));
      const material = kind === 'standard' ? new THREE.MeshStandardMaterial()
        : new THREE.MeshLambertMaterial();
      receiver.apply(material);
      const scene = new THREE.Scene();
      const light = new THREE.DirectionalLight(0xffffff, 2);
      light.position.set(0, 0, 10);
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(8, 8), material),
        new THREE.AmbientLight(0xffffff, 0.2), light, light.target);
      const sample = () => {
        renderer.resetState();
        renderer.render(scene, camera);
        const pixel = new Uint8Array(4);
        gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[0];
      };
      receiver.update(origin);
      const shadowed = sample();
      receiver.setSource(() => ({ texture: depth, matrix: sun.shadow.matrix, origin, strength: 0.5 }));
      receiver.update(origin);
      const partial = sample();
      receiver.setSource(() => undefined);
      receiver.update(origin);
      const lit = sample();
      samples.push({ kind, shadowed, partial, lit });
      scene.traverse((object: any) => object.geometry?.dispose());
      material.dispose();
      receiver.dispose();
    }
    // A wall facing an oblique sun must not shadow its own neighboring depth texels.
    casters.remove(box);
    const wallGeometry = new THREE.PlaneGeometry(8, 8);
    const casterWall = new THREE.Mesh(wallGeometry, box.material);
    casterWall.castShadow = true;
    casters.add(casterWall);
    sun.position.set(6, 4, 8);
    casterRenderer.resetState();
    casterRenderer.render(casters, camera);
    const wallReceiver = new ModelShadowReceiver();
    wallReceiver.setSource(() => ({ texture: depth, matrix: sun.shadow.matrix, origin }));
    const wallMaterial = new THREE.MeshStandardMaterial();
    wallReceiver.apply(wallMaterial);
    const wallScene = new THREE.Scene();
    const wallLight = new THREE.DirectionalLight(0xffffff, 2);
    wallLight.position.copy(sun.position);
    wallScene.add(new THREE.Mesh(wallGeometry, wallMaterial), wallLight,
      new THREE.AmbientLight(0xffffff, 0.2));
    const readWall = () => {
      renderer.resetState();
      renderer.render(wallScene, camera);
      const pixels = new Uint8Array(16 * 16 * 4);
      gl.readPixels(24, 24, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    wallReceiver.update(origin);
    const wallShadowed = readWall();
    wallReceiver.setSource(() => undefined);
    wallReceiver.update(origin);
    const wallLit = readWall();
    let wallMaxDifference = 0;
    for (let i = 0; i < wallLit.length; i += 4) {
      wallMaxDifference = Math.max(wallMaxDifference, Math.abs(wallLit[i] - wallShadowed[i]));
    }
    wallReceiver.dispose();
    wallMaterial.dispose();
    wallGeometry.dispose();
    const shaderFailures = (renderer.info.programs ?? []).filter((program: any) =>
      program.diagnostics?.runnable === false).length;
    sun.shadow.dispose();
    box.geometry.dispose();
    box.material.dispose();
    renderer.dispose();
    casterRenderer.dispose();
    return { samples, wallMaxDifference, shaderFailures, glError: gl.getError() };
  });
  expect(result.shaderFailures).toBe(0);
  expect(result.glError).toBe(0);
  expect(result.wallMaxDifference, 'an unobstructed wall should not develop self-shadow stripes').toBeLessThan(5);
  for (const sample of result.samples) {
    expect(sample.shadowed, `${sample.kind} preserves ambient lighting`).toBeGreaterThan(10);
    expect(sample.lit - sample.shadowed,
      `${sample.kind} receives the caster shadow: ${JSON.stringify(result)}`).toBeGreaterThan(50);
    expect(sample.partial).toBeGreaterThan(sample.shadowed + 10);
    expect(sample.partial).toBeLessThan(sample.lit - 10);
  }
});
