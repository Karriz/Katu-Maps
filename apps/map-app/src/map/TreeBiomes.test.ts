import { describe, expect, it } from 'vitest';
import { treeBiomeProfile, visibleBiome } from './TreeBiomes';

describe('treeBiomeProfile', () => {
  it('creates tall broad crowns in tropical rainforest and narrow conifers in taiga', () => {
    const tropical = treeBiomeProfile('Tropical & Subtropical Moist Broadleaf Forests');
    const taiga = treeBiomeProfile('Boreal Forests/Taiga');

    expect(tropical.coniferChance).toBeLessThan(0.1);
    expect(tropical.palmChance).toBeGreaterThan(0.1);
    expect(tropical.crownWidthScale).toBeGreaterThan(1);
    expect(taiga.coniferChance).toBeGreaterThan(0.8);
    expect(taiga.palmChance).toBe(0);
    expect(taiga.crownHeightScale).toBeGreaterThan(taiga.crownWidthScale);
  });

  it('uses the existing rendered biome layer at the map centre', () => {
    const map = {
      getCenter: () => ({ lng: 23.76, lat: 61.5 }),
      project: () => ({ x: 100, y: 80 }),
      getLayer: () => ({}),
      queryRenderedFeatures: () => [{ properties: { biome: 'Boreal Forests/Taiga' } }],
    };

    expect(visibleBiome(map as any, 'global-globe-biomes')).toBe('Boreal Forests/Taiga');
  });
});
