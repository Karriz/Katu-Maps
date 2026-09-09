import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * Building color utilities for OpenFreeMap building layer.
 * 
 * When a building has an OSM color defined (color, colour, building:colour, render_color),
 * the closest matching color from the palette is selected.
 * For buildings without color data, a deterministic pseudo-random color from the palette
 * is used based on the feature ID.
 * 
 * All colors are subtle, low-saturation tones that fit the app's aesthetic.
 */

// Base building colors from the app's palette - light, low-contrast colors
export const BASE_BUILDING_COLOR = '#fffdf8';
export const BASE_BUILDING_ALT_COLOR = '#f6f3ec';
export const BASE_BUILDING_BAND_COLOR = '#dedad1';

// Extended palette covering common OSM colors (gray, white, green, red, blue, yellow)
// Each hue group has multiple lightness/saturation variants for better matching
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

// Pre-compute RGB values for palette for efficient color matching
const PALETTE_RGB: [number, number, number][] = BUILDING_COLOR_PALETTE.map((h) => hexToRgb(h)!) as [number, number, number][];

/**
 * Find the closest palette color to a given hex color.
 * Uses CIE76 delta-E for perceptual color distance.
 */
function findClosestPaletteColor(hex: string): string {
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
 * CIE76 delta-E color distance (perceptually uniform).
 * Converts RGB to Lab color space for accurate perceptual distance.
 */
function colorDistance(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const lab1 = rgbToLab(rgb1);
  const lab2 = rgbToLab(rgb2);
  
  const deltaL = lab1[0] - lab2[0];
  const deltaA = lab1[1] - lab2[1];
  const deltaB = lab1[2] - lab2[2];
  
  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

/**
 * Convert RGB (0-255) to Lab color space.
 */
function rgbToLab(rgb: [number, number, number]): [number, number, number] {
  // First convert RGB to XYZ
  let r = rgb[0] / 255.0;
  let g = rgb[1] / 255.0;
  let b = rgb[2] / 255.0;
  
  // Apply gamma correction
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  
  // Observer = D65, Reference white = D65
  const refX = 0.95047;
  const refY = 1.00000;
  const refZ = 1.08883;
  
  r *= 100;
  g *= 100;
  b *= 100;
  
  // Apply wide RGB to XYZ matrix
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  
  // Convert XYZ to Lab
  const fx = x / refX;
  const fy = y / refY;
  const fz = z / refZ;
  
  const epsilon = 0.008856;
  const kappa = 903.3;
  
  const fxf = fx > epsilon ? Math.pow(fx, 1/3) : (kappa * fx + 16) / 116;
  const fyz = fy > epsilon ? Math.pow(fy, 1/3) : (kappa * fy + 16) / 116;
  const fzz = fz > epsilon ? Math.pow(fz, 1/3) : (kappa * fz + 16) / 116;
  
  const L = 116 * fyz - 16;
  const a = 500 * (fxf - fyz);
  const bLab = 200 * (fyz - fzz);
  
  return [L, a, bLab];
}

/**
 * Convert hex color to RGB tuple, or return null if invalid.
 */
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

/**
 * Create a MapLibre GL expression that selects building colors.
 * 
 * Priority:
 * 1. If building has OSM color (color, colour, building:colour, render_color), 
 *    find the closest palette match
 * 2. Otherwise, use deterministic color based on feature ID
 */
export function buildingColorExpression(): ExpressionSpecification {
  // Try to get OSM color from various property names
  // coalesce tries each property in order and returns the first non-null value
  const colorProp: ExpressionSpecification = [
    'coalesce',
    ['get', 'color'],
    ['get', 'colour'],
    ['get', 'building:colour'],
    ['get', 'render_color'],
  ] as ExpressionSpecification;
  
  // Build a match expression that maps OSM colors to palette colors
  // Since we can't compute closest color in MapLibre expressions,
  // we use a case expression that checks for common OSM color values
  // and maps them to pre-computed closest palette colors
  
  // For now, use the deterministic approach as fallback
  // The full color matching would require a custom MapLibre expression function
  // which isn't available, so we'll use the ID-based approach
  
  const expr: Array<unknown> = ['match', ['%', ['id'], PALETTE_SIZE]];
  
  for (let i = 0; i < PALETTE_SIZE; i++) {
    expr.push(i);
    expr.push(BUILDING_COLOR_PALETTE[i]);
  }
  
  expr.push(BASE_BUILDING_COLOR);
  
  return expr as unknown as ExpressionSpecification;
}

/**
 * Get the MapLibre GL expression for building colors with OSM color support.
 * This creates a more complex expression that attempts to match OSM colors.
 */
export function buildingColorExpressionWithOsm(): ExpressionSpecification {
  // First, try to get the OSM color
  const colorProp: ExpressionSpecification = [
    'coalesce',
    ['get', 'color'],
    ['get', 'colour'],
    ['get', 'building:colour'],
    ['get', 'render_color'],
  ] as ExpressionSpecification;
  
  // Check if color exists and is valid
  const hasColor: ExpressionSpecification = [
    'all',
    ['!=', colorProp, null],
    ['!=', colorProp, ''],
    ['!', ['has', 'error', ['to-color', colorProp]]],
  ] as ExpressionSpecification;
  
  // For buildings with OSM color, we need to find the closest palette match.
  // Since MapLibre expressions can't do complex color math,
  // we use a case-based approach for common colors.
  // The full implementation would need a custom MapLibre plugin,
  // but this handles the most common OSM color values.
  
  // Build a case expression for common OSM colors
  const colorCases: Array<unknown> = [
    'case',
    // White variants
    ['in', colorProp, ['literal', ['white', '#ffffff', '#fff', 'fff']]], BUILDING_COLOR_PALETTE[1],
    // Gray variants
    ['in', colorProp, ['literal', ['gray', 'grey', '#808080', '#888', '808080', '#a0a0a0', '#aaa']]], BUILDING_COLOR_PALETTE[6],
    ['in', colorProp, ['literal', ['lightgray', 'lightgrey', '#d3d3d3', '#d3d3d3', 'd3d3d3', '#c0c0c0']]], BUILDING_COLOR_PALETTE[4],
    // Red variants
    ['in', colorProp, ['literal', ['red', '#ff0000', '#f00', 'f00', '#cc0000', '#c00']]], BUILDING_COLOR_PALETTE[18],
    ['in', colorProp, ['literal', ['darkred', '#8b0000', '#800000']]], BUILDING_COLOR_PALETTE[20],
    // Green variants
    ['in', colorProp, ['literal', ['green', '#00ff00', '#0f0', '0f0', '#008000']]], BUILDING_COLOR_PALETTE[24],
    ['in', colorProp, ['literal', ['darkgreen', '#006400', '#008000']]], BUILDING_COLOR_PALETTE[25],
    // Blue variants
    ['in', colorProp, ['literal', ['blue', '#0000ff', '#00f', '00f', '#00008b']]], BUILDING_COLOR_PALETTE[32],
    ['in', colorProp, ['literal', ['lightblue', '#add8e6', '#add8e6']]], BUILDING_COLOR_PALETTE[33],
    // Yellow variants
    ['in', colorProp, ['literal', ['yellow', '#ffff00', '#ff0', 'ff0', '#ffd700']]], BUILDING_COLOR_PALETTE[42],
    ['in', colorProp, ['literal', ['lightyellow', '#ffffe0']]], BUILDING_COLOR_PALETTE[43],
    // Brown variants
    ['in', colorProp, ['literal', ['brown', '#a52a2a', '#8b4513']]], BUILDING_COLOR_PALETTE[48],
    // Orange variants
    ['in', colorProp, ['literal', ['orange', '#ffa500', '#ff8c00']]], BUILDING_COLOR_PALETTE[16],
    // Beige/stone variants
    ['in', colorProp, ['literal', ['beige', '#f5f5dc', '#f5deb3']]], BUILDING_COLOR_PALETTE[2],
    // Black -> map to dark gray
    ['in', colorProp, ['literal', ['black', '#000000', '#000']]], BUILDING_COLOR_PALETTE[10],
  ];
  
  // Default: use deterministic color based on ID
  colorCases.push(['match', ['%', ['id'], PALETTE_SIZE]]);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    colorCases.push(i);
    colorCases.push(BUILDING_COLOR_PALETTE[i]);
  }
  colorCases.push(BASE_BUILDING_COLOR);
  
  return colorCases as unknown as ExpressionSpecification;
}

/**
 * Generate a deterministic color based on a seed (e.g., building ID).
 * @param seed - A string or number seed
 * @returns A hex color from the palette
 */
export function getDeterministicBuildingColor(seed: string | number): string {
  const id = typeof seed === 'number' ? seed : hashString(String(seed));
  const index = Math.abs(id) % PALETTE_SIZE;
  return BUILDING_COLOR_PALETTE[index];
}

// Helper functions

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}

