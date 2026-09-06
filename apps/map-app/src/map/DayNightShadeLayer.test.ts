import { describe, expect, it } from 'vitest';
import { createGlobeMesh } from './DayNightShadeLayer';

describe('day/night globe coverage', () => {
  it('covers both poles with finite Mercator fallback coordinates', () => {
    const mesh = createGlobeMesh();
    const latitudes = Array.from(mesh.lnglats).filter((_, index) => index % 2 === 1);
    expect(Math.max(...latitudes)).toBe(90);
    expect(Math.min(...latitudes)).toBe(-90);
    expect(Array.from(mesh.mercators).every(Number.isFinite)).toBe(true);
    const referencedLatitudes = Array.from(mesh.indices, (index) => mesh.lnglats[index * 2 + 1]);
    expect(referencedLatitudes).toContain(90);
    expect(referencedLatitudes).toContain(-90);
  });

  it('closes the longitude seam at every latitude without increasing the mesh budget', () => {
    const mesh = createGlobeMesh();
    const stride = 145;
    expect(mesh.lnglats.length / 2).toBe(73 * stride);
    expect(mesh.indices.length).toBe(72 * 144 * 6);
    for (let row = 0; row < 73; row += 1) {
      const start = row * stride * 2;
      const end = start + (stride - 1) * 2;
      expect(mesh.lnglats[start]).toBe(-180);
      expect(mesh.lnglats[end]).toBe(180);
      expect(mesh.lnglats[start + 1]).toBe(mesh.lnglats[end + 1]);
    }
  });
});
