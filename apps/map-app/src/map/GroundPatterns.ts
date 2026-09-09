import type { ExpressionSpecification, FillLayerSpecification, FilterSpecification } from 'maplibre-gl';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';

export const EMPTY_PATTERN_ID = 'empty-map-pattern';
export type PatternImage = { width: number; height: number; data: Uint8ClampedArray };
export type GroundCoverageCache = Map<GroundPatternKind, Float64Array>;

export type GroundPatternKind = 'grass' | 'park' | 'forest' | 'scrub' | 'meadow' | 'wetland' | 'sand' | 'rock' | 'farmland';

export const GROUND_PATTERN_LAYER_IDS = [
  'global-ground-pattern-grass',
  'global-ground-pattern-park',
  'global-ground-pattern-forest',
  'global-ground-pattern-scrub',
  'global-ground-pattern-meadow',
  'global-ground-pattern-wetland',
  'global-ground-pattern-sand',
  'global-ground-pattern-rock',
  'global-ground-pattern-farmland',
] as const;

const PATTERN_KINDS: GroundPatternKind[] = ['grass', 'park', 'forest', 'scrub', 'meadow', 'wetland', 'sand', 'rock', 'farmland'];

export function groundPatternImageId(kind: GroundPatternKind, theme: 'light' | 'dark') {
  return `ground-pattern-${kind}-${theme}`;
}

export function patternImageExpression(id: string): ExpressionSpecification {
  return ['coalesce', ['image', id], ['image', EMPTY_PATTERN_ID]];
}

function hash(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
  return value - Math.floor(value);
}

function* generateCoverage(size: number, kind: GroundPatternKind): Generator<void, Float64Array> {
  const mask = new Float64Array(size * size);
  const cells = kind === 'park' ? 4 : kind === 'farmland' ? 8 : kind === 'forest' || kind === 'scrub' ? 12 : kind === 'rock' ? 18 : 14;
  const cellSize = size / cells;

  const hashCells = kind === 'sand' || kind === 'rock' ? cells * 3 : cells;
  const hashes = new Map<number, Float64Array>();
  const cellHash = (x: number, y: number, seed: number) => {
    let table = hashes.get(seed);
    if (!table) {
      table = new Float64Array(hashCells * hashCells);
      for (let cy = 0; cy < hashCells; cy += 1) {
        for (let cx = 0; cx < hashCells; cx += 1) table[cy * hashCells + cx] = hash(cx, cy, seed);
      }
      hashes.set(seed, table);
    }
    return table[y * hashCells + x];
  };

  for (let y = 0; y < size; y += 1) {
    yield;
    for (let x = 0; x < size; x += 1) {
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      const localX = (x % cellSize) / cellSize;
      const localY = (y % cellSize) / cellSize;
      let coverage = 0;
      if (kind === 'farmland') {
        const stripe = (localX + localY * 0.45 + cellHash(cellX, cellY, 4) * 0.28) % 1;
        coverage = stripe > 0.44 && stripe < 0.56 ? 0.65 : 0;
      } else if (kind === 'wetland') {
        const ripple = (localY + cellHash(cellX, cellY, 4) * 0.25) % 0.5;
        coverage = ripple > 0.18 && ripple < 0.3 ? 0.58 : 0;
      } else if (kind === 'sand' || kind === 'rock') {
        coverage = cellHash(cellX * 3 + Math.floor(localX * 3), cellY * 3 + Math.floor(localY * 3), kind === 'sand' ? 9 : 10) > 0.72 ? 0.38 : 0;
      } else if (kind === 'forest' || kind === 'scrub') {
        const dx = localX - (0.25 + cellHash(cellX, cellY, 5) * 0.5);
        const dy = localY - (0.25 + cellHash(cellX, cellY, 6) * 0.5);
        const radius = kind === 'forest' ? 0.28 : 0.24;
        coverage = dx * dx + dy * dy < radius * radius ? (kind === 'forest' ? 0.8 : 0.45) : 0;
      } else {
        // Use broad, irregular dappled patches rather than hard diagonal facets.
        // Two overlapping patches break up the texture repeat across large areas.
        const radius = kind === 'park' ? 0.46 : 0.3;
        const firstX = 0.16 + cellHash(cellX, cellY, 7) * 0.68;
        const firstY = 0.16 + cellHash(cellX, cellY, 8) * 0.68;
        const secondX = 0.16 + cellHash(cellX, cellY, 11) * 0.68;
        const secondY = 0.16 + cellHash(cellX, cellY, 12) * 0.68;
        const firstDistance = ((localX - firstX) ** 2) + ((localY - firstY) ** 2);
        const secondDistance = ((localX - secondX) ** 2) + ((localY - secondY) ** 2);
        coverage = Math.min(1, (firstDistance < radius * radius ? 0.18 : 0) + (secondDistance < radius * radius ? 0.16 : 0));
      }
      mask[y * size + x] = coverage;
    }
  }
  return mask;
}

