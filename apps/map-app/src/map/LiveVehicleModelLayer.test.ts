import { describe, expect, it, vi } from 'vitest';
import { vehicleSlopePitch, vehicleSurfaceElevation } from './LiveVehicleModelLayer';

describe('live vehicle terrain placement', () => {
  it('uses a bridge deck before terrain, falling back when neither is available', () => {
    const terrain = vi.fn(() => 12);
    expect(vehicleSurfaceElevation(34, terrain, 0)).toBe(34);
    expect(terrain).not.toHaveBeenCalled();
    expect(vehicleSurfaceElevation(null, terrain, 0)).toBe(12);
    expect(vehicleSurfaceElevation(null, () => null, 5)).toBe(5);
  });

  it('pitches uphill and downhill independently while clamping steep DEM noise', () => {
    expect(vehicleSlopePitch(3, 1, 10)).toBeLessThan(0);
    expect(vehicleSlopePitch(1, 3, 10)).toBeGreaterThan(0);
    expect(vehicleSlopePitch(100, 0, 10)).toBeCloseTo(-0.22);
  });
});
