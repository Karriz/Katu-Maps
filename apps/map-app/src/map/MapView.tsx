import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type FillLayerSpecification,
  type FillExtrusionLayerSpecification,
  type HillshadeLayerSpecification,
  type LineLayerSpecification,
  type Map,
  type MapSourceDataEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import { BuildingRoofLayer } from './BuildingRoofLayer';
import { BridgeModelLayer } from './BridgeModelLayer';
import { InfrastructureModelLayer } from './InfrastructureModelLayer';
import { TreeModelLayer } from './TreeModelLayer';
import {
  CARTOON_MAP_LIGHT_POSITION,
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_COLOR,
} from './CartoonLighting';
import {
  GLOBAL_BUILDING_LAYER_IDS,
  GLOBAL_BUILDING_ROOF_LAYER_IDS,
  GLOBAL_MAP_STYLE,
  GLOBAL_ROAD_CASING_LAYER_IDS,
  GLOBAL_ROAD_LAYER_IDS,
  MAPTERHORN_DETAIL_SOURCE_ID,
  OPENFREEMAP_SOURCE_ID,
  roadWidthExpression,
} from './GlobalMapStyle';
import {
  DETAIL_TERRAIN_MAX_ZOOM,
  detailedTerrainSource,
  detailedTerrainZoom,
  GLOBAL_TERRAIN_MAX_ZOOM,
} from './TerrainCoverage';

const TAMPERE: [number, number] = [23.7609, 61.4981];
const TILEJSON_URL = 'http://localhost:3000/tampere';
const TERRAIN_TILEJSON_URL = 'http://localhost:3000/terrain';
const DETAIL_HILLSHADE_LAYER_ID = 'terrain-hillshade-detail';
const USE_LOCAL_MAP_DATA = import.meta.env.VITE_MAP_DATA_PROVIDER === 'local';
// Keep the metre-scaled transport polygons active at close zooms, but defer
// expensive building detail until it is large enough to be readable.
const BUILDING_DETAIL_MIN_ZOOM = 17;
const MAX_BUILDING_STORY_SLICES = 25;
const GROUND_COLOR = '#f0f1ed';
const WATER_COLOR = '#a9c8d3';
const WATER_EDGE_COLOR = '#8eafb9';
const WATER_PATTERN_ID = 'water-surface-pattern';
const WATER_EFFECT_LAYER_IDS = [
  'water-pattern',
  'water-detail-pattern',
  'river-area-pattern',
  'global-water-pattern',
];
const INFRASTRUCTURE_SHADOW_LAYER_IDS = [
  'power-point-shadows',
  'landmark-area-shadows',
  'landmark-point-shadows',
];
const BUILDING_SHADOW_LAYER_IDS = [
  'building-shadow-soft',
  'building-shadows',
  'global-building-shadow',
  'global-building-contact-shadow',
];
const BRIDGE_DECK_EFFECT_LAYER_IDS = [
  'bridge-road-edge-shade',
  'bridge-path-edge-shade',
  'bridge-railway-edge-shade',
  'global-pier-area-shadow',
  'global-pier-line-shadow',
  'global-bridge-deck-shadow',
  'global-path-bridge-shadow',
  'global-road-bridge-shadow',
  'global-railway-bridge-shadow',
];

type LayerToggleState = {
  globe: boolean;
  bridges: boolean;
  roofs: boolean;
  trees: boolean;
  buildings: boolean;
  terrain: boolean;
  waterEffect: boolean;
  shadows: boolean;
};

const BUILDING_LAYER_IDS = [
  ...Array.from({ length: MAX_BUILDING_STORY_SLICES }, (_, index) => `building-story-${index + 1}`),
  'building-roof-caps',
  ...GLOBAL_BUILDING_LAYER_IDS,
];

function createWaterPattern(size: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  const shadow = [116, 157, 168];
  const highlight = [174, 207, 211];
  const tau = Math.PI * 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const horizontal = (x / size) * tau;
      const vertical = (y / size) * tau;
      // Integer-frequency waves meet at every edge, making the generated
      // image seamless when MapLibre repeats it across water polygons.
      const broad = Math.sin(horizontal + vertical * 2) * 0.29;
      const crossing = Math.cos(horizontal * 2 - vertical) * 0.14;
      const detail = Math.sin(horizontal * 3 + vertical) * Math.cos(horizontal - vertical * 2) * 0.07;
      const shade = Math.max(0, Math.min(1, 0.5 + broad + crossing + detail));
      const offset = (y * size + x) * 4;

      data[offset] = Math.round(shadow[0] + (highlight[0] - shadow[0]) * shade);
      data[offset + 1] = Math.round(shadow[1] + (highlight[1] - shadow[1]) * shade);
      data[offset + 2] = Math.round(shadow[2] + (highlight[2] - shadow[2]) * shade);
      data[offset + 3] = 255;
    }
  }

  return { width: size, height: size, data };
}

const BUILDING_COLOR_NAMES: Record<string, string> = {
  black: '#202522', white: '#f1f2ed', gray: '#808080', grey: '#808080',
  lightgray: '#d3d3d3', lightgrey: '#d3d3d3', silver: '#c0c0c0',
  red: '#b94a48', green: '#4f8a5b', blue: '#3366aa', brown: '#8b5a3c',
  beige: '#d8c9a7', orange: '#e58a3a', pink: '#e69aaa', maroon: '#7f3038',
  yellow: '#e5c34b',
};

function pastelBuildingColor(value: unknown, blend = 0.28) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/^#/, '');
  const hex = BUILDING_COLOR_NAMES[normalized]?.slice(1) ?? (
    normalized.length === 3
      ? normalized.split('').map((part) => `${part}${part}`).join('')
      : normalized
  );
  if (!/^[0-9a-f]{6}$/.test(hex)) return undefined;
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hueSaturationScale = (hue >= 0.2 && hue <= 0.45)
    ? 0.62 // greens read especially strongly against ivory buildings
    : (hue <= 0.08 || hue >= 0.92)
      ? 0.68 // reds
      : (hue > 0.08 && hue < 0.18)
        ? 0.72 // orange and brown
        : 1;
  const nextSaturation = Math.min(saturation * hueSaturationScale, 0.22);
  const nextLightness = saturation <= 0.18 && lightness >= 0.46 && lightness <= 0.88
    ? lightness
    : Math.min(0.84, Math.max(0.46, lightness * (1 - blend) + 0.62 * blend));
  const chroma = (1 - Math.abs(2 * nextLightness - 1)) * nextSaturation;
  const second = nextLightness - chroma / 2;
  const huePart = (hue * 6) % 2;
  const x = chroma * (1 - Math.abs(huePart - 1));
  const [r, g, b] = hue < 1 / 6 ? [chroma, x, 0]
    : hue < 2 / 6 ? [x, chroma, 0]
      : hue < 3 / 6 ? [0, chroma, x]
        : hue < 4 / 6 ? [0, x, chroma]
          : hue < 5 / 6 ? [x, 0, chroma]
            : [chroma, 0, x];
  const channel = (part: number) => Math.round((part + second) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function waterPatternLayers(): FillLayerSpecification[] {
  const layerDefinitions = [
    ['water-pattern', 'water'],
    ['water-detail-pattern', 'water_detail'],
    ['river-area-pattern', 'river_areas'],
  ] as const;

  return layerDefinitions.map(([id, sourceLayer]) => ({
    id,
    type: 'fill',
    source: 'tampere',
    'source-layer': sourceLayer,
    layout: { visibility: 'none' },
    paint: {
      'fill-pattern': WATER_PATTERN_ID,
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.05,
        10, 0.08,
        12, 0.1,
        14, 0.12,
        15.5, 0.14,
        18, 0.17,
      ],
    },
  }));
}

function globalWaterPatternLayer(): FillLayerSpecification {
  return {
    id: 'global-water-pattern',
    type: 'fill',
    source: OPENFREEMAP_SOURCE_ID,
    'source-layer': 'water',
    paint: {
      'fill-pattern': WATER_PATTERN_ID,
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.05,
        10, 0.08,
        14, 0.12,
        18, 0.17,
      ],
    },
  };
}

