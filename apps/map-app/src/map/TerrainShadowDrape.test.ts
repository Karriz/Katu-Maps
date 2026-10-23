import { describe, expect, it } from 'vitest';
import { shadowLocalBounds, terrainTileMercatorBounds } from './TerrainShadowDrape';

describe('terrainTileMercatorBounds', () => {
  it('maps tile corners into the terrain height map coordinate system', () => {
    expect(terrainTileMercatorBounds({ canonical: { x: 1, y: 2, z: 3 } }))
      .toEqual([1 / 8, 2 / 8, 2 / 8, 3 / 8]);
  });

  it('keeps world copies in their unwrapped position', () => {
    expect(terrainTileMercatorBounds({ wrap: -1, canonical: { x: 7, y: 0, z: 3 } }))
      .toEqual([-1 / 8, 0, 0, 1 / 8]);
  });
});


describe('shadowLocalBounds', () => {
  it('preserves sub-metre offsets near a large Mercator coordinate', () => {
    const origin: [number, number, number, number] = [0.567123456789, 0.318987654321, 0.00000005, 100];
    const bounds: [number, number, number, number] = [
      origin[0] + 0.5 * origin[2], origin[1] - 0.25 * origin[2],
      origin[0] + 100.5 * origin[2], origin[1] + 99.75 * origin[2],
    ];
    const local = shadowLocalBounds(bounds, origin);
    expect(local[0]).toBeCloseTo(0.5, 6);
    expect(local[1]).toBeCloseTo(-0.25, 6);
    expect(local[2]).toBeCloseTo(100.5, 6);
    expect(local[3]).toBeCloseTo(99.75, 6);
    expect(Math.fround(bounds[0]) - Math.fround(origin[0])).toBe(0);
  });
});
