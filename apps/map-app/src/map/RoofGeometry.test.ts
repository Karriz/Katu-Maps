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

  it('aligns a hipped roof to a 45-degree rotated footprint', () => {
    // A 20×8 rectangle rotated 45° — the OBB angle is non-zero, so the
    // hipped roof must rotate its vertices back from OBB to local space.
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    const w = 10, d = 4;
    const ring: Array<[number, number]> = [
      [-w * cos45 - d * sin45, -w * sin45 + d * cos45],
      [w * cos45 - d * sin45, w * sin45 + d * cos45],
      [w * cos45 + d * sin45, w * sin45 - d * cos45],
      [-w * cos45 + d * sin45, -w * sin45 - d * cos45],
      [-w * cos45 - d * sin45, -w * sin45 + d * cos45],
    ];
    const roof = generateRoofGeometry({
      ring,
      wallHeight: 5,
      type: 'hipped',
      pitchDegrees: 30,
      featureId: 3,
    });

    expect(roof).not.toBeNull();
    // Eave corner 0 (index 0) and corner 1 (index 1) should be 20 m apart
    // (the long edge), and corner 0 and corner 3 (index 3) should be 8 m
    // apart (the short edge). If the rotation back was missing, the
    // distances would be wrong because the OBB angle is ~45°.
    const p0x = roof!.positions[0], p0z = roof!.positions[2];
    const p1x = roof!.positions[3], p1z = roof!.positions[5];
    const p3x = roof!.positions[9], p3z = roof!.positions[11];
    const longEdge = Math.hypot(p1x - p0x, p1z - p0z);
    const shortEdge = Math.hypot(p3x - p0x, p3z - p0z);
    expect(longEdge).toBeCloseTo(20, 1);
    expect(shortEdge).toBeCloseTo(8, 1);
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
      // Regular pentagon with ~10 m radius, area ~240 m², but OBB fill < 0.93.
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5;
        pts.push([Math.cos(a) * 9, Math.sin(a) * 9]);
      }
      pts.push([pts[0][0], pts[0][1]]);
      expect(isEligibleFootprint(pts)).toBe(false);
    });

    it('rejects a trapezoid whose roof would overhang the walls', () => {
      // 12 m wide at one end, 9 m wide at the other, 6 m tall.
      // Area = 63 m², OBB area = 72 m², ratio = 0.875 — passes 0.85 but
      // fails 0.93, so the gable eaves would not extend past the narrow wall.
      expect(isEligibleFootprint([
        [0, 0], [12, 0], [10.5, 6], [1.5, 6], [0, 0],
      ])).toBe(false);
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
