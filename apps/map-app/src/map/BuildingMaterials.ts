import * as THREE from 'three';

/** Tiny deterministic plaster relief. UVs repeat in world metres on each wall. */
export function createBuildingNormalMap(surface: 'wall' | 'roof' = 'wall') {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  const noise = (x: number, y: number, cell: number) => {
    const period = size / cell;
    const gx = x / cell, gy = y / cell;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const hash = (a: number, b: number) => {
      let seed = Math.imul((a + period) % period, 374761393)
        ^ Math.imul((b + period) % period, 668265263);
      seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
      return ((seed ^ (seed >>> 16)) >>> 0) / 4294967295;
    };
    const fx = gx - ix, fy = gy - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
      THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
  };
  const height = (x: number, y: number) => {
    if (surface === 'roof') return (x % 16 === 0 ? -0.8 : 0)
      + (y % 32 === 0 ? -0.4 : 0) + 0.3 * noise(x, y, 4);
    // Periodic multi-scale plaster grain, without a visible sine-wave lattice.
    return 0.8 * noise(x, y, 8) + 0.35 * noise(x, y, 2) + 0.2 * noise(x, y, 16);
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = height((x + 1) % size, y) - height((x + size - 1) % size, y);
      const dy = height(x, (y + 1) % size) - height(x, (y + size - 1) % size);
      const gain = surface === 'wall' ? 1 : 0.65;
      const normal = new THREE.Vector3(-dx * gain, -dy * gain, 1).normalize();
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
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (surface === 'wall') texture.repeat.set(2, 2);
  texture.needsUpdate = true;
  return texture;
}

/** Face-aligned metre UVs, generated before a roof is moved into the map frame. */
export function addRoofMaterialUvs(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uvs = new Float32Array(positions.count * 2);
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    normal.fromBufferAttribute(normals, index);
    tangent.set(normal.z, 0, -normal.x);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    else tangent.normalize();
    bitangent.crossVectors(normal, tangent).normalize();
    point.fromBufferAttribute(positions, index);
    uvs[index * 2] = point.dot(tangent) / 2;
    uvs[index * 2 + 1] = point.dot(bitangent) / 2;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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
