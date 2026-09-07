import type { ExpressionSpecification, FillLayerSpecification } from 'maplibre-gl';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';

export const GRASS_PATTERN_ID = 'street-grass-pattern';
export const PAVING_PATTERN_ID = 'street-paving-pattern';
export const SAND_PATTERN_ID = 'street-sand-pattern';

export const STREET_SURFACE_PATTERN_LAYER_IDS = [
  'global-grass-pattern',
  'global-sand-pattern',
  'global-parking-pattern',
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

function wrap(value: number, size: number) {
  return ((value % size) + size) % size;
}

function seamValue(x: number, y: number, size: number, frequencyX: number, frequencyY: number, phase = 0) {
  const tau = Math.PI * 2;
  return Math.sin((x / size) * tau * frequencyX + phase)
    * Math.cos((y / size) * tau * frequencyY - phase * 0.5);
}

/** Soft, low-frequency green patches. Integer frequencies keep the tile seamless. */
export function createGrassPattern(size = 256): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const field: Rgb = [196, 222, 160];
  const patch: Rgb = [176, 210, 138];
  const shade: Rgb = [214, 232, 178];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = seamValue(x, y, size, 2, 1, 0.4) * 0.55;
      const crossing = seamValue(x, y, size, 1, 2, 1.1) * 0.35;
      const hash = ((x * 374_761_393 + y * 668_265_263) >>> 0) % 17;
      const stipple = hash < 2 ? 0.18 : hash > 14 ? -0.1 : 0;
      const amount = Math.max(0, Math.min(1, 0.5 + broad + crossing + stipple));
      const color = amount > 0.5
        ? mixRgb(field, patch, (amount - 0.5) * 2)
        : mixRgb(field, shade, (0.5 - amount) * 2);
      writePixel(data, size, x, y, color);
    }
  }

  return { width: size, height: size, data };
}

/** Grid of paving slabs for pedestrian surfaces and parking. */
export function createPavingPattern(size = 256): PatternImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const slab: Rgb = [238, 234, 222];
  const joint: Rgb = [188, 182, 168];
  const slabStep = 32;
  const jointWidth = 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const onVertical = wrap(x, slabStep) < jointWidth;
      const onHorizontal = wrap(y, slabStep) < jointWidth;
      writePixel(data, size, x, y, onVertical || onHorizontal ? joint : slab);
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
        'fill-opacity': closeRangePatternOpacity(0.28),
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
        'fill-opacity': closeRangePatternOpacity(0.2),
      },
    },
    {
      id: 'global-parking-pattern',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'landuse',
      minzoom: 14,
      filter: ['==', ['get', 'class'], 'parking'],
      paint: {
        'fill-pattern': PAVING_PATTERN_ID,
        'fill-opacity': closeRangePatternOpacity(0.26),
      },
    },
  ];
}