function seededBuildingPalette(colors: string[]): ExpressionSpecification {
  return [
    'match',
    ['%', ['id'], colors.length],
    ...colors.flatMap((color, index) => [index, color]),
    colors[0],
  ] as ExpressionSpecification;
}

const DEFAULT_BUILDING_PALETTE = seededBuildingPalette([
  '#f1eee7', '#e8eef1', '#eee8f1', '#e8f0e7',
]);
const DEFAULT_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#dfe5df', '#dce4e8', '#e4dce6', '#e4e1d8',
]);
const RESIDENTIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#eadbd4', '#e1e7ed', '#eee5cb', '#dce9e2',
]);
const RESIDENTIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#dfd1cb', '#d5dfe8', '#e2d7bb', '#cbded5',
]);
const APARTMENT_BUILDING_PALETTE = seededBuildingPalette([
  '#e6ebf2', '#eee7e2', '#e2edf0', '#f0e8d8',
]);
const APARTMENT_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#d5dde7', '#dfd6d1', '#d1e0e3', '#e1d8c8',
]);
const COMMERCIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#e1edf2', '#e7e9e5', '#e7efe5', '#e3e8f1',
]);
const COMMERCIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#d1e0e6', '#d8dbd6', '#d7e2d4', '#d4dbe6',
]);
const INDUSTRIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#e4e9e6', '#e0e7e3', '#ecebdd', '#dfe7eb',
]);
const INDUSTRIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#d3dbd7', '#d0dad5', '#dddccd', '#d0dbe0',
]);
const CIVIC_BUILDING_PALETTE = seededBuildingPalette([
  '#f1e7d3', '#e8e7ed', '#f0e4d6', '#dcece8',
]);
const CIVIC_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#e1d5c1', '#d8d7df', '#e1d3c6', '#cce0db',
]);

const DEFAULT_ROOF_PALETTE = seededBuildingPalette([
  '#c2c6c6', '#b5bcc0', '#cccbc7', '#aeb7ba',
]);

const BUILDING_PALETTE: ExpressionSpecification = [
  'match',
  ['get', 'building'],
  'apartments', APARTMENT_BUILDING_PALETTE,
  'residential', RESIDENTIAL_BUILDING_PALETTE,
  'house', RESIDENTIAL_BUILDING_PALETTE,
  'detached', RESIDENTIAL_BUILDING_PALETTE,
  'terrace', RESIDENTIAL_BUILDING_PALETTE,
  'commercial', COMMERCIAL_BUILDING_PALETTE,
  'office', COMMERCIAL_BUILDING_PALETTE,
  'retail', COMMERCIAL_BUILDING_PALETTE,
  'industrial', INDUSTRIAL_BUILDING_PALETTE,
  'warehouse', INDUSTRIAL_BUILDING_PALETTE,
  'school', CIVIC_BUILDING_PALETTE,
  'public', CIVIC_BUILDING_PALETTE,
  'civic', CIVIC_BUILDING_PALETTE,
  'church', CIVIC_BUILDING_PALETTE,
  DEFAULT_BUILDING_PALETTE,
];

const BUILDING_PALETTE_ALT: ExpressionSpecification = [
  'match',
  ['get', 'building'],
  'apartments', APARTMENT_BUILDING_PALETTE_ALT,
  'residential', RESIDENTIAL_BUILDING_PALETTE_ALT,
  'house', RESIDENTIAL_BUILDING_PALETTE_ALT,
  'detached', RESIDENTIAL_BUILDING_PALETTE_ALT,
  'terrace', RESIDENTIAL_BUILDING_PALETTE_ALT,
  'commercial', COMMERCIAL_BUILDING_PALETTE_ALT,
  'office', COMMERCIAL_BUILDING_PALETTE_ALT,
  'retail', COMMERCIAL_BUILDING_PALETTE_ALT,
  'industrial', INDUSTRIAL_BUILDING_PALETTE_ALT,
  'warehouse', INDUSTRIAL_BUILDING_PALETTE_ALT,
  'school', CIVIC_BUILDING_PALETTE_ALT,
  'public', CIVIC_BUILDING_PALETTE_ALT,
  'civic', CIVIC_BUILDING_PALETTE_ALT,
  'church', CIVIC_BUILDING_PALETTE_ALT,
  DEFAULT_BUILDING_PALETTE_ALT,
];

const BUILDING_COLOR: ExpressionSpecification = [
  'coalesce',
  ['get', 'building_color'],
  BUILDING_PALETTE,
];

const BUILDING_COLOR_ALT: ExpressionSpecification = [
  'coalesce',
  ['get', 'building_color_alt'],
  BUILDING_PALETTE_ALT,
];

const ROOF_COLOR: ExpressionSpecification = [
  'coalesce',
  ['get', 'roof_color'],
  DEFAULT_ROOF_PALETTE,
];

const HAS_PITCHED_ROOF: ExpressionSpecification = [
  'all',
  ['has', 'roof_height'],
  ['has', 'roof_shape'],
  ['>', ['get', 'roof_height'], 0],
  ['match', ['get', 'roof_shape'], 'flat', false, 'none', false, true],
];

const BUILDING_BODY_HEIGHT: ExpressionSpecification = [
  'case',
  HAS_PITCHED_ROOF,
  ['-', ['get', 'height'], ['get', 'roof_height']],
  ['get', 'height'],
];

const BUILDING_STORY_HEIGHT: ExpressionSpecification = [
  '/',
  ['-', BUILDING_BODY_HEIGHT, ['get', 'base']],
  ['max', 1, ['get', 'levels']],
];

const ROAD_CLASS_WIDTH_METERS: ExpressionSpecification = [
  'match', ['get', 'class'],
  'motorway', 12,
  'trunk', 10,
  'primary', 8,
  'secondary', 7,
  'tertiary', 6,
  'residential', 5.5,
  'service', 4,
  5,
];

const ROAD_WIDTH_METERS: ExpressionSpecification = [
  'min', 30,
  [
    'case',
    ['has', 'width'], ['get', 'width'],
    ['has', 'lanes'], ['max', ROAD_CLASS_WIDTH_METERS, ['*', ['get', 'lanes'], 3.25]],
    ROAD_CLASS_WIDTH_METERS,
  ],
];

const ROAD_WIDTH: ExpressionSpecification = [
  // Pixels per metre at Tampere's latitude for MapLibre's 512px world scale.
  'interpolate', ['exponential', 2], ['zoom'],
  10, ['max', 0.5, ['*', ROAD_WIDTH_METERS, 0.027416]],
  12, ['max', 0.6, ['*', ROAD_WIDTH_METERS, 0.109664]],
  14, ['*', ROAD_WIDTH_METERS, 0.438658],
  16, ['*', ROAD_WIDTH_METERS, 1.754634],
  // Slightly damp the final close-zoom interval. Full physical pixel scaling
  // looks too heavy in pitched line-rendering mode.
  18, ['*', ROAD_WIDTH_METERS, 5.5],
  20, ['*', ROAD_WIDTH_METERS, 28.074158],
];

const ROAD_CASING_METERS: ExpressionSpecification = ['+', ROAD_WIDTH_METERS, 1.7];
const ROAD_CASING_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  10, ['max', 0.8, ['*', ROAD_CASING_METERS, 0.027416]],
  12, ['max', 1, ['*', ROAD_CASING_METERS, 0.109664]],
  14, ['*', ROAD_CASING_METERS, 0.438658],
  16, ['*', ROAD_CASING_METERS, 1.754634],
  18, ['*', ROAD_CASING_METERS, 5.5],
  20, ['*', ROAD_CASING_METERS, 28.074158],
];

const PATH_WIDTH_METERS: ExpressionSpecification = [
  'min', 12,
  [
    'case',
    ['has', 'width'], ['get', 'width'],
    [
      'match', ['get', 'class'],
      'track', 3.5,
      'cycleway', 3,
      'pedestrian', 4,
      'footway', 2,
      'path', 1.5,
      2,
    ],
  ],
];

