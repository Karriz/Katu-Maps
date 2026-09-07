import { describe, expect, it } from 'vitest';
import {
  createAllotmentPattern,
  createCemeteryPattern,
  createFarmlandPattern,
  createGrassPattern,
  createPitchPattern,
  createSandPattern,
  createWetlandPattern,
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

  it('keeps sand, wood, and pitch marks distinct', () => {
    expect(pixel(createSandPattern(64), 4, 4)[0]).toBeGreaterThan(200);
    const pitch = createPitchPattern(64);
    expect(pixel(pitch, 4, 4)).not.toEqual(pixel(pitch, 4, 12));
    const wood = createWoodPattern(64);
    expect(pixel(wood, 8, 8)).not.toEqual(pixel(wood, 40, 28));
  });

  it('adds farmland, wetland, cemetery, and allotment character', () => {
    const farm = createFarmlandPattern(64);
    expect(pixel(farm, 2, 2)).not.toEqual(pixel(farm, 10, 2));
    const wetland = createWetlandPattern(64);
    expect(pixel(wetland, 0, 0)[1]).toBeGreaterThan(140);
    expect(createCemeteryPattern(64).data.some((value, index) => index % 4 === 0 && value < 170)).toBe(true);
    const allotment = createAllotmentPattern(64);
    expect(pixel(allotment, 0, 8)).not.toEqual(pixel(allotment, 4, 8));
  });

  it('fades surface overlays in only at close zoom', () => {
    const layers = streetSurfacePatternLayers();
    expect(layers.map((layer) => layer.id)).toEqual([...STREET_SURFACE_PATTERN_LAYER_IDS]);
    expect(layers.some((layer) => layer.id.includes('paving'))).toBe(false);
    for (const layer of layers) {
      expect(layer.minzoom).toBeGreaterThanOrEqual(13);
      expect(JSON.stringify(layer.paint?.['fill-opacity'])).toContain('13');
    }
    expect(JSON.stringify(layers.find((layer) => layer.id === 'global-grass-pattern')?.paint))
      .toContain('0.52');
  });
});
