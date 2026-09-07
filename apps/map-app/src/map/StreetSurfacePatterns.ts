import type { ExpressionSpecification, FillLayerSpecification } from 'maplibre-gl';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';

export const GRASS_PATTERN_ID = 'street-grass-pattern';
export const SAND_PATTERN_ID = 'street-sand-pattern';
export const WOOD_PATTERN_ID = 'street-wood-pattern';
export const PITCH_PATTERN_ID = 'street-pitch-pattern';

export const STREET_SURFACE_PATTERN_LAYER_IDS = [
  'global-grass-pattern',
  'global-wood-pattern',
  'global-sand-pattern',
  'global-pitch-pattern',
] as const;

type PatternImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type Rgb = [number, number, number];

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.min(1, Math.max(0, amount));
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function writePixel(data: Uint8ClampedArray, size: number, x: number, y: number, color: Rgb, alpha = 255) {
  const offset = (y * size + x) * 4;
  data[offset] = Math.round(color[0]);
  data[offset + 1] = Math.round(color[1]);
  data[offset + 2] = Math.round(color[2]);
  data[offset + 3] = alpha;
}

function seamValue(x: number, y: number, size: number, frequencyX: number, frequencyY: number, phase = 0) {
  const tau = Math.PI * 2;
  return Math.sin((x / size) * tau * frequencyX + phase)
    * Math.cos((y / size) * tau * frequencyY - phase * 0.5);
}

/** Soft, low-frequency green patches. Integer frequencies keep the tile seamless. */
export function createGrassPattern(size = 256): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const field: Rgb = [168, 204, 122];
  const patch: Rgb = [132, 176, 92];
  const shade: Rgb = [210, 228, 158];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = seamValue(x, y, size, 2, 1, 0.4) * 0.72;
      const crossing = seamValue(x, y, size, 1, 2, 1.1) * 0.48;
      const amount = Math.max(0, Math.min(1, 0.5 + broad + crossing));
      const color = amount > 0.5
        ? mixRgb(field, patch, (amount - 0.5) * 2)
        : mixRgb(field, shade, (0.5 - amount) * 2);
      writePixel(data, size, x, y, color);
    }
  }

  return { width: size, height: size, data };
}

/** Broader, darker canopy patches so woods read apart from lawn. */
export function createWoodPattern(size = 256): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const canopy: Rgb = [148, 176, 108];
  const grove: Rgb = [118, 150, 86];
  const glade: Rgb = [176, 196, 128];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = seamValue(x, y, size, 1, 1, 0.2) * 0.7;
      const crossing = seamValue(x, y, size, 2, 1, 0.8) * 0.4;
      const amount = Math.max(0, Math.min(1, 0.5 + broad + crossing));
      const color = amount > 0.5
        ? mixRgb(canopy, grove, (amount - 0.5) * 2)
        : mixRgb(canopy, glade, (0.5 - amount) * 2);
      writePixel(data, size, x, y, color);
    }
  }

  return { width: size, height: size, data };
}

/** Wide cartoon stripes for sports pitches. */
export function createPitchPattern(size = 256): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const light: Rgb = [164, 204, 118];
  const dark: Rgb = [140, 184, 100];
  const stripe = Math.max(16, Math.round(size / 8));

  for (let y = 0; y < size; y += 1) {
    const band = Math.floor(y / stripe) % 2 === 0 ? light : dark;
    for (let x = 0; x < size; x += 1) {
      writePixel(data, size, x, y, band);
    }
  }

  return { width: size, height: size, data };
}

/** Restrained beige patches for sand and bare ground. */
export function createSandPattern(size = 256): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const sand: Rgb = [242, 223, 167];
  const dune: Rgb = [232, 205, 142];
  const pale: Rgb = [246, 234, 190];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = seamValue(x, y, size, 1, 2, 0.2) * 0.48;
      const crossing = seamValue(x, y, size, 2, 1, 0.9) * 0.28;
      const amount = Math.max(0, Math.min(1, 0.5 + broad + crossing));
      const color = amount > 0.5
        ? mixRgb(sand, dune, (amount - 0.5) * 2)
        : mixRgb(sand, pale, (0.5 - amount) * 2);
      writePixel(data, size, x, y, color);
    }
  }

  return { width: size, height: size, data };
}

function closeRangePatternOpacity(peak: number): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    13, 0,
    14.5, 0.04,
    16, peak * 0.7,
    18, peak,
  ];
}

export function streetSurfacePatternLayers(): FillLayerSpecification[] {
  return [
    {
      id: 'global-grass-pattern',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: 13,
      filter: [
        'any',
        ['==', ['get', 'class'], 'grass'],
        ['in', ['get', 'subclass'], ['literal', [
          'park', 'garden', 'flowerbed', 'village_green', 'recreation_ground',
          'meadow', 'grassland',
        ]]],
      ],
      paint: {
        'fill-pattern': GRASS_PATTERN_ID,
        'fill-opacity': closeRangePatternOpacity(0.38),
      },
    },
    {
      id: 'global-wood-pattern',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: 13,
      filter: ['==', ['get', 'class'], 'wood'],
      paint: {
        'fill-pattern': WOOD_PATTERN_ID,
        'fill-opacity': closeRangePatternOpacity(0.32),
      },
    },
    {
      id: 'global-sand-pattern',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: 13,
      filter: ['==', ['get', 'class'], 'sand'],
      paint: {
        'fill-pattern': SAND_PATTERN_ID,
        'fill-opacity': closeRangePatternOpacity(0.22),
      },
    },
    {
      id: 'global-pitch-pattern',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'landuse',
      minzoom: 14,
      filter: ['==', ['get', 'class'], 'pitch'],
      paint: {
        'fill-pattern': PITCH_PATTERN_ID,
        'fill-opacity': closeRangePatternOpacity(0.34),
      },
    },
  ];
}
