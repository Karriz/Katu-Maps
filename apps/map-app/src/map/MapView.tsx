import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type FillLayerSpecification,
  type FillExtrusionLayerSpecification,
  type LineLayerSpecification,
  type Map,
  type StyleSpecification,
} from 'maplibre-gl';
import { BuildingRoofLayer } from './BuildingRoofLayer';
import { BridgeModelLayer } from './BridgeModelLayer';
import { InfrastructureModelLayer } from './InfrastructureModelLayer';
import { TreeModelLayer } from './TreeModelLayer';

const TAMPERE: [number, number] = [23.7609, 61.4981];
const TILEJSON_URL = 'http://localhost:3000/tampere';
const TERRAIN_TILEJSON_URL = 'http://localhost:3000/terrain';
// Keep the metre-scaled transport polygons active at close zooms, but defer
// expensive building detail until it is large enough to be readable.
const BUILDING_DETAIL_MIN_ZOOM = 17;
const MAX_BUILDING_STORY_SLICES = 25;
const GROUND_COLOR = '#e8ece5';
const WATER_COLOR = '#78c4df';
const WATER_EDGE_COLOR = '#5faec8';
const WATER_PATTERN_ID = 'water-surface-pattern';
const WATER_EFFECT_LAYER_IDS = [
  'water-pattern',
  'water-detail-pattern',
  'river-area-pattern',
];
const INFRASTRUCTURE_SHADOW_LAYER_IDS = [
  'power-point-shadows',
  'landmark-area-shadows',
  'landmark-point-shadows',
];
const BUILDING_SHADOW_LAYER_IDS = [
  'building-shadow-soft',
  'building-shadows',
];
const BRIDGE_DECK_EFFECT_LAYER_IDS = [
  'bridge-road-edge-shade',
  'bridge-path-edge-shade',
  'bridge-railway-edge-shade',
];

type LayerToggleState = {
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
];

function createWaterPattern(size: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  const shadow = [18, 92, 145];
  const highlight = [181, 232, 245];
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
        0, 0.08,
        10, 0.12,
        12, 0.14,
        14, 0.16,
        15.5, 0.24,
        18, 0.28,
      ],
    },
  }));
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
  '#c9cecc', '#d1d0c8', '#c6ced1', '#d0d5cc',
]);
const DEFAULT_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#dde2df', '#e1e0d8', '#dbe1e3', '#e0e5dc',
]);
const RESIDENTIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#d1d0c5', '#c9d0cc', '#d7d0bf', '#c8d1d0',
]);
const RESIDENTIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#e2e1d8', '#dfe5e1', '#e8e2d4', '#dee6e5',
]);
const APARTMENT_BUILDING_PALETTE = seededBuildingPalette([
  '#c3cbd0', '#c9c7c0', '#c4ced0', '#d0ccc3',
]);
const APARTMENT_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#dbe0e3', '#e0ded7', '#dce4e5', '#e4e1da',
]);
const COMMERCIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#c4ced1', '#c7c9c5', '#c9d0c8', '#c2cdd0',
]);
const COMMERCIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#dce4e6', '#dfe1dc', '#e0e5df', '#dbe3e5',
]);
const INDUSTRIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#bac5c3', '#c0c9c5', '#c8c8bd', '#bcc7cc',
]);
const INDUSTRIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#d5ddda', '#d9e0dc', '#e0e0d6', '#d6dfe2',
]);
const CIVIC_BUILDING_PALETTE = seededBuildingPalette([
  '#d1cbbd', '#c8c9c6', '#d4cfbf', '#c2cfcb',
]);
const CIVIC_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#e2ddcf', '#dedfdb', '#e6e1d4', '#d9e4e1',
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
  BUILDING_COLOR_ALT,
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

