import { expect, test } from '@playwright/test';

test('building materials preserve sun, shade ambient contacts, and reflect the current sky', async ({ page }) => {
  await page.route('**/building-material-test', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
  }));
  await page.goto('/building-material-test');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { applyBuildingSurfaceMaterial } = await import('/src/map/BuildingSurfaceMaterial.ts');
    const { WindowSkyReflection } = await import('/src/map/WindowSkyReflection.ts');
    const { ModelShadowReceiver } = await import('/src/map/ModelShadowReceiver.ts');
    const { addRoofMaterialUvs, createBuildingNormalMap } = await import('/src/map/BuildingMaterials.ts');
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
    renderer.setSize(64, 64);
    const gl = renderer.getContext();
    const camera = new THREE.OrthographicCamera(-2, 2, 4, 0, 0.1, 30);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const geometry = new THREE.PlaneGeometry(4, 4);
    geometry.translate(0, 2, 0);
    const wallUvs = geometry.getAttribute('uv');
    for (let index = 0; index < wallUvs.count; index++) {
      wallUvs.setXY(index, wallUvs.getX(index) / 2, wallUvs.getY(index) / 2);
    }
    const positions = geometry.getAttribute('position');
    const contact = new Float32Array(positions.count * 2);
    const setContact = (enabled: boolean) => {
      for (let index = 0; index < positions.count; index++) {
        contact[index * 2] = enabled ? positions.getY(index) : -1;
        contact[index * 2 + 1] = enabled ? 4 - positions.getY(index) : 100;
      }
      geometry.setAttribute('buildingContact', new THREE.BufferAttribute(contact.slice(), 2));
    };
    const material = new THREE.MeshStandardMaterial({ roughness: 0.94 });
    const shadows = new ModelShadowReceiver();
    shadows.apply(material);
    applyBuildingSurfaceMaterial(material);
    const scene = new THREE.Scene();
    const ambient = new THREE.AmbientLight(0xffffff, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.position.set(0, 0, 10);
    scene.add(new THREE.Mesh(geometry, material), ambient, sun);
    const pixel = (y: number) => {
      renderer.render(scene, camera);
      const bytes = new Uint8Array(4);
      gl.readPixels(32, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes[0];
    };
    setContact(false);
    const ambientBase = pixel(5);
    const ambientMiddle = pixel(32);
    setContact(true);
    const contactBase = pixel(5);
    const contactMiddle = pixel(32);
    ambient.intensity = 0;
    sun.intensity = 2;
    const sunContact = pixel(5);
    setContact(false);
    const sunPlain = pixel(5);
    sun.position.set(6, 3, 8);
    const readWallPatch = () => {
      renderer.render(scene, camera);
      const bytes = new Uint8Array(16 * 16 * 4);
      gl.readPixels(24, 24, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    const smoothWall = readWallPatch();
    const wallNormal = createBuildingNormalMap();
    material.normalMap = wallNormal;
    material.normalScale.set(0.65, 0.65);
    material.needsUpdate = true;
    const texturedWall = readWallPatch();
    let normalMaxDifference = 0;
    for (let index = 0; index < smoothWall.length; index += 4) {
      normalMaxDifference = Math.max(normalMaxDifference, Math.abs(smoothWall[index] - texturedWall[index]));
    }

    // Compile the textured roof path with UVs prepared exactly as production.
    const roofGeometry = new THREE.PlaneGeometry(4, 4);
    roofGeometry.rotateX(-Math.PI / 2);
    addRoofMaterialUvs(roofGeometry);
    const roofNormal = createBuildingNormalMap('roof');
    const roofMaterial = new THREE.MeshStandardMaterial({ normalMap: roofNormal, roughness: 0.8 });
    shadows.apply(roofMaterial);
    const roof = new THREE.Scene();
    roof.add(new THREE.Mesh(roofGeometry, roofMaterial), new THREE.AmbientLight(0xffffff, 1));
    const roofCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 30);
    roofCamera.position.set(0, 10, 0);
    roofCamera.lookAt(0, 0, 0);
    renderer.render(roof, roofCamera);

    const reflection = new WindowSkyReflection();
    const glass = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.28 });
    shadows.apply(glass);
    reflection.apply(glass);
    const windowScene = new THREE.Scene();
    const windowGeometry = new THREE.PlaneGeometry(4, 4);
    windowScene.add(new THREE.Mesh(windowGeometry, glass));
    const view = new THREE.PerspectiveCamera(45, 1, 0.1, 30);
    view.position.set(0, 0, 10);
    view.lookAt(0, 0, 0);
    view.updateMatrixWorld();
    const mapCamera = new THREE.Camera();
    mapCamera.projectionMatrix.copy(view.projectionMatrix).multiply(view.matrixWorldInverse);
    reflection.updateCamera(mapCamera.projectionMatrix, view.projectionMatrix.elements);
    const readGlass = (sky: string, night = 0) => {
      reflection.setAppearance({ sky, horizon: sky, land: sky }, night);
      renderer.render(windowScene, mapCamera);
      const bytes = new Uint8Array(4);
      gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return Array.from(bytes);
    };
    const redSky = readGlass('#ff0000');
    const blueSky = readGlass('#0000ff');
    const nightSky = readGlass('#081220', 1);
    reflection.setSun(0, 0);
    const sunAligned = readGlass('#000000');
    reflection.setSun(90, 60);
    const sunOblique = readGlass('#000000');
    const failedPrograms = (renderer.info.programs ?? []).filter((program: any) =>
      program.diagnostics?.runnable === false).length;
    const glError = gl.getError();
    geometry.dispose(); material.dispose(); wallNormal.dispose(); shadows.dispose();
    roofGeometry.dispose(); roofMaterial.dispose(); roofNormal.dispose();
    windowGeometry.dispose(); glass.dispose(); renderer.dispose();
    return { ambientBase, ambientMiddle, contactBase, contactMiddle,
      sunContact, sunPlain, normalMaxDifference, redSky, blueSky, nightSky, sunAligned, sunOblique, failedPrograms, glError };
  });
  expect(result.failedPrograms).toBe(0);
  expect(result.glError).toBe(0);
  expect(result.ambientBase - result.contactBase).toBeGreaterThan(2);
  expect(result.ambientBase - result.contactBase).toBeGreaterThan(result.ambientMiddle - result.contactMiddle);
  expect(Math.abs(result.sunContact - result.sunPlain)).toBeLessThan(2);
  expect(result.normalMaxDifference, 'the wall normal map visibly changes oblique lighting').toBeGreaterThan(5);
  expect(result.redSky[0] - result.redSky[2]).toBeGreaterThan(20);
  expect(result.blueSky[2] - result.blueSky[0]).toBeGreaterThan(20);
  expect(result.nightSky[2]).toBeLessThan(result.blueSky[2]);
  expect(result.sunAligned[0] - result.sunOblique[0], 'sun reflection appears at its mirror angle').toBeGreaterThan(50);
});
