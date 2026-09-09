import { describe, expect, it } from 'vitest';
import { generateFacadeGeometry, isEligibleFacadeFootprint } from './FacadeGeometry';

describe('FacadeGeometry', () => {
  describe('isEligibleFacadeFootprint', () => {
    it('accepts a simple rectangle', () => {
      expect(isEligibleFacadeFootprint([[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]])).toBe(true);
    });

    it('accepts a rectangle with extra collinear vertices', () => {
      expect(isEligibleFacadeFootprint([
        [0, 0], [5, 0], [10, 0], [10, 3], [10, 6],
        [5, 6], [0, 6], [0, 3], [0, 0],
      ])).toBe(true);
    });

    it('accepts a larger building that roofs would reject', () => {
      // 30 × 20 = 600 m² — at the roof max but well within the facade max.
      expect(isEligibleFacadeFootprint([[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]])).toBe(true);
    });

    it('accepts a pentagon that roofs would reject', () => {
      // Chamfered rectangle: cut one corner of a 10×8 box at 45°.
      // Area ≈ 76 m², OBB fill ≈ 0.88 — passes 0.80 but fails 0.93.
      expect(isEligibleFacadeFootprint([
        [0, 0], [10, 0], [10, 6], [8, 8], [0, 8], [0, 0],
      ])).toBe(true);
    });

    it('rejects an L-shaped footprint', () => {
      expect(isEligibleFacadeFootprint([
        [0, 0], [10, 0], [10, 3], [4, 3], [4, 6], [0, 6], [0, 0],
      ])).toBe(false);
    });

    it('rejects a footprint that is too small', () => {
      expect(isEligibleFacadeFootprint([[0, 0], [5, 0], [5, 4], [0, 4], [0, 0]])).toBe(false);
    });

    it('rejects a footprint that is too narrow', () => {
      expect(isEligibleFacadeFootprint([[0, 0], [20, 0], [20, 3.5], [0, 3.5], [0, 0]])).toBe(false);
    });

    it('rejects a very elongated rectangle', () => {
      // 30 × 4 = 120 m², aspect ratio 7.5:1.
      expect(isEligibleFacadeFootprint([[0, 0], [30, 0], [30, 4], [0, 4], [0, 0]])).toBe(false);
    });
  });

  describe('generateFacadeGeometry', () => {
    it('generates window quads for a rectangular building', () => {
      const facade = generateFacadeGeometry({
        ring: [[-5, -3], [5, -3], [5, 3], [-5, 3], [-5, -3]],
        wallHeight: 9,
        featureId: 1,
      });

      expect(facade).not.toBeNull();
      // 4 vertices per window quad, 6 indices per quad.
      expect(facade!.positions.length % 12).toBe(0);
      expect(facade!.indices.length % 6).toBe(0);
      // At least some windows on a 10×6 building with 3 stories.
      expect(facade!.indices.length / 6).toBeGreaterThan(4);
    });

    it('produces no geometry for a building with only very short walls', () => {
      // All edges under MIN_EDGE_LENGTH_M (2 m).
      const facade = generateFacadeGeometry({
        ring: [[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5], [0, 0]],
        wallHeight: 6,
        featureId: 1,
      });

      expect(facade).toBeNull();
    });

    it('places windows within the wall height range', () => {
      const facade = generateFacadeGeometry({
        ring: [[-5, -3], [5, -3], [5, 3], [-5, 3], [-5, -3]],
        wallHeight: 6,
        featureId: 0,
      });

      expect(facade).not.toBeNull();
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 1; i < facade!.positions.length; i += 3) {
        minY = Math.min(minY, facade!.positions[i]);
        maxY = Math.max(maxY, facade!.positions[i]);
      }
      expect(minY).toBeGreaterThanOrEqual(0);
      expect(maxY).toBeLessThanOrEqual(6);
    });

    it('deterministically varies window count by feature ID', () => {
      const ring: Array<[number, number]> = [[-8, -5], [8, -5], [8, 5], [-8, 5], [-8, -5]];
      const results = new Set<number>();
      for (let id = 0; id < 4; id++) {
        const facade = generateFacadeGeometry({ ring, wallHeight: 12, featureId: id });
        expect(facade).not.toBeNull();
        results.add(facade!.indices.length);
      }
      // At least two different window counts across the 4 style variants.
      expect(results.size).toBeGreaterThan(1);
    });
  });
});
