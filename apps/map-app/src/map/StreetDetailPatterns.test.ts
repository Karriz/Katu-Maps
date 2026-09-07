import { describe, expect, it } from 'vitest';
import {
  createGrassPattern,
  createPavingPattern,
  createSandPattern,
  STREET_SURFACE_PATTERN_LAYER_IDS,
  streetSurfacePatternLayers,
} from './StreetDetailPatterns';

function pixel(image: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

describe('street surface patterns', () => {
  it('creates deterministic seamless-size images', () => {
    const grass = createGrassPattern(64);
    const again = createGrassPattern(64);
    expect(grass.width).toBe(64);
    expect(grass.data).toEqual(again.data);
    expect(pixel(grass, 8, 8)).not.toEqual(pixel(grass, 40, 28));
  });

  it('keeps paving joints darker than slabs and sand variation restrained', () => {
    const paving = createPavingPattern(64);
    const sand = createSandPattern(64);
    const slab = pixel(paving, 10, 10);
    const joint = pixel(paving, 0, 10);
    expect(joint[0]).toBeLessThan(slab[0]);
    expect(pixel(sand, 4, 4)[0]).toBeGreaterThan(200);
  });

  it('fades pattern overlays in only at close zoom', () => {
    const layers = streetSurfacePatternLayers();
    expect(layers.map((layer) => layer.id)).toEqual([...STREET_SURFACE_PATTERN_LAYER_IDS]);
    for (const layer of layers) {
      expect(layer.minzoom).toBeGreaterThanOrEqual(13);
      expect(JSON.stringify(layer.paint?.['fill-opacity'])).toContain('13');
    }
  });
});
