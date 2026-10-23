import * as THREE from 'three';

/** Tiny deterministic plaster relief. UVs repeat in world metres on each wall. */
export function createBuildingNormalMap() {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  const height = (x: number, y: number) => {
    const seam = x % 16 === 0 || y % 12 === 0 ? -0.6 : 0;
    return seam + 0.18 * Math.sin(x * 1.71 + y * 2.39)
      + 0.12 * Math.sin(x * 3.87 - y * 1.23);
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = height((x + 1) % size, y) - height((x + size - 1) % size, y);
      const dy = height(x, (y + 1) % size) - height(x, (y + size - 1) % size);
      const normal = new THREE.Vector3(-dx * 0.13, -dy * 0.13, 1).normalize();
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      pixels[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      pixels[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** An outdoor sky/ground reflection that does not depend on remote imagery. */
export function createBuildingEnvironmentMap() {
  const width = 64;
  const height = 32;
  const pixels = new Uint8Array(width * height * 4);
  const sky = new THREE.Color('#c9dfe6');
  const horizon = new THREE.Color('#e2e7db');
  const ground = new THREE.Color('#9caea6');
  for (let y = 0; y < height; y += 1) {
    const fraction = y / (height - 1);
    const color = fraction < 0.5
      ? sky.clone().lerp(horizon, fraction * 2)
      : horizon.clone().lerp(ground, (fraction - 0.5) * 2);
    const encoded = color.convertLinearToSRGB();
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = Math.round(encoded.r * 255);
      pixels[offset + 1] = Math.round(encoded.g * 255);
      pixels[offset + 2] = Math.round(encoded.b * 255);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
