import type { ExpressionSpecification, FillLayerSpecification } from 'maplibre-gl';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';

export const GRASS_PATTERN_ID = 'street-grass-pattern';
export const SAND_PATTERN_ID = 'street-sand-pattern';
export const WOOD_PATTERN_ID = 'street-wood-pattern';
export const PITCH_PATTERN_ID = 'street-pitch-pattern';
export const FARMLAND_PATTERN_ID = 'street-farmland-pattern';
export const WETLAND_PATTERN_ID = 'street-wetland-pattern';
export const CEMETERY_PATTERN_ID = 'street-cemetery-pattern';
export const ALLOTMENT_PATTERN_ID = 'street-allotment-pattern';

export const STREET_SURFACE_PATTERN_LAYER_IDS = [
  'global-grass-pattern',
  'global-wood-pattern',
  'global-sand-pattern',
  'global-farmland-pattern',
  'global-farmland-landuse-pattern',
  'global-wetland-pattern',
  'global-cemetery-pattern',
  'global-allotment-pattern',
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

function wrapDelta(delta: number, size: number) {
  const half = size / 2;
  if (delta > half) return delta - size;
  if (delta < -half) return delta + size;
  return delta;
}

function wrapDistance(x: number, y: number, cx: number, cy: number, size: number) {
  return Math.hypot(wrapDelta(x - cx, size), wrapDelta(y - cy, size));
}

function fillPattern(size: number, color: Rgb): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) writePixel(data, size, x, y, color);
  }
  return data;
}

function stampBlob(
  data: Uint8ClampedArray,
  size: number,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
  strength = 1,
) {
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const x = ((Math.round(cx) + dx) % size + size) % size;
      const y = ((Math.round(cy) + dy) % size + size) % size;
      const dist = wrapDistance(x + 0.5, y + 0.5, cx, cy, size);
      if (dist >= radius) continue;
      const amount = (1 - dist / radius) ** 1.35 * strength;
      const offset = (y * size + x) * 4;
      const mixed = mixRgb(
        [data[offset], data[offset + 1], data[offset + 2]],
        color,
        amount,
      );
      writePixel(data, size, x, y, mixed);
    }
  }
}

/** Cartoon lawn tufts: distinct rounded patches instead of a soft gradient. */
export function createGrassPattern(size = 128): PatternImage {
  const field: Rgb = [176, 212, 126];
  const tuft: Rgb = [118, 168, 78];
  const highlight: Rgb = [214, 232, 154];
  const data = fillPattern(size, field);
  const scale = size / 128;
  const tufts: Array<[number, number, number, Rgb, number]> = [
    [22, 26, 16, tuft, 0.92],
    [68, 18, 13, tuft, 0.84],
    [108, 44, 15, tuft, 0.9],
    [38, 70, 12, tuft, 0.8],
    [86, 82, 17, tuft, 0.95],
    [14, 104, 11, tuft, 0.78],
    [58, 116, 14, tuft, 0.88],
    [116, 96, 10, tuft, 0.74],
    [96, 18, 9, tuft, 0.7],
  ];

  for (const [x, y, radius, color, strength] of tufts) {
    stampBlob(data, size, x * scale, y * scale, radius * scale, color, strength);
    stampBlob(
      data,
      size,
      (x - radius * 0.28) * scale,
      (y - radius * 0.32) * scale,
      radius * 0.38 * scale,
      highlight,
      0.55,
    );
  }

  return { width: size, height: size, data };
}

/** Darker canopy blobs so woods read apart from lawn. */
export function createWoodPattern(size = 128): PatternImage {
  const canopy: Rgb = [142, 174, 102];
  const grove: Rgb = [102, 140, 74];
  const glade: Rgb = [176, 198, 124];
  const data = fillPattern(size, canopy);
  const scale = size / 128;
  const groves: Array<[number, number, number]> = [
    [28, 30, 22], [78, 24, 18], [112, 58, 20], [40, 88, 24], [90, 102, 21],
  ];
  const glades: Array<[number, number, number]> = [
    [60, 54, 12], [16, 70, 10], [100, 16, 11],
  ];

  for (const [x, y, radius] of groves) {
    stampBlob(data, size, x * scale, y * scale, radius * scale, grove, 0.9);
  }
  for (const [x, y, radius] of glades) {
    stampBlob(data, size, x * scale, y * scale, radius * scale, glade, 0.7);
  }

  return { width: size, height: size, data };
}

/** Wide cartoon stripes for sports pitches. */
export function createPitchPattern(size = 128): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const light: Rgb = [164, 204, 118];
  const dark: Rgb = [132, 176, 90];
  const stripe = Math.max(8, Math.round(size / 8));

  for (let y = 0; y < size; y += 1) {
    const band = Math.floor(y / stripe) % 2 === 0 ? light : dark;
    for (let x = 0; x < size; x += 1) writePixel(data, size, x, y, band);
  }

  return { width: size, height: size, data };
}

/** Dune patches for sand and beaches. */
export function createSandPattern(size = 128): PatternImage {
  const sand: Rgb = [244, 224, 164];
  const dune: Rgb = [224, 192, 122];
  const pale: Rgb = [250, 238, 196];
  const data = fillPattern(size, sand);
  const scale = size / 128;

  for (const [x, y, radius, color, strength] of [
    [30, 36, 20, dune, 0.82],
    [86, 22, 16, pale, 0.7],
    [108, 78, 22, dune, 0.88],
    [48, 96, 18, pale, 0.64],
    [18, 8, 12, dune, 0.7],
  ] as Array<[number, number, number, Rgb, number]>) {
    stampBlob(data, size, x * scale, y * scale, radius * scale, color, strength);
  }

  return { width: size, height: size, data };
}