const PATH_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  12, ['max', 0.25, ['*', PATH_WIDTH_METERS, 0.109664]],
  14, ['*', PATH_WIDTH_METERS, 0.438658],
  16, ['*', PATH_WIDTH_METERS, 1.754634],
  18, ['*', PATH_WIDTH_METERS, 5.5],
  20, ['*', PATH_WIDTH_METERS, 28.074158],
];

// Minor paths are useful close up but add a lot of visual noise at the first
// zoom level where the paths layer is available.
const PATH_DETAIL_OPACITY: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  12, 0,
  13, 0.74,
];
const PATH_DETAIL_CASING_OPACITY: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  12, 0,
  13, 0.52,
];
const PATH_EARTHWORK_OPACITY: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  12, 0,
  13, 0.24,
];

const PATH_CASING_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  12, ['+', ['max', 0.25, ['*', PATH_WIDTH_METERS, 0.109664]], 1.6],
  14, ['+', ['*', PATH_WIDTH_METERS, 0.438658], 1.6],
  16, ['+', ['*', PATH_WIDTH_METERS, 1.754634], 1.6],
  18, ['+', ['*', PATH_WIDTH_METERS, 5.5], 1.6],
  20, ['+', ['*', PATH_WIDTH_METERS, 28.074158], 1.6],
];

const RAILWAY_WIDTH_METERS: ExpressionSpecification = [
  'case', ['has', 'width'], ['get', 'width'], 3.2,
];

const RAILWAY_BED_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  10, ['min', 34, ['max', 0.5, ['*', RAILWAY_WIDTH_METERS, 0.027416]]],
  12, ['min', 34, ['max', 0.6, ['*', RAILWAY_WIDTH_METERS, 0.109664]]],
  14, ['min', 34, ['*', RAILWAY_WIDTH_METERS, 0.438658]],
  16, ['min', 34, ['*', RAILWAY_WIDTH_METERS, 1.754634]],
  18, ['min', 34, ['*', RAILWAY_WIDTH_METERS, 7.01854]],
  20, ['min', 34, ['*', RAILWAY_WIDTH_METERS, 28.074158]],
];

const RAILWAY_SLEEPER_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  12, 0.7,
  14, ['min', 40, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 0.438658]],
  16, ['min', 40, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 1.754634]],
  18, ['min', 40, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 7.01854]],
  20, ['min', 40, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 28.074158]],
];

const AEROWAY_RUNWAY_WIDTH_METERS: ExpressionSpecification = [
  'min', 90,
  ['max', 18, ['case', ['has', 'width'], ['get', 'width'], 45]],
];
const AEROWAY_TAXIWAY_WIDTH_METERS: ExpressionSpecification = [
  'min', 30,
  ['max', 6, ['case', ['has', 'width'], ['get', 'width'], 15]],
];

const SURFACE_ROAD_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'surface'],
  'gravel', '#c9c1b1',
  'unpaved', '#d0c5b0',
  'dirt', '#c8b494',
  'ground', '#c8b494',
  'sand', '#ddcc9f',
  'cobblestone', '#a4a5a1',
  'paving_stones', '#aaaba6',
  'concrete', '#bcbdb8',
  '#b2b3ae',
];

const SURFACE_PATH_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'class'], 'cycleway'], '#b9867e',
  [
    'match',
    ['get', 'surface'],
    'asphalt', '#a8aeaa',
    'gravel', '#c5b38f',
    'dirt', '#b79d77',
    'ground', '#b79d77',
    'sand', '#d5bd84',
    '#b9ac90',
  ],
];

function buildingStoryLayers(): FillExtrusionLayerSpecification[] {
  return Array.from({ length: MAX_BUILDING_STORY_SLICES }, (_, storyIndex) => {
    const isTopSlice = storyIndex === MAX_BUILDING_STORY_SLICES - 1;
    const storyBase: ExpressionSpecification = storyIndex === 0
      ? ['get', 'base']
      : [
          '+',
          ['get', 'base'],
          ['*', BUILDING_STORY_HEIGHT, storyIndex],
        ];
    const nextStoryBoundary: ExpressionSpecification = [
      '+',
      ['get', 'base'],
      ['*', BUILDING_STORY_HEIGHT, storyIndex + 1],
    ];
    const storyTop: ExpressionSpecification = isTopSlice
      ? BUILDING_BODY_HEIGHT
      : ['min', BUILDING_BODY_HEIGHT, nextStoryBoundary];
    const storyColor: ExpressionSpecification = storyIndex === 0
      ? [
          'step',
          ['zoom'],
          BUILDING_COLOR,
          BUILDING_DETAIL_MIN_ZOOM,
          BUILDING_COLOR_ALT,
        ]
      : BUILDING_COLOR;

    return {
      id: `building-story-${storyIndex + 1}`,
      type: 'fill-extrusion',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: 12,
      filter: ['>', ['get', 'levels'], storyIndex],
      paint: {
        // Keep the sliced geometry stable, but reserve the subtle alternate
        // material for the street-level storey instead of striping every floor.
        'fill-extrusion-color': storyColor,
        'fill-extrusion-height': storyTop,
        'fill-extrusion-base': storyBase,
        'fill-extrusion-opacity': 0.96,
      },
    };
  });
}

function railwayRailLayers(): LineLayerSpecification[] {
  return ([-1, 1] as const).map((side) => ({
    id: `railway-rail-${side < 0 ? 'left' : 'right'}`,
    type: 'line',
    source: 'tampere',
    'source-layer': 'railways',
    minzoom: 12,
    filter: [
      'all',
      ['!', ['has', 'tunnel']],
      ['!', ['has', 'covered']],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#8d9898',
      'line-width': [
        'interpolate', ['exponential', 2], ['zoom'],
        12, 0.6,
        16, 0.65,
        18, 0.8,
        20, 1.4,
      ],
      'line-offset': [
        'interpolate', ['exponential', 2], ['zoom'],
        12, side * 0.15,
        14, side * 0.334,
        16, side * 1.337,
        18, side * 5.348,
        20, side * 12,
      ],
      'line-opacity': 0.66,
    },
  }));
}

