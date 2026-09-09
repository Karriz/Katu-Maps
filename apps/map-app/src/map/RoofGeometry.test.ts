import { describe, expect, it } from 'vitest';
import { generateRoofGeometry, isEligibleFootprint } from './RoofGeometry';

function projectedTriangleArea(positions: Float32Array, indices: Uint16Array | Uint32Array) {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    area += Math.abs(
      (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2])
      - (positions[c] - positions[a]) * (positions[b + 2] - positions[a + 2]),
    ) / 2;
  }
  return area;
}

describe('RoofGeometry', () => {
  it('tiles a hipped roof footprint once without crossing faces', () => {
    const roof = generateRoofGeometry({
      ring: [[-10, -4], [10, -4], [10, 4], [-10, 4], [-10, -4]],
      wallHeight: 5,
      type: 'hipped',
      pitchDegrees: 30,
      featureId: 1,
    });

    expect(roof).not.toBeNull();
    expect(projectedTriangleArea(roof!.positions, roof!.indices)).toBeCloseTo(160, 4);
  });

  it('keeps the ridge on the long axis when source edges are subdivided', () => {
    const roof = generateRoofGeometry({
      ring: [
        [-10, -4], [-3, -4], [3, -4], [10, -4], [10, 4],
        [3, 4], [-3, 4], [-10, 4], [-10, -4],
      ],
      wallHeight: 5,
      type: 'pitched',
      pitchDegrees: 30,
      featureId: 2,
    });

    expect(roof).not.toBeNull();
    const ridgeStart = 2 * 3;
    const ridgeEnd = 5 * 3;
    const ridgeX = Math.abs(roof!.positions[ridgeEnd] - roof!.positions[ridgeStart]);
    const ridgeZ = Math.abs(roof!.positions[ridgeEnd + 2] - roof!.positions[ridgeStart + 2]);
    expect(ridgeX).toBeGreaterThan(ridgeZ);
  });

  describe('isEligibleFootprint', () => {
    it('accepts a simple rectangle', () => {
      expect(isEligibleFootprint([[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]])).toBe(true);
    });

    it('accepts a rectangle with extra collinear vertices', () => {
      expect(isEligibleFootprint([
        [0, 0], [5, 0], [10, 0], [10, 3], [10, 6],
        [5, 6], [0, 6], [0, 3], [0, 0],
      ])).toBe(true);
    });

    it('rejects an L-shaped footprint', () => {
      expect(isEligibleFootprint([
        [0, 0], [10, 0], [10, 3], [4, 3], [4, 6], [0, 6], [0, 0],
      ])).toBe(false);
    });

    it('rejects a convex pentagon that is not rectangular', () => {
      // Regular pentagon with ~10 m radius, area ~240 m², but OBB fill < 0.85.
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5;
        pts.push([Math.cos(a) * 9, Math.sin(a) * 9]);
      }
      pts.push([pts[0][0], pts[0][1]]);
      expect(isEligibleFootprint(pts)).toBe(false);
    });

    it('rejects a very long and thin rectangle', () => {
      // 18 m × 5 m = 90 m², aspect ratio 3.6:1.
      expect(isEligibleFootprint([[0, 0], [18, 0], [18, 5], [0, 5], [0, 0]])).toBe(false);
    });

    it('rejects a footprint that is too small to be a whole building', () => {
      // 3 m × 4 m = 12 m², below the minimum house area.
      expect(isEligibleFootprint([[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]])).toBe(false);
    });

    it('rejects a footprint that is too narrow', () => {
      // 2.5 m × 8 m = 20 m², shorter side below minimum width.
      expect(isEligibleFootprint([[0, 0], [8, 0], [8, 2.5], [0, 2.5], [0, 0]])).toBe(false);
    });
  });
});
