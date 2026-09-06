import { describe, expect, it } from 'vitest';
import {
  buildingShadowTranslate,
  cartoonDayNightAppearance,
  dayNightAppearance,
  globeShadeOpacity,
  localStyleMix,
  mixHex,
  nightFactor,
  paletteForElevation,
} from './DayNightAppearance';
import { CARTOON_BUILDING_SHADOW_TRANSLATE, CARTOON_SUN_AZIMUTH_DEGREES } from './CartoonLighting';

describe('day/night appearance', () => {
  it('keeps the globe overlay opaque in space and gone at street scale', () => {
    expect(globeShadeOpacity(1)).toBeCloseTo(1, 3);
    expect(globeShadeOpacity(12)).toBeCloseTo(0, 3);
    expect(localStyleMix(1)).toBeCloseTo(0, 3);
    expect(localStyleMix(12)).toBeCloseTo(1, 3);
  });

  it('warms the palette at sunset and cools it after dusk', () => {
    const day = paletteForElevation(40);
    const sunset = paletteForElevation(2);
    const night = paletteForElevation(-20);
    expect(day.land).toBe('#c9e0b4');
    expect(sunset.horizon.toLowerCase()).not.toBe(day.horizon.toLowerCase());
    expect(night.background).toBe('#071525');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('points building footprint shade away from the cartoon sun', () => {
    const [east, south] = buildingShadowTranslate(CARTOON_SUN_AZIMUTH_DEGREES, 35);
    expect(Math.sign(east)).toBe(Math.sign(CARTOON_BUILDING_SHADOW_TRANSLATE[0]));
    expect(Math.sign(south)).toBe(Math.sign(CARTOON_BUILDING_SHADOW_TRANSLATE[1]));
    expect(east).toBeCloseTo(CARTOON_BUILDING_SHADOW_TRANSLATE[0], 5);
    expect(south).toBeCloseTo(CARTOON_BUILDING_SHADOW_TRANSLATE[1], 5);
  });

  it('lengthens the footprint shade when the sun is lower', () => {
    const high = buildingShadowTranslate(180, 25);
    const low = buildingShadowTranslate(180, 70);
    expect(Math.hypot(...low)).toBeGreaterThan(Math.hypot(...high));
  });

  it('returns a night appearance for Tampere at 21:00 UTC in December', () => {
    const appearance = dayNightAppearance(new Date(Date.UTC(2024, 11, 21, 21, 0)), 61.5, 23.8, 14);
    expect(appearance.phase).toBe('night');
    expect(appearance.shadeOpacity).toBeCloseTo(0, 3);
    expect(appearance.treeNightMix).toBeGreaterThan(0.8);
    expect(appearance.palette.water).toBe('#0a2c46');
  });

  it('keeps globe noon close to the cartoon defaults', () => {
    const appearance = dayNightAppearance(new Date(Date.UTC(2024, 5, 21, 10, 0)), 61.5, 23.8, 1.5);
    expect(appearance.phase).toBe('day');
    expect(appearance.shadeOpacity).toBeCloseTo(1, 3);
    expect(localStyleMix(1.5)).toBeCloseTo(0, 3);
    expect(cartoonDayNightAppearance().azimuth).toBe(CARTOON_SUN_AZIMUTH_DEGREES);
    expect(nightFactor(40)).toBeCloseTo(0, 3);
  });
});