export function* generateGroundPattern(
  size: number, kind: GroundPatternKind, theme: 'light' | 'dark', coverageCache: GroundCoverageCache,
): Generator<void, PatternImage> {
  let coverage = coverageCache.get(kind);
  if (!coverage || coverage.length !== size * size) {
    coverage = yield* generateCoverage(size, kind);
    coverageCache.set(kind, coverage);
  }
  const data = new Uint8ClampedArray(size * size * 4);
  const palette: Record<GroundPatternKind, [string, number]> = theme === 'dark'
    ? {
      grass: ['#17384a', 42], park: ['#28505a', 48], forest: ['#234d56', 58], scrub: ['#28534f', 48], meadow: ['#274b4b', 38], wetland: ['#2c5960', 54], sand: ['#665e43', 30], rock: ['#45525a', 34], farmland: ['#244858', 46],
    }
    : {
      grass: ['#90b278', 40], park: ['#a5c98a', 42], forest: ['#7fae7c', 48], scrub: ['#93b77f', 38], meadow: ['#96b97d', 46], wetland: ['#8eb59b', 52], sand: ['#d8c68e', 30], rock: ['#aaa99d', 28], farmland: ['#b9c184', 62],
    };
  const [color, alpha]: [string, number] = palette[kind];
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  for (let y = 0; y < size; y += 1) {
    yield;
    for (let x = 0; x < size; x += 1) {
      const pixel = y * size + x;
      const offset = pixel * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = Math.round(alpha * coverage[pixel]);
    }
  }
  return { width: size, height: size, data };
}

export function createGroundPattern(size: number, kind: GroundPatternKind, theme: 'light' | 'dark') {
  const job = generateGroundPattern(size, kind, theme, new Map());
  let result = job.next();
  while (!result.done) result = job.next();
  return result.value;
}

export function groundPatternKinds() {
  return PATTERN_KINDS;
}

export function groundPatternLayers(): FillLayerSpecification[] {
  const layers = [
    {
      id: GROUND_PATTERN_LAYER_IDS[0], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[1], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['in', ['get', 'subclass'], ['literal', ['park', 'garden', 'flowerbed', 'village_green']]] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[2], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[3], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['in', ['get', 'subclass'], ['literal', ['scrub', 'shrubbery', 'heath']]] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[4], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['in', ['get', 'subclass'], ['literal', ['meadow', 'grassland']]] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[5], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['==', ['get', 'subclass'], 'wetland'] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[6], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['==', ['get', 'subclass'], 'sand'] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[7], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['==', ['get', 'subclass'], 'rock'] as FilterSpecification, minzoom: 9,
    },
    {
      id: GROUND_PATTERN_LAYER_IDS[8], type: 'fill', source: OPENFREEMAP_SOURCE_ID, 'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['farmland', 'orchard', 'vineyard']]] as FilterSpecification, minzoom: 9,
    },
  ];
  return layers.map((layer, index) => ({
    ...layer,
    paint: {
      'fill-pattern': patternImageExpression(groundPatternImageId(PATTERN_KINDS[index], 'light')),
      'fill-antialias': false,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 11, 0.16, 14, 0.3, 18, 0.4],
    },
  })) as unknown as FillLayerSpecification[];
}

export function applyGroundPatternTheme(map: { getLayer: (id: string) => unknown; setPaintProperty: (id: string, property: any, value: any) => unknown }, theme: 'light' | 'dark') {
  GROUND_PATTERN_LAYER_IDS.forEach((layerId, index) => {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'fill-pattern', patternImageExpression(groundPatternImageId(PATTERN_KINDS[index], theme)));
  });
}