const TAMPERE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Tampere local OSM',
  light: {
    anchor: 'map',
    position: CARTOON_MAP_LIGHT_POSITION,
    color: CARTOON_SUN_COLOR,
    intensity: 0.44,
  },
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    tampere: {
      type: 'vector',
      url: TILEJSON_URL,
      attribution: '© OpenStreetMap contributors',
    },
    terrain: {
      type: 'raster-dem',
      // Use the explicit template so Martin's raster TileJSON defaults cannot
      // override the DEM tile dimensions.
      tiles: [`${TERRAIN_TILEJSON_URL}/{z}/{x}/{y}`],
      // rio-rgbify's 512px PNGs are retina-style tiles for a 256px map tile.
      tileSize: 256,
      bounds: [23.55, 61.40, 24.05, 61.60],
      minzoom: 8,
      maxzoom: 14,
      encoding: 'mapbox',
      attribution: 'National Land Survey of Finland, Elevation model 10 m',
    },
    'tunnel-entrances': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
  },
  layers: [
    // This is also the fallback behind places without a landuse polygon, so
    // keep it as a neutral ground color. A blue background would appear as
    // accidental water/sky patches inside the map at high pitch.
    { id: 'background', type: 'background', paint: { 'background-color': GROUND_COLOR } },
    {
      id: 'landuse',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'landuse',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'forest', '#b8caaa',
          'wood', '#c2d1b4',
          'scrub', '#d0d9b8',
          'shrubbery', '#c9d7bc',
          'heath', '#e9e5b6',
          'wetland', [
            'match',
            ['get', 'wetland'],
            'marsh', '#c7dda8',
            'swamp', '#a8c797',
            'bog', '#c3d5b1',
            'fen', '#c9dbb3',
            '#c6d9ad',
          ],
          'bare_rock', '#e5e3dd',
          'cliff', '#d9d7d0',
          'scree', '#ddd8cc',
          'shingle', '#e5d8bc',
          'mud', '#d5c9aa',
          'sand', '#f4dfa7',
          'beach', '#f7e6b6',
          'farmland', '#edf0bb',
          'farmyard', '#eee7d6',
          'orchard', '#dfedc4',
          'vineyard', '#e2ebc0',
          'plant_nursery', '#c9dda9',
          'greenhouse_horticulture', '#dbe4c5',
          'park', '#c6d6aa',
          'recreation_ground', '#c8d9ae',
          'meadow', '#d1dfb9',
          'grass', '#cbdcb0',
          'grassland', '#c9d9aa',
          'garden', '#cbdcb4',
          'dog_park', '#9fd275',
          'village_green', '#9dd273',
          'allotments', '#c9dc9f',
          'cemetery', '#c2d9b5',
          'churchyard', '#c7d9ba',
          'religious', '#d8dfca',
          'nature_reserve', '#9fc98d',
          'pitch', '#add38e',
          'marketplace', '#ddd3c5',
          'square', '#ddd6ca',
          'playground', '#d6df9d',
          'sports_centre', '#d7e9c1',
          'stadium', '#d2e7b9',
          'track', '#dceac0',
          'golf_course', '#d0e8bd',
          'fitness_station', '#c0dba8',
          'ice_rink', '#d3e8e8',
          'swimming_pool', '#b8d8df',
          'swimming_area', '#c1dfe4',
          'marina', '#cbdfe2',
          'residential', '#cbd4c6',
          'commercial', '#c7d0ce',
          'retail', '#d8d1bc',
          'industrial', '#b8c7c7',
          'railway', '#e1e1dc',
          'construction', '#ded8c8',
          'quarry', '#d9d6cf',
          'greenfield', '#d8e5c1',
          'landfill', '#d6d2c9',
          'military', '#d3d3c9',
          'logging', '#d6cfad',
          'education', '#e4e8d7',
          'healthcare', '#d9ddd6',
          'civic', '#e5e1d8',
          'civil', '#e5e1d8',
          'civic_admin', '#e5e1d8',
          'garages', '#dedfdb',
          'storage', '#dce1e1',
          'brownfield', '#eee2d0',
          GROUND_COLOR,
        ],
        'fill-opacity': 0.82,
      },
    },
    {
      id: 'waterways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'waterways',
      paint: {
        'line-color': '#8fb7c1',
        'line-opacity': 0.72,
        'line-width': [
          'match',
          ['get', 'class'],
          'river', 2.4,
          'canal', 2,
          'stream', 1.3,
          'ditch', 0.9,
          'drain', 0.9,
          1,
        ],
      },
    },
    {
      id: 'water-edge-shade',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water',
      paint: {
        'fill-color': WATER_EDGE_COLOR,
        'fill-translate': ['interpolate', ['linear'], ['zoom'], 10, ['literal', [0.7, -0.7]], 18, ['literal', [2.5, -2.5]]],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.1,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water',
      paint: { 'fill-color': WATER_COLOR },
    },
    {
      id: 'water-detail-edge-shade',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water_detail',
      paint: {
        'fill-color': WATER_EDGE_COLOR,
        'fill-translate': ['interpolate', ['linear'], ['zoom'], 13, ['literal', [0.7, -0.7]], 18, ['literal', [2.5, -2.5]]],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.08,
      },
    },
    {
      id: 'water-detail',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water_detail',
      paint: { 'fill-color': WATER_COLOR },
    },
    {
      id: 'river-area-cover',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'river_areas',
      paint: {
        'fill-color': WATER_COLOR,
        'fill-opacity': 1,
        'fill-outline-color': WATER_EDGE_COLOR,
      },
    },
    {
      id: 'water-structure-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water_structures',
      minzoom: 12,
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'dock', '#b9dfef',
          'pier', '#d9d0bd',
          'quay', '#d2ccc1',
          'breakwater', '#c8c5bd',
          'groyne', '#c8c5bd',
          '#d2cec5',
        ],
        'fill-opacity': 0.88,
      },
    },
    {
      id: 'water-structures',
      type: 'line',
      source: 'tampere',
      'source-layer': 'water_structures',
      minzoom: 12,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'dam', '#96938a',
          'dock', '#94c3d7',
          'pier', '#aaa088',
          'quay', '#a59f94',
          'breakwater', '#9e9e97',
          'groyne', '#9e9e97',
          '#aaa69c',
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          ['match', ['get', 'class'], 'dam', 2.4, 'breakwater', 2, 'groyne', 1.8, 1.2],
          16,
          ['match', ['get', 'class'], 'dam', 8, 'breakwater', 6, 'groyne', 5, 4],
        ],
        'line-opacity': 0.78,
      },
    },
    {
      id: 'water-structure-edge-shade',
      type: 'line',
      source: 'tampere',
      'source-layer': 'water_structures',
      minzoom: 12,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#6f685e',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          12,
          ['match', ['get', 'class'], 'dam', 2.4, 'breakwater', 2, 'groyne', 1.8, 1.2],
          16,
          ['match', ['get', 'class'], 'dam', 8, 'breakwater', 6, 'groyne', 5, 4],
        ],
        'line-translate': ['interpolate', ['linear'], ['zoom'], 12, ['literal', [0.6, -0.6]], 18, ['literal', [2, -2]]],
        'line-translate-anchor': 'map',
        'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 18, 1.2],
        'line-opacity': 0.12,
      },
    },
    {
      id: 'bridge-area-deck-shades',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'bridges',
      minzoom: 10,
      paint: {
        'fill-color': '#59615d',
        'fill-translate': ['interpolate', ['linear'], ['zoom'], 10, ['literal', [0.8, -0.8]], 18, ['literal', [3, -3]]],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.16,
      },
    },
    {
      id: 'bridges',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'bridges',
      // OSM bridge footprints are part of the basemap and remain visible even
      // when the optional elevated 3D bridge models are disabled.
      paint: {
        'fill-color': '#d7d1c5',
        'fill-outline-color': '#c7c1b7',
        'fill-opacity': 0.98,
      },
    },
    {
      id: 'parking',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'parking',
      paint: {
        'fill-color': '#dad8d2',
        'fill-opacity': 0.86,
      },
    },
    {
      id: 'pedestrian-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'pedestrian_areas',
      paint: {
        'fill-color': '#ddd6ca',
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          14, 0.88,
          14.75, [
            'case',
            ['all', ['has', 'bridge'], ['!=', ['get', 'bridge'], 'no']],
            0.88,
            0,
          ],
        ],
      },
    },
    {
      id: 'aeroway-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'aeroway',
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'aerodrome', '#d2d8d0',
          'terminal', '#d7d1c5',
          'apron', '#d5d8d8',
          'helipad', '#d0d3d2',
          '#eaedef',
        ],
        'fill-opacity': 0.92,
      },
    },
    {
      id: 'aeroway-taxiways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'aeroway',
      filter: ['==', ['get', 'class'], 'taxiway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'surface'],
          'asphalt', '#aeb5b3',
          'concrete', '#c0c3c0',
          '#b8bebd',
        ],
        'line-width': [
          'interpolate', ['exponential', 2], ['zoom'],
          10, ['*', AEROWAY_TAXIWAY_WIDTH_METERS, 0.027416],
          14, ['*', AEROWAY_TAXIWAY_WIDTH_METERS, 0.438658],
          18, ['*', AEROWAY_TAXIWAY_WIDTH_METERS, 5.5],
        ],
        'line-opacity': 0.94,
      },
    },
    {
      id: 'aeroway-taxiway-markings',
      type: 'line',
      source: 'tampere',
      'source-layer': 'aeroway',
      minzoom: 14,
      filter: ['==', ['get', 'class'], 'taxiway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#d9b94c',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1.3],
        'line-opacity': 0.82,
      },
    },
    {
      id: 'aeroway-runways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'aeroway',
      filter: ['==', ['get', 'class'], 'runway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'surface'],
          'asphalt', '#969d9b',
          'concrete', '#aaa9a2',
          '#a6aaa5',
        ],
        'line-width': [
          'interpolate', ['exponential', 2], ['zoom'],
          10, ['*', AEROWAY_RUNWAY_WIDTH_METERS, 0.027416],
          14, ['*', AEROWAY_RUNWAY_WIDTH_METERS, 0.438658],
          18, ['*', AEROWAY_RUNWAY_WIDTH_METERS, 5.5],
        ],
        'line-opacity': 0.96,
      },
    },
    {
      id: 'aeroway-runway-markings',
      type: 'line',
      source: 'tampere',
      'source-layer': 'aeroway',
      minzoom: 12,
      filter: ['==', ['get', 'class'], 'runway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#f7f5ea',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 1.5, 18, 2.2],
        'line-dasharray': [4, 5],
        'line-opacity': 0.86,
      },
    },
    {
      id: 'power-lines',
      type: 'line',
      source: 'tampere',
      'source-layer': 'power',
      paint: { 'line-color': '#c8cac7', 'line-width': 1.2, 'line-opacity': 0.5 },
    },
    {
      id: 'power-points',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'power',
      paint: { 'circle-color': '#c8cac7', 'circle-radius': 1.5, 'circle-opacity': 0.5 },
    },
    {
      id: 'retaining-walls',
      type: 'line',
      source: 'tampere',
      'source-layer': 'barriers',
      filter: ['==', ['get', 'class'], 'retaining_wall'],
      paint: {
        'line-color': '#a19b91',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 14, 3.5, 17, 5],
        'line-opacity': 0.9,
      },
    },
    {
      id: 'barriers',
      type: 'line',
      source: 'tampere',
      'source-layer': 'barriers',
      filter: ['!=', ['get', 'class'], 'retaining_wall'],
      paint: { 'line-color': '#bbb7ad', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.72 },
    },
    {
      id: 'railway-earthworks',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      filter: [
        'all',
        ['any', ['has', 'embankment'], ['has', 'cutting']],
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      paint: {
        'line-color': ['case', ['has', 'cutting'], '#b2aaa0', '#c3b79f'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 9, 17, 14],
        'line-opacity': 0.26,
      },
    },
    {
      id: 'railway-bed',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#aab3b2',
        'line-width': RAILWAY_BED_WIDTH,
        'line-opacity': 0.58,
      },
    },
    {
      id: 'railway-sleepers',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      minzoom: 15.5,
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#d5dcda',
        'line-width': RAILWAY_SLEEPER_WIDTH,
        'line-dasharray': [0.18, 1.15],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          15.5, 0,
          17, 0.56,
          18, 0.48,
        ],
      },
    },
    ...railwayRailLayers(),
    {
      id: 'road-earthworks',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      filter: [
        'all',
        ['any', ['has', 'embankment'], ['has', 'cutting']],
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      paint: {
        'line-color': [
          'case',
          ['has', 'cutting'], '#b2aaa0',
          '#c3b79f',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 14, 10, 17, 16],
        'line-opacity': 0.38,
      },
    },
    {
      id: 'road-casing',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#74817c',
        'line-width': ROAD_CASING_WIDTH,
        'line-opacity': 0.86,
      },
    },
    {
      id: 'roads',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': SURFACE_ROAD_COLOR,
        'line-width': ROAD_WIDTH,
        'line-opacity': 0.96,
      },
    },
    {
      id: 'road-center-markings',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      minzoom: 14,
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
        [
          'match', ['get', 'class'],
          'motorway', true,
          'trunk', true,
          'primary', true,
          'secondary', true,
          'tertiary', true,
          false,
        ],
        [
          'match', ['get', 'surface'],
          'gravel', false,
          'unpaved', false,
          'dirt', false,
          'ground', false,
          'sand', false,
          true,
        ],
        ['match', ['get', 'lane_markings'], 'no', false, 'false', false, true],
        ['case', ['has', 'lanes'], ['>=', ['get', 'lanes'], 2], true],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 17, 1.2],
        'line-dasharray': [3, 4],
        'line-opacity': 0.66,
      },
    },
    {
      id: 'road-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'roads',
      minzoom: 13,
      filter: [
        'all',
        ['has', 'name'],
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 15, 13],
        'text-font': ['Open Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 20,
      },
      paint: {
        'text-color': '#596b68',
        'text-halo-color': '#f8f9f7',
        'text-halo-width': 1.7,
      },
    },
    {
      id: 'water-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'water',
      minzoom: 10,
      filter: ['has', 'name'],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15],
        'text-font': ['Open Sans Regular'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#8fc1d7',
        'text-halo-color': WATER_COLOR,
        'text-halo-width': 1.25,
      },
    },
    {
      id: 'waterway-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'waterways',
      minzoom: 14,
      filter: ['has', 'name'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 11],
        'text-font': ['Open Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 16,
      },
      paint: {
        'text-color': '#8fc1d7',
        'text-halo-color': WATER_COLOR,
        'text-halo-width': 1.25,
        'text-opacity': 0.82,
      },
    },
    {
      id: 'path-earthworks',
      type: 'line',
      source: 'tampere',
      'source-layer': 'paths',
      filter: [
        'all',
        ['any', ['has', 'embankment'], ['has', 'cutting']],
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      paint: {
        'line-color': ['case', ['has', 'cutting'], '#b2aaa0', '#c3b79f'],
        'line-width': 3,
        'line-opacity': PATH_EARTHWORK_OPACITY,
      },
    },
    {
      id: 'path-casing',
      type: 'line',
      source: 'tampere',
      'source-layer': 'paths',
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#e6dfd2',
        'line-width': PATH_CASING_WIDTH,
        'line-opacity': PATH_DETAIL_CASING_OPACITY,
      },
    },
    {
      id: 'paths',
      type: 'line',
      source: 'tampere',
      'source-layer': 'paths',
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': SURFACE_PATH_COLOR,
        'line-width': PATH_WIDTH,
        'line-opacity': PATH_DETAIL_OPACITY,
      },
    },
    {
      id: 'bridge-road-edge-shade',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      minzoom: 12,
      filter: ['all', ['has', 'bridge'], ['!=', ['get', 'bridge'], 'no']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#59615d',
        'line-width': ROAD_WIDTH,
        'line-translate': ['interpolate', ['linear'], ['zoom'], 10, ['literal', [0.5, -0.5]], 18, ['literal', [2.5, -2.5]]],
        'line-translate-anchor': 'map',
        'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 1.6],
        'line-opacity': 0.1,
      },
    },
    {
      id: 'bridge-path-edge-shade',
      type: 'line',
      source: 'tampere',
      'source-layer': 'paths',
      minzoom: 12,
      filter: ['all', ['has', 'bridge'], ['!=', ['get', 'bridge'], 'no']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#59615d',
        'line-width': PATH_WIDTH,
        'line-translate': ['interpolate', ['linear'], ['zoom'], 10, ['literal', [0.5, -0.5]], 18, ['literal', [2.5, -2.5]]],
        'line-translate-anchor': 'map',
        'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 1.6],
        'line-opacity': 0.09,
      },
    },
    {
      id: 'bridge-railway-edge-shade',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      minzoom: 12,
      filter: ['all', ['has', 'bridge'], ['!=', ['get', 'bridge'], 'no']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#59615d',
        'line-width': RAILWAY_BED_WIDTH,
        'line-translate': ['interpolate', ['linear'], ['zoom'], 10, ['literal', [0.5, -0.5]], 18, ['literal', [2.5, -2.5]]],
        'line-translate-anchor': 'map',
        'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 1.6],
        'line-opacity': 0.09,
      },
    },
    {
      id: 'tunnel-entrance-casing',
      type: 'line',
      source: 'tunnel-entrances',
      minzoom: 13,
      paint: {
        'line-color': '#d5d0c6',
        'line-width': ['match', ['get', 'transport'], 'railway', 7, 9],
        'line-opacity': 0.95,
      },
    },
    {
      id: 'tunnel-entrances',
      type: 'line',
      source: 'tunnel-entrances',
      minzoom: 13,
      paint: {
        'line-color': '#4d5150',
        'line-width': ['match', ['get', 'transport'], 'railway', 2.2, 3],
        'line-opacity': 0.95,
      },
    },
    {
      id: 'building-shadow-soft',
      type: 'line',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: 13,
      filter: ['>', ['get', 'height'], 0],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, 2,
          15, 4.5,
          18, 9,
        ],
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.9,
          18, 2,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.08,
          15, 0.13,
          18, 0.19,
        ],
      },
    },
    {
      id: 'building-shadows',
      type: 'line',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: 13,
      filter: ['>', ['get', 'height'], 0],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, 1,
          15, 2.2,
          18, 4.2,
        ],
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.4,
          18, 0.9,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.15,
          15, 0.23,
          18, 0.31,
        ],
      },
    },
    {
      id: 'power-point-shadows',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'power',
      minzoom: 10,
      filter: ['match', ['get', 'class'], 'tower', true, 'generator', true, false],
      paint: {
        'circle-color': '#1f302d',
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, 0.7, 14, 2.5, 18, 8],
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map',
        'circle-blur': 0.75,
        'circle-opacity': 0.18,
      },
    },
    {
      id: 'landmark-area-shadows',
      type: 'line',
      source: 'tampere',
      'source-layer': 'landmarks',
      minzoom: 12,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2.5, 18, 5],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 18, 1.4],
        'line-opacity': 0.14,
      },
    },
    {
      id: 'landmark-point-shadows',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'landmarks',
      minzoom: 12,
      paint: {
        'circle-color': '#1f302d',
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 12, 1.2, 14, 3, 18, 10],
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map',
        'circle-blur': 0.72,
        'circle-opacity': 0.17,
      },
    },
    ...buildingStoryLayers(),
    {
      id: 'building-roof-caps',
      type: 'fill-extrusion',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: BUILDING_DETAIL_MIN_ZOOM,
      filter: [
        'all',
        ['>', ['get', 'roof_height'], 0],
        ['==', ['get', 'roof_shape'], 'flat'],
      ],
      paint: {
        'fill-extrusion-color': ROOF_COLOR,
        'fill-extrusion-height': ['+', ['get', 'height'], 0.04],
        // Render only a thin cap. Extruding the full tagged roof height would
        // overlap the upper floor bands and reintroduce depth fighting.
        'fill-extrusion-base': ['get', 'height'],
        'fill-extrusion-opacity': 0.98,
      },
    },
    {
      id: 'tree-points',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'trees',
      minzoom: 11,
      maxzoom: 13,
      paint: {
        'circle-color': '#5d9951',
        'circle-radius': 2,
        'circle-opacity': 0.8,
        'circle-stroke-color': '#39713a',
        'circle-stroke-width': 0.5,
      },
    },
    {
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: 'terrain',
      layout: { visibility: 'none' },
      paint: {
        'hillshade-exaggeration': 0.4,
        'hillshade-illumination-direction': CARTOON_SUN_AZIMUTH_DEGREES,
        'hillshade-illumination-anchor': 'map',
        'hillshade-shadow-color': '#5e6c65',
        'hillshade-highlight-color': '#fff9ea',
        'hillshade-accent-color': '#9eaaa2',
      },
    },
    {
      id: 'places-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'places',
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15],
        'text-font': ['Open Sans Regular'],
        'text-offset': [0, 0.8],
      },
      paint: {
        'text-color': '#4e5a52',
        'text-halo-color': '#f4f6f2',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'poi-circles',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'pois',
      minzoom: 14,
      filter: ['has', 'name'],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 4,
        'circle-stroke-color': '#6d7a71',
        'circle-stroke-width': 1,
      },
    },
    {
      id: 'poi-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'pois',
      minzoom: 14,
      filter: [
        'all',
        ['has', 'name'],
        // Keep small water features discoverable by their marker, but avoid
        // presenting them as city-scale destinations.
        ['!', ['in', ['get', 'class'], ['literal', ['fountain', 'pond', 'swimming_pool']]]],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.1],
      },
      paint: {
        'text-color': '#59645c',
        'text-halo-color': '#f4f6f2',
        'text-halo-width': 1.25,
      },
    },
  ],
};

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const treeRefreshRef = useRef<(() => void) | null>(null);
  const treeLayerRef = useRef<TreeModelLayer | null>(null);
  const infrastructureLayerRef = useRef<InfrastructureModelLayer | null>(null);
  const terrainSourceRef = useRef('terrain');
  const terrainEnabledRef = useRef(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layerToggles, setLayerToggles] = useState<LayerToggleState>({
    globe: true,
    bridges: false,
    // Prefer the MapLibre metre-scaled line layers for now. The custom
    // polygons remain available through the visibility control.
    roofs: false,
    trees: true,
    buildings: true,
    terrain: true,
    waterEffect: true,
    shadows: true,
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: USE_LOCAL_MAP_DATA ? TAMPERE_STYLE : GLOBAL_MAP_STYLE,
      center: TAMPERE,
      zoom: USE_LOCAL_MAP_DATA ? 11 : 2.2,
      pitch: USE_LOCAL_MAP_DATA ? 45 : 0,
      bearing: 0,
      // MapLibre line layers are screen-space strokes. At extreme pitch the
      // perspective projection makes foreground roads look disproportionately
      // wide; keep the line-based mode readable until polygon roads return.
      maxPitch: 55,
      // Keep the default view focused on an area a few hundred metres across;
      // closer views make screen-space MapLibre roads dominate the scene.
      maxZoom: 18,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    const roofLayer = USE_LOCAL_MAP_DATA ? new BuildingRoofLayer() : undefined;
    const bridgeLayer = USE_LOCAL_MAP_DATA ? new BridgeModelLayer() : undefined;
    const infrastructureLayer = USE_LOCAL_MAP_DATA
      ? new InfrastructureModelLayer()
      : undefined;
    const treeLayer = new TreeModelLayer(USE_LOCAL_MAP_DATA
      ? {
          sourceId: 'tampere',
          waterLayers: ['water', 'water_detail', 'river_areas'],
          vegetationLayers: ['landuse'],
          mappedTreeLayer: 'trees',
        }
      : {
          sourceId: OPENFREEMAP_SOURCE_ID,
          waterLayers: ['water'],
          vegetationLayers: ['landcover', 'landuse', 'park'],
        });
    treeLayerRef.current = treeLayer;
    infrastructureLayerRef.current = infrastructureLayer ?? null;
    let treeUpdateTimer: number | undefined;
    let terrainCoverageTimer: number | undefined;
    let terrainCoverageGeneration = 0;
    let detailTerrainMaxZoom: number | undefined;
    let lowZoomTerrainProbeComplete = false;
    let initialLoadComplete = false;
    let roadWidthLatitude: number | undefined;
    let globalLabelPitchBucket: number | undefined;
    let modelDataRevision = 0;
    let lastModelUpdateSignature: string | undefined;
    const modelVectorSourceId = USE_LOCAL_MAP_DATA ? 'tampere' : OPENFREEMAP_SOURCE_ID;
    const processedBuildingColors = new globalThis.Map<string, { base: string; alt: string; band: string }>();

    const setTerrainSource = (sourceId: string) => {
      const sourceChanged = terrainSourceRef.current !== sourceId;
      terrainSourceRef.current = sourceId;
      if (sourceChanged) {
        treeLayer.invalidateTerrain();
        modelDataRevision += 1;
      }
      // Reapplying the same terrain specification makes MapLibre recalculate
      // its terrain-clamped camera and can look like a small backward zoom.
      if (terrainEnabledRef.current && sourceChanged) {
        map.setTerrain({ source: sourceId, exaggeration: 1 });
      }
      if (map.getLayer('terrain-hillshade')) {
        map.setLayoutProperty(
          'terrain-hillshade',
          'visibility',
          terrainEnabledRef.current && sourceId === 'terrain' ? 'visible' : 'none',
        );
      }
      if (map.getLayer(DETAIL_HILLSHADE_LAYER_ID)) {
        map.setLayoutProperty(
          DETAIL_HILLSHADE_LAYER_ID,
          'visibility',
          terrainEnabledRef.current && sourceId === MAPTERHORN_DETAIL_SOURCE_ID
            ? 'visible'
            : 'none',
        );
      }
    };

    const installDetailedTerrain = (maxzoom: number) => {
      if (detailTerrainMaxZoom === maxzoom && map.getSource(MAPTERHORN_DETAIL_SOURCE_ID)) {
        setTerrainSource(MAPTERHORN_DETAIL_SOURCE_ID);
        return;
      }

      // A raster-dem source cannot change maxzoom in place. Move terrain back
      // to the guaranteed global source before replacing the regional source.
      if (map.getSource(MAPTERHORN_DETAIL_SOURCE_ID)) {
        map.setTerrain(terrainEnabledRef.current
          ? { source: 'terrain', exaggeration: 1 }
          : null);
        terrainSourceRef.current = 'terrain';
        if (map.getLayer(DETAIL_HILLSHADE_LAYER_ID)) {
          map.removeLayer(DETAIL_HILLSHADE_LAYER_ID);
        }
        map.removeSource(MAPTERHORN_DETAIL_SOURCE_ID);
      }

      map.addSource(MAPTERHORN_DETAIL_SOURCE_ID, detailedTerrainSource(maxzoom));
      const detailHillshade: HillshadeLayerSpecification = {
        id: DETAIL_HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: MAPTERHORN_DETAIL_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'hillshade-exaggeration': 0.34,
          'hillshade-illumination-direction': CARTOON_SUN_AZIMUTH_DEGREES,
          'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': '#5e6c65',
          'hillshade-highlight-color': '#fff9ea',
          'hillshade-accent-color': '#9eaaa2',
        },
      };
      map.addLayer(detailHillshade, 'global-water-edge-shade');
      detailTerrainMaxZoom = maxzoom;
      setTerrainSource(MAPTERHORN_DETAIL_SOURCE_ID);
    };

    const updateTerrainResolution = async (generation: number) => {
      if (USE_LOCAL_MAP_DATA || !map.isStyleLoaded()) return;
      const isLowZoomProbe = map.getZoom() < GLOBAL_TERRAIN_MAX_ZOOM + 0.25;
      // Probe the initial center while the globe is still zoomed out, where a
      // one-time source installation is visually inert. Once installed, the
      // same source can serve both its global z0-z12 tiles and regional detail.
      if (isLowZoomProbe && lowZoomTerrainProbeComplete) return;

      const bounds = map.getBounds();
      const samplePoints = isLowZoomProbe
        ? [map.getCenter()]
        : [
            map.getCenter(),
            bounds.getNorthWest(),
            bounds.getNorthEast(),
            bounds.getSouthWest(),
            bounds.getSouthEast(),
          ];
      try {
        // Discover the regional ceiling in one pass. Incrementally replacing
        // the DEM source at every integer camera zoom causes visible jumps.
        const maxzoom = await detailedTerrainZoom(samplePoints, DETAIL_TERRAIN_MAX_ZOOM);
        if (generation !== terrainCoverageGeneration) return;
        if (isLowZoomProbe) lowZoomTerrainProbeComplete = true;
        if (maxzoom > GLOBAL_TERRAIN_MAX_ZOOM) {
          installDetailedTerrain(maxzoom);
        } else {
          setTerrainSource('terrain');
        }
      } catch (error) {
        if (generation !== terrainCoverageGeneration) return;
        if (isLowZoomProbe) lowZoomTerrainProbeComplete = true;
        console.warn('Detailed terrain coverage check failed; using global terrain.', error);
        setTerrainSource('terrain');
      }
    };

    const scheduleTerrainResolutionUpdate = () => {
      if (USE_LOCAL_MAP_DATA) return;
      if (terrainCoverageTimer !== undefined) window.clearTimeout(terrainCoverageTimer);
      terrainCoverageGeneration += 1;
      const generation = terrainCoverageGeneration;
      terrainCoverageTimer = window.setTimeout(() => {
        void updateTerrainResolution(generation);
      }, 180);
    };

    const updateGlobalRoadWidths = () => {
      if (USE_LOCAL_MAP_DATA) return;
      const latitude = map.getCenter().lat;
      if (roadWidthLatitude !== undefined && Math.abs(latitude - roadWidthLatitude) < 0.25) return;
      roadWidthLatitude = latitude;
      GLOBAL_ROAD_CASING_LAYER_IDS.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'line-width', roadWidthExpression(latitude, true));
        }
      });
      GLOBAL_ROAD_LAYER_IDS.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'line-width', roadWidthExpression(latitude));
        }
      });
    };
    const updateGlobalLabelDensity = () => {
      if (USE_LOCAL_MAP_DATA || !map.isStyleLoaded()) return;
      const pitch = map.getPitch();
      const zoom = map.getZoom();
      const pitchBucket = pitch >= 40 ? 2 : pitch >= 25 ? 1 : 0;
      const zoomBucket = zoom >= 16 ? 2 : zoom >= 14 ? 1 : 0;
      const nextBucket = Math.max(pitchBucket, zoomBucket);
      if (globalLabelPitchBucket === nextBucket) return;
      globalLabelPitchBucket = nextBucket;

      const opacityByLayer: Array<[string, [number, number, number]]> = [
        ['global-transit-line-labels', [1, 1, 1]],
        ['global-cycleway-labels', [1, 1, 1]],
        ['global-road-labels', [1, 0.72, 0.36]],
        ['global-water-labels', [1, 1, 1]],
        ['global-park-labels', [1, 1, 1]],
        ['global-railway-station-labels', [1, 1, 1]],
        ['global-poi-labels', [1, 1, 1]],
      ];
      opacityByLayer.forEach(([layerId, opacity]) => {
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'text-opacity', opacity[nextBucket]);
        }
      });
      if (map.getLayer('global-poi-labels')) {
        map.setLayoutProperty(
          'global-poi-labels',
          'visibility',
          nextBucket === 2 ? 'none' : 'visible',
        );
      }
      if (map.getLayer('global-housenumbers')) {
        map.setLayoutProperty(
          'global-housenumbers',
          'visibility',
          nextBucket === 2 ? 'none' : 'visible',
        );
        map.setPaintProperty(
          'global-housenumbers',
          'text-opacity',
          nextBucket === 1 ? 0.35 : 0.82,
        );
      }
    };
    const modelUpdateSignature = () => {
      const bounds = map.getBounds();
      return [
        modelDataRevision,
        terrainSourceRef.current,
        terrainEnabledRef.current ? 1 : 0,
        map.getZoom().toFixed(2),
        map.getPitch().toFixed(1),
        map.getBearing().toFixed(1),
        bounds.getWest().toFixed(5),
        bounds.getSouth().toFixed(5),
        bounds.getEast().toFixed(5),
        bounds.getNorth().toFixed(5),
      ].join(':');
    };
    const updateTreeModels = () => {
      treeUpdateTimer = undefined;
      if (map.isMoving()) {
        scheduleTreeUpdate();
        return;
      }
      const nextSignature = modelUpdateSignature();
      if (nextSignature === lastModelUpdateSignature) return;
      roofLayer?.updateRoofs();
      bridgeLayer?.updateBridges();
      infrastructureLayer?.updateInfrastructure();
      treeLayer.updateTrees();
      lastModelUpdateSignature = nextSignature;
    };
    const scheduleTreeUpdate = () => {
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      treeUpdateTimer = window.setTimeout(updateTreeModels, 120);
    };
    const invalidateAndScheduleModels = () => {
      modelDataRevision += 1;
      scheduleTreeUpdate();
    };
    const updatePastelBuildingColors = () => {
      if (USE_LOCAL_MAP_DATA || !map.isStyleLoaded()) return;
      let changed = false;
      for (const feature of map.querySourceFeatures(OPENFREEMAP_SOURCE_ID, {
        sourceLayer: 'building',
      })) {
        if (feature.id === undefined || feature.id === null) continue;
        const value = feature.properties?.colour ?? feature.properties?.color;
        const base = pastelBuildingColor(value, 0.32);
        const alt = pastelBuildingColor(value, 0.42);
        const band = pastelBuildingColor(value, 0.50);
        if (!base || !alt || !band) continue;
        const key = String(feature.id);
        const previous = processedBuildingColors.get(key);
        if (previous?.base === base && previous.alt === alt && previous.band === band) continue;
        processedBuildingColors.set(key, { base, alt, band });
        map.setFeatureState(
          { source: OPENFREEMAP_SOURCE_ID, sourceLayer: 'building', id: feature.id },
          {
            pastelBuildingColor: base,
            pastelBuildingColorAlt: alt,
            pastelBuildingBandColor: band,
          },
        );
        changed = true;
      }
      if (changed) map.triggerRepaint();
    };
    const handleModelSourceData = (event: MapSourceDataEvent) => {
      if (event.sourceId !== modelVectorSourceId || event.sourceDataType !== 'content') return;
      modelDataRevision += 1;
      updatePastelBuildingColors();
    };
    treeRefreshRef.current = invalidateAndScheduleModels;
    map.once('load', () => {
      // MapLibre uses image pixelRatio when determining pattern spacing. A
      // 512px image at 0.5 therefore repeats every 1024 logical pixels,
      // providing broad variation at every zoom without a custom shader.
      map.addImage(WATER_PATTERN_ID, createWaterPattern(512), { pixelRatio: 0.5 });
      if (USE_LOCAL_MAP_DATA) {
        waterPatternLayers().forEach((layer) => map.addLayer(layer, 'water-structure-areas'));
        if (roofLayer) map.addLayer(roofLayer, 'places-labels');
        if (bridgeLayer) map.addLayer(bridgeLayer, 'places-labels');
        if (infrastructureLayer) map.addLayer(infrastructureLayer, 'places-labels');
        map.addLayer(treeLayer, 'places-labels');
      } else {
        map.addLayer(globalWaterPatternLayer(), 'global-pedestrian-areas');
        map.addLayer(treeLayer, 'global-road-labels');
      }
      updateGlobalRoadWidths();
      updateGlobalLabelDensity();
      scheduleTreeUpdate();
      scheduleTerrainResolutionUpdate();
      initialLoadComplete = true;
      setMapLoaded(true);
    });
    const handleMoveEnd = () => {
      updateGlobalRoadWidths();
      updatePastelBuildingColors();
      scheduleTreeUpdate();
      scheduleTerrainResolutionUpdate();
    };
    const handleCameraMove = () => updateGlobalLabelDensity();
    map.on('move', handleCameraMove);
    map.on('moveend', handleMoveEnd);
    map.on('sourcedata', handleModelSourceData);
    // Waiting for idle avoids rebuilding all custom meshes once per tile while
    // a pan/zoom is still filling the viewport. moveend handles interaction;
    // idle handles the final set of newly loaded tiles.
    map.on('idle', scheduleTreeUpdate);
    map.on('idle', updatePastelBuildingColors);
    map.on('error', (event) => {
      const message = event.error?.message ?? 'The map style could not be loaded.';
      // MapLibre can emit this while backfilling a missing edge DEM tile. It
      // is non-fatal when the map is otherwise rendering.
      if (message.toLowerCase().includes('dem dimension mismatch')) {
        console.warn(message);
        return;
      }
      // Individual network-tile failures are recoverable: MapLibre can retain
      // parent tiles and retry as the camera moves. Only block the initial map
      // for style/source errors; after load, surface failures in the console.
      if (initialLoadComplete) {
        console.warn(message);
      } else {
        setMapError(message);
      }
    });
    mapRef.current = map;

    return () => {
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      if (terrainCoverageTimer !== undefined) window.clearTimeout(terrainCoverageTimer);
      terrainCoverageGeneration += 1;
      map.off('move', handleCameraMove);
      map.off('moveend', handleMoveEnd);
      map.off('sourcedata', handleModelSourceData);
      map.off('idle', scheduleTreeUpdate);
      map.off('idle', updatePastelBuildingColors);
      map.remove();
      mapRef.current = null;
      treeRefreshRef.current = null;
      treeLayerRef.current = null;
      infrastructureLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const setVisibility = (layerIds: string[], visible: boolean) => {
      layerIds.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
      });
    };

    setVisibility(['bridge-models-3d'], layerToggles.bridges);
    setVisibility(['tree-models-3d', 'tree-points'], layerToggles.trees);
    setVisibility(BUILDING_LAYER_IDS, layerToggles.buildings);
    setVisibility(
      ['building-roofs-3d', 'building-roof-caps', ...GLOBAL_BUILDING_ROOF_LAYER_IDS],
      layerToggles.buildings && layerToggles.roofs,
    );
    setVisibility(
      BUILDING_SHADOW_LAYER_IDS,
      layerToggles.buildings && layerToggles.shadows,
    );
    setVisibility(BRIDGE_DECK_EFFECT_LAYER_IDS, layerToggles.shadows);
    setVisibility(INFRASTRUCTURE_SHADOW_LAYER_IDS, layerToggles.shadows);
    infrastructureLayerRef.current?.setShadowsEnabled(layerToggles.shadows);
    treeLayerRef.current?.setShadowsEnabled(layerToggles.trees && layerToggles.shadows);
    setVisibility(WATER_EFFECT_LAYER_IDS, layerToggles.waterEffect);
    if (!USE_LOCAL_MAP_DATA) {
      map.setProjection({ type: layerToggles.globe ? 'globe' : 'mercator' });
    }
    terrainEnabledRef.current = layerToggles.terrain;
    map.setTerrain(layerToggles.terrain
      ? { source: terrainSourceRef.current, exaggeration: 1.0 }
      : null);
    if (map.getLayer('terrain-hillshade')) {
      map.setLayoutProperty(
        'terrain-hillshade',
        'visibility',
        layerToggles.terrain && terrainSourceRef.current === 'terrain' ? 'visible' : 'none',
      );
    }
    if (map.getLayer(DETAIL_HILLSHADE_LAYER_ID)) {
      map.setLayoutProperty(
        DETAIL_HILLSHADE_LAYER_ID,
        'visibility',
        layerToggles.terrain && terrainSourceRef.current === MAPTERHORN_DETAIL_SOURCE_ID
          ? 'visible'
          : 'none',
      );
    }
    treeRefreshRef.current?.();
  }, [layerToggles, mapLoaded]);

  return (
    <div ref={containerRef} className="map-canvas">
      {!mapLoaded && !mapError && <div className="map-status">Loading map…</div>}
      {mapError && (
        <div className="map-status map-status-error">
          <strong>Map unavailable</strong>
          <span>{mapError}</span>
          <small>Check that the browser can access the configured map style.</small>
        </div>
      )}
      {mapLoaded && !mapError && (
        <>
          <div className={`layer-control${layersOpen ? ' layer-control-open' : ''}`}>
            <button
              className="layer-control-trigger"
              type="button"
              aria-expanded={layersOpen}
              aria-controls="map-layer-panel"
              aria-label="Toggle map layers"
              onClick={() => setLayersOpen((open) => !open)}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="m12 3 8 4-8 4-8-4 8-4Z" />
                <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
              </svg>
              <span>Layers</span>
              <svg className="layer-control-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {layersOpen && (
              <div className="layer-panel" id="map-layer-panel" aria-label="Map layer visibility">
                <div className="layer-panel-heading">
                  <div>
                    <strong>Map layers</strong>
                    <span>Customize your view</span>
                  </div>
                  <span className="layer-panel-count">
                    {Object.values(layerToggles).filter(Boolean).length} active
                  </span>
                </div>

                <div className="layer-group">
                  <span className="layer-group-title">View</span>
                  {(USE_LOCAL_MAP_DATA
                    ? ([['terrain', 'Terrain'], ['waterEffect', 'Water texture']] as const)
                    : ([['globe', 'Globe'], ['terrain', 'Terrain'], ['waterEffect', 'Water texture']] as const)
                  ).map(([key, label]) => (
                    <label className="layer-toggle" key={key}>
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={layerToggles[key]}
                        onChange={(event) => setLayerToggles((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))}
                      />
                      <span className="layer-switch" aria-hidden="true"><span /></span>
                    </label>
                  ))}
                </div>

                <div className="layer-group">
                  <span className="layer-group-title">Details</span>
                  {(USE_LOCAL_MAP_DATA
                    ? ([['buildings', 'Buildings'], ['roofs', 'Building roofs'], ['trees', 'Trees'], ['bridges', 'Bridges'], ['shadows', 'Shadows']] as const)
                    : ([['buildings', 'Buildings'], ['trees', 'Trees'], ['shadows', 'Shadows']] as const)
                  ).map(([key, label]) => (
                    <label className="layer-toggle" key={key}>
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={layerToggles[key]}
                        onChange={(event) => setLayerToggles((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))}
                      />
                      <span className="layer-switch" aria-hidden="true"><span /></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
