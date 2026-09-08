import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * Building color utilities for OpenFreeMap building layer.
 * 
 * Provides deterministic pseudo-random colors for buildings from a controlled palette.
 * All colors are subtle, low-saturation tones that fit the app's aesthetic.
 */

// Base building colors from the app's palette - light, low-contrast colors
export const BASE_BUILDING_COLOR = '#fffdf8';
export const BASE_BUILDING_ALT_COLOR = '#f6f3ec';
export const BASE_BUILDING_BAND_COLOR = '#dedad1';

// Extended palette of 50 very subtle, low-saturation colors for deterministic building coloring
// These are carefully chosen to avoid bright greens, reds, yellows, and provide good variety
// All colors are light, muted, and fit the app's low-contrast aesthetic
export const BUILDING_COLOR_PALETTE = [
  // Group 1: Very light neutrals (almost white, warm)
  '#fffaf0', '#fef8e8', '#fdf6e0', '#fcf4d8',
  // Group 2: Warm beiges and parchments
  '#fbf2d0', '#faf0c8', '#f8efc0', '#f6edb8',
  // Group 3: Soft cool grays
  '#f5f5f0', '#f3f3e8', '#f1f1e0', '#efefe8',
  // Group 4: Warm grays
  '#eeeded', '#ecece0', '#eaeae0', '#e8e8d8',
  // Group 5: Very subtle warm tones (clay, stone)
  '#e6e6d0', '#e4e4c8', '#e2e2c0', '#e0e0b8',
  // Group 6: Soft stone and pale clay
  '#e8e4d8', '#e6e2d0', '#e4e0c8', '#e2dcc0',
  // Group 7: Very muted sage (heavily desaturated green)
  '#e0e6d0', '#dce4c8', '#dac2b8', '#d8c0a8',
  // Group 8: Muted olive/stone blend
  '#d6be98', '#d4bc88', '#d2ba80', '#d0b878',
  // Group 9: Warm stone tones
  '#ece8d8', '#eae6d0', '#e8e4c8', '#e6e2c0',
  // Group 10: Cool stone tones
  '#e4e0b8', '#e2dcaf', '#e0d8a0', '#ded698',
  // Group 11: Very light rose/stone (almost neutral)
  '#f0e8e0', '#eee6d8', '#ece4d0', '#eae2c8',
  // Group 12: Muted terracotta
  '#e8dcc0', '#e6daaf', '#e4d8a0', '#e2d690',
  // Group 13: Soft warm neutrals
  '#f2f0c8', '#f0eec0', '#eeedb8', '#ecdba8',
] as const;

const PALETTE_SIZE = BUILDING_COLOR_PALETTE.length;

/**
 * Create a MapLibre GL expression that selects a color from the palette
 * based on feature ID modulo palette size.
 * 
 * Uses a simple match expression: ['match', ['%', ['id'], PALETTE_SIZE], ...]
 * This is the standard MapLibre way to do modulo-based color selection.
 */
export function buildingColorExpression(): ExpressionSpecification {
  // match expression: ['match', input, case1, result1, case2, result2, ..., default]
  const expr: Array<unknown> = ['match', ['%', ['id'], PALETTE_SIZE]];
  
  // Add color for each index: [index, color, index, color, ...]
  for (let i = 0; i < PALETTE_SIZE; i++) {
    expr.push(i);
    expr.push(BUILDING_COLOR_PALETTE[i]);
  }
  
  // Default fallback
  expr.push(BASE_BUILDING_COLOR);
  
  return expr as unknown as ExpressionSpecification;
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