const ROAD_CASING_METERS: ExpressionSpecification = ['+', ROAD_WIDTH_METERS, 2.4];
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
  13, 0.92,
];
const PATH_DETAIL_CASING_OPACITY: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  12, 0,
  13, 0.9,
];
const PATH_EARTHWORK_OPACITY: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  12, 0,
  13, 0.4,
];

const PATH_CASING_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  12, ['+', ['max', 0.25, ['*', PATH_WIDTH_METERS, 0.109664]], 2.5],
  14, ['+', ['*', PATH_WIDTH_METERS, 0.438658], 2.5],
  16, ['+', ['*', PATH_WIDTH_METERS, 1.754634], 2.5],
  18, ['+', ['*', PATH_WIDTH_METERS, 5.5], 2.5],
  20, ['+', ['*', PATH_WIDTH_METERS, 28.074158], 2.5],
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

const SURFACE_ROAD_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'surface'],
  'gravel', '#d8cfbd',
  'unpaved', '#ddd2bc',
  'dirt', '#d4c09e',
  'ground', '#d4c09e',
  'sand', '#ead9ad',
  'cobblestone', '#7d8281',
  'paving_stones', '#898e8c',
  'concrete', '#aeb5b4',
  '#697174',
];

const SURFACE_PATH_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'class'], 'cycleway'], '#c97872',
  [
    'match',
    ['get', 'surface'],
    'asphalt', '#9ea7a6',
    'gravel', '#c9b083',
    'dirt', '#b59468',
    'ground', '#b59468',
    'sand', '#dfbf75',
    '#b8aa89',
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
    const storyColor: ExpressionSpecification = storyIndex % 2 === 0
      ? BUILDING_COLOR
      : [
          'step',
          ['zoom'],
          BUILDING_COLOR,
          BUILDING_DETAIL_MIN_ZOOM,
          BUILDING_COLOR_ALT,
        ];

    return {
      id: `building-story-${storyIndex + 1}`,
      type: 'fill-extrusion',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: 12,
      filter: ['>', ['get', 'levels'], storyIndex],
      paint: {
        // Use one continuous set of geometry at every building zoom. Alternate
        // colors appear only at close zoom, without swapping whole layers at a
        // fractional zoom boundary.
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
      'line-color': '#66747b',
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
      'line-opacity': 0.95,
    },
  }));
}