/** Diagonal furrows for farmland. */
export function createFarmlandPattern(size = 128): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const light: Rgb = [236, 226, 152];
  const dark: Rgb = [214, 196, 114];
  const stripe = Math.max(8, Math.round(size / 8));
  const period = stripe * 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const band = Math.floor(((x + y) % period) / stripe);
      writePixel(data, size, x, y, band === 0 ? light : dark);
    }
  }

  return { width: size, height: size, data };
}

/** Short reed marks for marshes and wetlands. */
export function createWetlandPattern(size = 128): PatternImage {
  const marsh: Rgb = [176, 206, 148];
  const reed: Rgb = [108, 148, 96];
  const data = fillPattern(size, marsh);
  const cell = Math.max(10, Math.round(size / 8));
  const dash = Math.max(3, Math.round(size / 22));

  for (let row = 0; row < size / cell; row += 1) {
    for (let col = 0; col < size / cell; col += 1) {
      const ox = Math.round(col * cell + (row % 2 === 0 ? cell * 0.28 : cell * 0.62));
      const oy = Math.round(row * cell + cell * 0.35);
      for (let i = 0; i < dash; i += 1) {
        const x = ((ox) % size + size) % size;
        const y = ((oy + i) % size + size) % size;
        writePixel(data, size, x, y, reed);
        writePixel(data, size, (x + 1) % size, y, reed);
      }
    }
  }

  return { width: size, height: size, data };
}

/** Quiet headstone dots for cemeteries. */
export function createCemeteryPattern(size = 128): PatternImage {
  const lawn: Rgb = [186, 210, 166];
  const marker: Rgb = [156, 176, 148];
  const data = fillPattern(size, lawn);
  const cell = Math.max(12, Math.round(size / 8));
  const markerW = Math.max(2, Math.round(size / 42));
  const markerH = Math.max(3, Math.round(size / 28));

  for (let row = 0; row < size / cell; row += 1) {
    for (let col = 0; col < size / cell; col += 1) {
      const ox = Math.round(col * cell + cell * 0.4);
      const oy = Math.round(row * cell + cell * 0.38);
      for (let dy = 0; dy < markerH; dy += 1) {
        for (let dx = 0; dx < markerW; dx += 1) {
          writePixel(
            data,
            size,
            ((ox + dx) % size + size) % size,
            ((oy + dy) % size + size) % size,
            marker,
          );
        }
      }
    }
  }

  return { width: size, height: size, data };
}

/** Garden-bed grid for allotments. */
export function createAllotmentPattern(size = 128): PatternImage {
  const bed: Rgb = [186, 214, 132];
  const soil: Rgb = [168, 186, 112];
  const data = fillPattern(size, bed);
  const plot = Math.max(16, Math.round(size / 4));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inSoil = x % plot < 2 || y % plot < 2 || (x % plot > plot * 0.45 && x % plot < plot * 0.55);
      if (inSoil) writePixel(data, size, x, y, soil);
    }
  }

  return { width: size, height: size, data };
}

function closeRangePatternOpacity(peak: number): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    13, 0,
    14.5, 0.08,
    16, peak * 0.72,
    18, peak,
  ];
}

function patternFill(
  id: string,
  sourceLayer: 'landcover' | 'landuse',
  filter: ExpressionSpecification,
  pattern: string,
  peak: number,
  minzoom = 13,
): FillLayerSpecification {
  return {
    id,
    type: 'fill',
    source: OPENFREEMAP_SOURCE_ID,
    'source-layer': sourceLayer,
    minzoom,
    filter,
    paint: {
      'fill-pattern': pattern,
      'fill-opacity': closeRangePatternOpacity(peak),
    },
  };
}

export function streetSurfacePatternLayers(): FillLayerSpecification[] {
  return [
    patternFill(
      'global-grass-pattern',
      'landcover',
      [
        'any',
        ['==', ['get', 'class'], 'grass'],
        ['in', ['get', 'subclass'], ['literal', [
          'park', 'garden', 'flowerbed', 'village_green', 'recreation_ground',
          'meadow', 'grassland',
        ]]],
      ],
      GRASS_PATTERN_ID,
      0.52,
    ),
    patternFill(
      'global-wood-pattern',
      'landcover',
      ['==', ['get', 'class'], 'wood'],
      WOOD_PATTERN_ID,
      0.42,
    ),
    patternFill(
      'global-sand-pattern',
      'landcover',
      ['==', ['get', 'class'], 'sand'],
      SAND_PATTERN_ID,
      0.34,
    ),
    patternFill(
      'global-farmland-pattern',
      'landcover',
      ['==', ['get', 'class'], 'farmland'],
      FARMLAND_PATTERN_ID,
      0.4,
    ),
    patternFill(
      'global-farmland-landuse-pattern',
      'landuse',
      ['==', ['get', 'class'], 'farmland'],
      FARMLAND_PATTERN_ID,
      0.4,
    ),
    patternFill(
      'global-wetland-pattern',
      'landcover',
      ['==', ['get', 'class'], 'wetland'],
      WETLAND_PATTERN_ID,
      0.38,
    ),
    patternFill(
      'global-cemetery-pattern',
      'landuse',
      ['==', ['get', 'class'], 'cemetery'],
      CEMETERY_PATTERN_ID,
      0.32,
      14,
    ),
    patternFill(
      'global-allotment-pattern',
      'landuse',
      ['==', ['get', 'class'], 'allotments'],
      ALLOTMENT_PATTERN_ID,
      0.36,
      14,
    ),
    patternFill(
      'global-pitch-pattern',
      'landuse',
      ['==', ['get', 'class'], 'pitch'],
      PITCH_PATTERN_ID,
      0.42,
      14,
    ),
  ];
}