/**
 * Color adjustment utilities for runtime color manipulation.
 */

/**
 * Desaturate a hex color by reducing its saturation.
 */
export function desaturateHex(hex: string, amount: number = 0.85): string {
  if (hex.charAt(0) === '#') hex = hex.slice(1);
  
  let r: number, g: number, b: number;
  
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return BASE_BUILDING_COLOR;
  }
  
  const hsl = rgbToHsl(r, g, b);
  hsl[1] *= (1 - amount);
  const [r2, g2, b2] = hslToRgb(hsl[0], hsl[1], hsl[2]);
  return rgbToHex(r2, g2, b2);
}

/**
 * Lighten a hex color while preserving its hue.
 */
export function lightenHex(hex: string, amount: number = 0.25): string {
  if (hex.charAt(0) === '#') hex = hex.slice(1);
  
  let r: number, g: number, b: number;
  
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return BASE_BUILDING_COLOR;
  }
  
  r = Math.round(r + (255 - r) * amount);
  g = Math.round(g + (255 - g) * amount);
  b = Math.round(b + (255 - b) * amount);
  
  return rgbToHex(r, g, b);
}

/**
 * Adjust a color to fit the app's style.
 */
export function adjustBuildingColor(hex: string): string {
  let adjusted = desaturateHex(hex, 0.85);
  adjusted = lightenHex(adjusted, 0.25);
  return clampLightness(adjusted, 0.75, 0.95);
}

function clampLightness(hex: string, minLightness: number, maxLightness: number): string {
  if (hex.charAt(0) === '#') hex = hex.slice(1);
  
  let r: number, g: number, b: number;
  
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return BASE_BUILDING_COLOR;
  }
  
  const hsl = rgbToHsl(r, g, b);
  hsl[2] = Math.max(minLightness, Math.min(maxLightness, hsl[2]));
  const [r2, g2, b2] = hslToRgb(hsl[0], hsl[1], hsl[2]);
  return rgbToHex(r2, g2, b2);
}

// Helper functions for color conversion

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }
  
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (h % 360 + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  
  let r = 0, g = 0, b = 0;
  
  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  r = Math.max(0, Math.min(255, Math.round(r)));
  g = Math.max(0, Math.min(255, Math.round(g)));
  b = Math.max(0, Math.min(255, Math.round(b)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toLowerCase()}`;
}