const TAMPERE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Tampere local OSM',
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
          'forest', '#83b878',
          'wood', '#91c582',
          'scrub', '#b8d58f',
          'shrubbery', '#a8cb91',
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
          'park', '#a9d394',
          'recreation_ground', '#b6d99b',
          'meadow', '#c1dfa2',
          'grass', '#b8d99f',
          'grassland', '#b6d79e',
          'garden', '#b9d5a4',
          'dog_park', '#b3d09d',
          'village_green', '#afd197',
          'allotments', '#c9dc9f',
          'cemetery', '#c2d9b5',
          'churchyard', '#c7d9ba',
          'religious', '#d8dfca',
          'nature_reserve', '#9fc98d',
          'pitch', '#add38e',
          'playground', '#d6df9d',
          'sports_centre', '#d7e9c1',
          'stadium', '#d2e7b9',
          'track', '#dceac0',
          'golf_course', '#d0e8bd',
          'fitness_station', '#c0dba8',
          'ice_rink', '#d3e8e8',
          'swimming_pool', '#a9d8e6',
          'swimming_area', '#b6dce7',
          'marina', '#c4dce4',
          'residential', '#cbd4c6',
          'commercial', '#c7d0ce',
          'retail', '#d8d1bc',
          'industrial', '#b8c7c7',
          'railway', '#deddd6',
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
        'fill-opacity': 0.96,
      },
    },
    {
      id: 'water-edge-shade',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water',
      paint: {
        'fill-color': '#4f9fbd',
        'fill-translate': ['interpolate', ['linear'], ['zoom'], 10, ['literal', [0.7, -0.7]], 18, ['literal', [2.5, -2.5]]],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.14,
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
        'fill-color': '#4f9fbd',
        'fill-translate': ['interpolate', ['linear'], ['zoom'], 13, ['literal', [0.7, -0.7]], 18, ['literal', [2.5, -2.5]]],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.12,
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
      id: 'waterways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'waterways',
      paint: {
        'line-color': '#69c3e8',
        'line-opacity': 0.9,
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
    // Draw area water after centerlines so large river/lake polygons hide the
    // duplicated OSM waterway line underneath them.
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
        'line-opacity': 0.9,
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
        'line-opacity': 0.18,
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
        'fill-outline-color': '#b9b2a6',
        'fill-opacity': 0.98,
      },
    },
    {
      id: 'parking',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'parking',
      paint: {
        'fill-color': '#e8ebeb',
        'fill-outline-color': '#d1d7d7',
        'fill-opacity': 0.94,
      },
    },
    {
      id: 'pedestrian-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'pedestrian_areas',
      paint: {
        'fill-color': '#f3ecdf',
        'fill-outline-color': '#ddd4c3',
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          14, 0.95,
          14.75, [
            'case',
            ['all', ['has', 'bridge'], ['!=', ['get', 'bridge'], 'no']],
            0.95,
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
      paint: { 'fill-color': '#eaedef', 'fill-opacity': 0.92 },
    },
    {
      id: 'aeroway-lines',
      type: 'line',
      source: 'tampere',
      'source-layer': 'aeroway',
      paint: { 'line-color': '#ccd2d5', 'line-width': 2, 'line-opacity': 0.9 },
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
        'line-opacity': 0.4,
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
        'line-color': '#9aa7ad',
        'line-width': RAILWAY_BED_WIDTH,
        'line-opacity': 0.9,
      },
    },
    {
      id: 'railway-sleepers',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      minzoom: 12,
      filter: [
        'all',
        ['!', ['has', 'tunnel']],
        ['!', ['has', 'covered']],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#edf2ef',
        'line-width': RAILWAY_SLEEPER_WIDTH,
        'line-dasharray': [0.18, 1.15],
        'line-opacity': 0.96,
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
        'line-color': '#d8d4ca',
        'line-width': ROAD_CASING_WIDTH,
        'line-opacity': 0.92,
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
        'line-opacity': 0.98,
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
        'line-opacity': 0.94,
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
        'text-color': '#667073',
        'text-halo-color': '#f8f9f7',
        'text-halo-width': 1.5,
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
        'text-color': '#3f91b4',
        'text-halo-color': '#78c4df',
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
        'text-color': '#3f91b4',
        'text-halo-color': '#78c4df',
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
        'line-color': '#263831',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, 2.5,
          15, 6.5,
          17, 12,
          18, 16,
        ],
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          13, 1.2,
          16, 2.2,
          18, 3,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.08,
          15, 0.12,
          18, 0.18,
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
        'line-color': '#263831',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, 1.2,
          15, 2.8,
          17, 4.8,
          18, 6,
        ],
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.35,
          16, 0.6,
          18, 0.9,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.16,
          15, 0.24,
          18, 0.34,
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
        'line-color': '#263831',
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
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': '#66736c',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#aeb9b0',
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
      filter: ['has', 'name'],
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
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [layerToggles, setLayerToggles] = useState<LayerToggleState>({
    bridges: false,
    // Prefer the MapLibre metre-scaled line layers for now. The custom
    // polygons remain available through the visibility control.
    roofs: true,
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
      style: TAMPERE_STYLE,
      center: TAMPERE,
      zoom: 11,
      pitch: 45,
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
    const roofLayer = new BuildingRoofLayer();
    const bridgeLayer = new BridgeModelLayer();
    const infrastructureLayer = new InfrastructureModelLayer();
    const treeLayer = new TreeModelLayer();
    treeLayerRef.current = treeLayer;
    infrastructureLayerRef.current = infrastructureLayer;
    let treeUpdateTimer: number | undefined;
    const updateTreeModels = () => {
      if (map.isMoving()) {
        scheduleTreeUpdate();
        return;
      }
      roofLayer.updateRoofs();
      bridgeLayer.updateBridges();
      infrastructureLayer.updateInfrastructure();
      treeLayer.updateTrees();
    };
    const scheduleTreeUpdate = () => {
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      treeUpdateTimer = window.setTimeout(updateTreeModels, 120);
    };
    treeRefreshRef.current = scheduleTreeUpdate;
    map.once('load', () => {
      // MapLibre uses image pixelRatio when determining pattern spacing. A
      // 512px image at 0.5 therefore repeats every 1024 logical pixels,
      // providing broad variation at every zoom without a custom shader.
      map.addImage(WATER_PATTERN_ID, createWaterPattern(512), { pixelRatio: 0.5 });
      waterPatternLayers().forEach((layer) => map.addLayer(layer, 'water-structure-areas'));
      map.addLayer(roofLayer, 'places-labels');
      map.addLayer(bridgeLayer, 'places-labels');
      map.addLayer(infrastructureLayer, 'places-labels');
      map.addLayer(treeLayer, 'places-labels');
      scheduleTreeUpdate();
      setMapLoaded(true);
    });
    map.on('moveend', scheduleTreeUpdate);
    // Waiting for idle avoids rebuilding all custom meshes once per tile while
    // a pan/zoom is still filling the viewport. moveend handles interaction;
    // idle handles the final set of newly loaded tiles.
    map.on('idle', scheduleTreeUpdate);
    map.on('error', (event) => {
      const message = event.error?.message ?? 'The map style could not be loaded.';
      // MapLibre can emit this while backfilling a missing edge DEM tile. It
      // is non-fatal when the map is otherwise rendering.
      if (message.toLowerCase().includes('dem dimension mismatch')) {
        console.warn(message);
        return;
      }
      setMapError(message);
    });
    mapRef.current = map;

    return () => {
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      map.off('moveend', scheduleTreeUpdate);
      map.off('idle', scheduleTreeUpdate);
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
    setVisibility(['building-roofs-3d', 'building-roof-caps'], layerToggles.roofs);
    setVisibility(['tree-models-3d', 'tree-points'], layerToggles.trees);
    setVisibility(BUILDING_LAYER_IDS, layerToggles.buildings);
    setVisibility(
      BUILDING_SHADOW_LAYER_IDS,
      layerToggles.buildings && layerToggles.shadows,
    );
    setVisibility(BRIDGE_DECK_EFFECT_LAYER_IDS, layerToggles.shadows);
    setVisibility(INFRASTRUCTURE_SHADOW_LAYER_IDS, layerToggles.shadows);
    infrastructureLayerRef.current?.setShadowsEnabled(layerToggles.shadows);
    treeLayerRef.current?.setShadowsEnabled(layerToggles.trees && layerToggles.shadows);
    setVisibility(WATER_EFFECT_LAYER_IDS, layerToggles.waterEffect);
    map.setTerrain(layerToggles.terrain ? { source: 'terrain', exaggeration: 1.0 } : null);
    map.setLayoutProperty('terrain-hillshade', 'visibility', layerToggles.terrain ? 'visible' : 'none');
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
          <div className="layer-toggles" aria-label="Map layer visibility">
            <span className="layer-toggles-title">3D layers</span>
            {([
              ['bridges', 'Bridges'],
              ['roofs', 'Roofs'],
              ['trees', 'Trees'],
              ['buildings', 'Buildings'],
              ['terrain', 'Terrain'],
              ['waterEffect', 'Water texture'],
              ['shadows', 'Shadows'],
            ] as const).map(([key, label]) => (
              <label className="layer-toggle" key={key}>
                <input
                  type="checkbox"
                  checked={layerToggles[key]}
                  onChange={(event) => setLayerToggles((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
