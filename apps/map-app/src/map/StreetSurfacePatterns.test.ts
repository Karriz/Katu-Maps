import { describe, expect, it } from 'vitest';
import {
  createGrassPattern,
  createPitchPattern,
  createSandPattern,
  createWoodPattern,
  STREET_SURFACE_PATTERN_LAYER_IDS,
  streetSurfacePatternLayers,
} from './StreetSurfacePatterns';

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

  it('keeps sand variation restrained and pitch stripes distinct', () => {
    expect(pixel(createSandPattern(64), 4, 4)[0]).toBeGreaterThan(200);
    const pitch = createPitchPattern(64);
    expect(pixel(pitch, 4, 4)).not.toEqual(pixel(pitch, 4, 20));
    const wood = createWoodPattern(64);
    expect(pixel(wood, 8, 8)).not.toEqual(pixel(wood, 40, 28));
  });

  it('fades grass and sand overlays in only at close zoom', () => {
    const layers = streetSurfacePatternLayers();
    expect(layers.map((layer) => layer.id)).toEqual([...STREET_SURFACE_PATTERN_LAYER_IDS]);
    expect(layers.some((layer) => layer.id.includes('paving'))).toBe(false);
    for (const layer of layers) {
      expect(layer.minzoom).toBeGreaterThanOrEqual(13);
      expect(JSON.stringify(layer.paint?.['fill-opacity'])).toContain('13');
    }
  });
});
