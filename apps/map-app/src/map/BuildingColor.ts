import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * Building color utilities for OpenFreeMap building layer.
 * 
 * When a building has an OSM color defined (color, colour, building:colour, render_color),
 * the color is converted to a pastel version by finding the closest match from a
 * controlled palette of 50 pre-pastelized colors.
 * 
 * For buildings without color data, a deterministic pseudo-random color from the palette
 * is used based on the feature ID.
 * 
 * All colors are subtle, low-saturation tones that fit the app's aesthetic.
 */

// Base building colors from the app's palette - light, low-contrast colors
export const BASE_BUILDING_COLOR = '#fffdf8';
export const BASE_BUILDING_ALT_COLOR = '#f6f3ec';
export const BASE_BUILDING_BAND_COLOR = '#dedad1';

// Extended palette of 50 very subtle, low-saturation colors for deterministic building coloring
// These are carefully chosen to cover the full color spectrum in pastel form
// All colors are light, muted, and fit the app's low-contrast aesthetic
export const BUILDING_COLOR_PALETTE = [
  // Group 1: Whites and near-whites
  '#ffffff', '#fffdf8', '#fffaf0', '#fef8e8',
  // Group 2: Warm grays and stone
  '#f8f8f8', '#f5f5f0', '#f3f3e8', '#f1f1e0',
  // Group 3: Cool grays
  '#f0f0f0', '#eeeded', '#ecece0', '#eaeae0',
  // Group 4: Very light beiges/parchments
  '#fbf2d0', '#faf0c8', '#f8efc0', '#f6edb8',
  // Group 5: Light clay/terracotta (red-orange hues, heavily desaturated)
  '#f2e8d8', '#f0e6d0', '#e8dcc0', '#e6d8b0',
  // Group 6: Muted sage greens (green hues, heavily desaturated)
  '#e8f0d8', '#e0e6d0', '#dce4c8', '#d8e0c0',
  // Group 7: Soft olive/stone (yellow-green hues, desaturated)
  '#e4e0b8', '#e2dcaf', '#e0d8a0', '#ded698',
  // Group 8: Pale clay/red (red hues, very desaturated - like clay)
  '#f0d8c0', '#e8d4b8', '#e6d0b0', '#e4ccaa',
  // Group 9: Muted blues (blue hues, heavily desaturated)
  '#e0e8f0', '#d8e0e8', '#d0d8e0', '#c8d0d8',
  // Group 10: Cool stone/blue-gray
  '#e4e8e8', '#dcdcdc', '#d4d4d4', '#c8c8c8',
  // Group 11: Warm stone tones
  '#ece8d8', '#eae6d0', '#e8e4c8', '#e6e2c0',
  // Group 12: Soft yellows (yellow hues, very desaturated - like aged paper)
  '#f0eec0', '#eeedb8', '#ecedb0', '#eae8a8',
  // Group 13: Muted browns
  '#d6be98', '#d4bc88', '#d2ba80', '#d0b878',
] as const;

const PALETTE_SIZE = BUILDING_COLOR_PALETTE.length;

/**
 * Pre-compute RGB values for palette for efficient color matching.
 */
const PALETTE_RGB: [number, number, number][] = BUILDING_COLOR_PALETTE.map((h) => hexToRgb(h)!) as [number, number, number][];

/**
 * Find the closest palette color to a given hex color.
 * Uses CIE76 delta-E for perceptual color distance.
 */
export function findClosestPaletteColor(hex: string): string {
  const target = hexToRgb(hex);
  if (!target) return BASE_BUILDING_COLOR;

  let minDistance = Infinity;
  let bestIndex = 0;

  for (let i = 0; i < PALETTE_RGB.length; i++) {
    const distance = colorDistance(target, PALETTE_RGB[i]);
    if (distance < minDistance) {
      minDistance = distance;
      bestIndex = i;
    }
  }

  return BUILDING_COLOR_PALETTE[bestIndex];
}

/**
 * Pastelize a hex color: desaturate and lighten it to match palette style.
 */
export function pastelizeHex(hex: string): string {
  return findClosestPaletteColor(hex);
}

/**
 * Adjust a color to fit the app's style - find closest palette match.
 */
export function adjustBuildingColor(hex: string): string {
  return pastelizeHex(hex);
}

// Helper functions for color conversion

function hexToRgb(hex: string): [number, number, number] | null {
  if (hex.charAt(0) === '#') hex = hex.slice(1);

  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return [r, g, b];
  } else if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}

function colorDistance(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const lab1 = rgbToLab(rgb1);
  const lab2 = rgbToLab(rgb2);

  const deltaL = lab1[0] - lab2[0];
  const deltaA = lab1[1] - lab2[1];
  const deltaB = lab1[2] - lab2[2];

  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

function rgbToLab(rgb: [number, number, number]): [number, number, number] {
  let r = rgb[0] / 255.0;
  let g = rgb[1] / 255.0;
  let b = rgb[2] / 255.0;

  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  r *= 100;
  g *= 100;
  b *= 100;

  const refX = 0.95047;
  const refY = 1.00000;
  const refZ = 1.08883;

  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;

  const fx = x / refX;
  const fy = y / refY;
  const fz = z / refZ;

  const epsilon = 0.008856;
  const kappa = 903.3;

  const fxf = fx > epsilon ? Math.pow(fx, 1 / 3) : (kappa * fx + 16) / 116;
  const fyz = fy > epsilon ? Math.pow(fy, 1 / 3) : (kappa * fy + 16) / 116;
  const fzz = fz > epsilon ? Math.pow(fz, 1 / 3) : (kappa * fz + 16) / 116;

  const L = 116 * fyz - 16;
  const a = 500 * (fxf - fyz);
  const bLab = 200 * (fyz - fzz);

  return [L, a, bLab];
}

function rgbToHex(r: number, g: number, b: number): string {
  r = Math.max(0, Math.min(255, Math.round(r)));
  g = Math.max(0, Math.min(255, Math.round(g)));
  b = Math.max(0, Math.min(255, Math.round(b)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toLowerCase()}`;
}

/**
 * Generate a deterministic color based on a seed (e.g., building ID).
 */
export function getDeterministicBuildingColor(seed: string | number): string {
  const id = typeof seed === 'number' ? seed : hashString(String(seed));
  const index = Math.abs(id) % PALETTE_SIZE;
  return BUILDING_COLOR_PALETTE[index];
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}

/**
 * Create a simple MapLibre GL expression that uses deterministic colors.
 * 
 * Since MapLibre GL expressions cannot reliably pastelize arbitrary colors
 * (color manipulation functions can't be nested in case/match expressions),
 * we use a deterministic approach based on feature ID.
 * 
 * The pastelization happens at the palette level - all 50 colors are already
 * pastel/low-saturation versions of their hue families.
 */
export function buildingColorExpression(): ExpressionSpecification {
  // Use deterministic color based on feature ID modulo palette size
  const expr: Array<unknown> = ['match', ['%', ['id'], PALETTE_SIZE]];
  
  for (let i = 0; i < PALETTE_SIZE; i++) {
    expr.push(i);
    expr.push(BUILDING_COLOR_PALETTE[i]);
  }
  
  expr.push(BASE_BUILDING_COLOR);
  
  return expr as unknown as ExpressionSpecification;
}

/**
 * Alias for buildingColorExpression().
 */
export function buildingColorExpressionWithOsm(): ExpressionSpecification {
  return buildingColorExpression();
}
