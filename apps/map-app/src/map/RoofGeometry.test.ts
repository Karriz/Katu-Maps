import { describe, expect, it } from 'vitest';
import { generateFlatRoofGeometry, generateRoofGeometry, isEligibleFlatRoofFootprint, isEligibleFootprint } from './RoofGeometry';

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

  describe('flat roof', () => {
    it('accepts a larger building outline and rejects a small house', () => {
      expect(isEligibleFlatRoofFootprint([[-15, -15], [15, -15], [15, 15], [-15, 15], [-15, -15]])).toBe(true);
      // 8 m × 8 m = 64 m² — below the larger-building threshold.
      expect(isEligibleFlatRoofFootprint([[-4, -4], [4, -4], [4, 4], [-4, 4], [-4, -4]])).toBe(false);
    });

    it('rejects concave outlines that the inset cannot safely shrink', () => {
      expect(isEligibleFlatRoofFootprint([
        [0, 0], [30, 0], [30, 10], [10, 10], [10, 20], [0, 20], [0, 0],
      ])).toBe(false);
    });

    it('rejects a narrow slab wider than the minimum width allows', () => {
      // 40 m × 4 m = 160 m², but the shorter side is below the 5 m minimum.
      expect(isEligibleFlatRoofFootprint([[-20, -2], [20, -2], [20, 2], [-20, 2], [-20, -2]])).toBe(false);
    });

    it('produces an inset slab smaller than the footprint with an upward normal', () => {
      // 30 m × 30 m square (900 m²), centroided at the origin.
      const ring: Array<[number, number]> = [
        [-15, -15], [15, -15], [15, 15], [-15, 15], [-15, -15],
      ];
      const roof = generateFlatRoofGeometry({
        ring,
        wallHeight: 12,
        type: 'flat',
        pitchDegrees: 0,
        featureId: 7,
      });

      expect(roof).not.toBeNull();
      // The slab is inset 0.6 m on every side: 28.8 m × 28.8 m ≈ 829 m².
      expect(projectedTriangleArea(roof!.positions, roof!.indices)).toBeCloseTo(829.44, 1);
      // The whole slab lies flat at wall top (y = 0 in roof-local space).
      for (let i = 1; i < roof!.positions.length; i += 3) {
        expect(roof!.positions[i]).toBe(0);
      }
      // Every face normal points straight up.
      for (let i = 1; i < roof!.normals.length; i += 3) {
        expect(roof!.normals[i]).toBeCloseTo(1, 6);
        expect(roof!.normals[i - 1]).toBeCloseTo(0, 6);
        expect(roof!.normals[i + 1]).toBeCloseTo(0, 6);
      }
      // No vertex reaches the original wall edge.
      for (let i = 0; i < roof!.positions.length; i += 3) {
        expect(Math.abs(roof!.positions[i])).toBeLessThan(15);
        expect(Math.abs(roof!.positions[i + 2])).toBeLessThan(15);
      }
    });

    it('keeps the inset centred on a non-square rectangle', () => {
      // 40 m × 25 m = 1000 m², centroided.
      const ring: Array<[number, number]> = [
        [-20, -12.5], [20, -12.5], [20, 12.5], [-20, 12.5], [-20, -12.5],
      ];
      const roof = generateFlatRoofGeometry({
        ring,
        wallHeight: 10,
        type: 'flat',
        pitchDegrees: 0,
        featureId: 3,
      });

      expect(roof).not.toBeNull();
      // Inset 0.6 m: 38.8 m × 23.8 m ≈ 923 m².
      expect(projectedTriangleArea(roof!.positions, roof!.indices)).toBeCloseTo(923.44, 1);
      // The slab stays centred on the origin.
      let cx = 0;
      let cz = 0;
      const count = roof!.positions.length / 3;
      for (let i = 0; i < roof!.positions.length; i += 3) {
        cx += roof!.positions[i];
        cz += roof!.positions[i + 2];
      }
      expect(cx / count).toBeCloseTo(0, 6);
      expect(cz / count).toBeCloseTo(0, 6);
    });
  });
});
