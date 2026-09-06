import { describe, expect, it } from 'vitest';
import { globeCloudOpacity, globeCloudPixels } from './GlobeClouds';
import type { ForecastGrid } from './Weather';

describe('globe cloud fade', () => {
  it('shows clouds at globe scale and removes them before city scale', () => {
    expect(globeCloudOpacity(1)).toBeGreaterThan(0);
    expect(globeCloudOpacity(1)).toBeLessThan(0.6);
    expect(globeCloudOpacity(4)).toBeLessThan(globeCloudOpacity(2));
    expect(globeCloudOpacity(5.5)).toBe(0);
    expect(globeCloudOpacity(14)).toBe(0);
  });

  it('fades monotonically without negative opacity', () => {
    let previous = 1;
    for (let zoom = 0; zoom <= 22; zoom += 0.1) {
      const opacity = globeCloudOpacity(zoom);
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(previous);
      previous = opacity;
    }
  });
});

describe('globe cloud texture', () => {
  it('upsamples the model grid for smoother globe sampling', () => {
    const grid: ForecastGrid = {
      west: -180,
      east: 180,
      south: -90,
      north: 90,
      columns: 3,
      rows: 3,
      times: ['2026-09-06T12:00'],
      cloudCover: [
        [0], [50], [0],
        [20], [100], [20],
        [0], [50], [0],
      ],
      precipitation: [
        [0], [0], [0],
        [0], [0], [0],
        [0], [0], [0],
      ],
    };
    const pixels = globeCloudPixels(grid);
    expect(pixels.width).toBeGreaterThan(grid.columns);
    expect(pixels.height).toBeGreaterThan(grid.rows);
    expect(pixels.data.length).toBe(pixels.width * pixels.height * 4);
    const mid = ((Math.floor(pixels.height / 2) * pixels.width) + Math.floor(pixels.width / 2)) * 4;
    expect(pixels.data[mid]).toBeGreaterThan(200);
  });
});
