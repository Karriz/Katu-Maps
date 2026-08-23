import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type ExpressionSpecification,
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
const BUILDING_DETAIL_MIN_ZOOM = 14;
const MAX_BUILDING_STORY_SLICES = 12;

function seededBuildingPalette(colors: string[]): ExpressionSpecification {
  return [
    'match',
    ['%', ['id'], colors.length],
    ...colors.flatMap((color, index) => [index, color]),
    colors[0],
  ] as ExpressionSpecification;
}

const DEFAULT_BUILDING_PALETTE = seededBuildingPalette([
  '#e2e4e3', '#e4ded9', '#dedfe9', '#e2e8df',
]);
const DEFAULT_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#eceeed', '#eee9e5', '#e9e9f0', '#ebf0e9',
]);
const RESIDENTIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#e8d9d3', '#e3dce8', '#e8dfca', '#dfe8e5',
]);
const RESIDENTIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#f0e5e0', '#ede8f0', '#f0e9dc', '#e8f0ed',
]);
const APARTMENT_BUILDING_PALETTE = seededBuildingPalette([
  '#d9dce8', '#ded8e7', '#d8e5e8', '#e4d9e8',
]);
const APARTMENT_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#e7e9f0', '#eae5ef', '#e6eef0', '#eee7f0',
]);
const COMMERCIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#d8e2eb', '#d9ddec', '#e2d9e8', '#d9e7e2',
]);
const COMMERCIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#e5edf3', '#e6e9f3', '#ede6f0', '#e7f0eb',
]);
const INDUSTRIAL_BUILDING_PALETTE = seededBuildingPalette([
  '#d6dedc', '#d3dcda', '#dfe0d5', '#d3dce5',
]);
const INDUSTRIAL_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#e1e7e5', '#dfe6e4', '#e9e8df', '#dfe7ed',
]);
const CIVIC_BUILDING_PALETTE = seededBuildingPalette([
  '#eadfca', '#dddbea', '#e6ddd0', '#dce8e5',
]);
const CIVIC_BUILDING_PALETTE_ALT = seededBuildingPalette([
  '#f0e8d8', '#e7e5ef', '#eee6dc', '#e6f0ed',
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

const ROAD_WIDTH_METERS: ExpressionSpecification = [
  'min', 30,
  [
    'case',
    ['has', 'width'], ['get', 'width'],
    ['has', 'lanes'], ['max', 3, ['*', ['get', 'lanes'], 3.25]],
    [
      'match', ['get', 'class'],
      'motorway', 12,
      'trunk', 10,
      'primary', 8,
      'secondary', 7,
      'tertiary', 6,
      'residential', 5.5,
      'service', 4,
      5,
    ],
  ],
];

const ROAD_WIDTH: ExpressionSpecification = [
  // Pixels per metre at Tampere's latitude for MapLibre's 512px world scale.
  'interpolate', ['exponential', 2], ['zoom'],
  10, ['max', 0.5, ['*', ROAD_WIDTH_METERS, 0.027416]],
  12, ['max', 0.6, ['*', ROAD_WIDTH_METERS, 0.109664]],
  14, ['*', ROAD_WIDTH_METERS, 0.438658],
  16, ['*', ROAD_WIDTH_METERS, 1.754634],
  18, ['*', ROAD_WIDTH_METERS, 7.01854],
  20, ['*', ROAD_WIDTH_METERS, 28.074158],
];

const ROAD_CASING_METERS: ExpressionSpecification = ['+', ROAD_WIDTH_METERS, 1];
const ROAD_CASING_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  10, ['max', 0.8, ['*', ROAD_CASING_METERS, 0.027416]],
  12, ['max', 1, ['*', ROAD_CASING_METERS, 0.109664]],
  14, ['*', ROAD_CASING_METERS, 0.438658],
  16, ['*', ROAD_CASING_METERS, 1.754634],
  18, ['*', ROAD_CASING_METERS, 7.01854],
  20, ['*', ROAD_CASING_METERS, 28.074158],
  22, ['*', ROAD_CASING_METERS, 112.296632],
  24, ['*', ROAD_CASING_METERS, 449.186528],
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
  18, ['*', PATH_WIDTH_METERS, 7.01854],
  20, ['*', PATH_WIDTH_METERS, 28.074158],
];

const RAILWAY_WIDTH_METERS: ExpressionSpecification = [
  'case', ['has', 'width'], ['get', 'width'], 3.2,
];

const RAILWAY_BED_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  10, ['max', 0.5, ['*', RAILWAY_WIDTH_METERS, 0.027416]],
  12, ['max', 0.6, ['*', RAILWAY_WIDTH_METERS, 0.109664]],
  14, ['*', RAILWAY_WIDTH_METERS, 0.438658],
  16, ['*', RAILWAY_WIDTH_METERS, 1.754634],
  18, ['*', RAILWAY_WIDTH_METERS, 7.01854],
  20, ['*', RAILWAY_WIDTH_METERS, 28.074158],
];

const RAILWAY_SLEEPER_WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 2], ['zoom'],
  12, 0.7,
  14, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 0.438658],
  16, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 1.754634],
  18, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 7.01854],
  20, ['*', ['+', RAILWAY_WIDTH_METERS, 0.5], 28.074158],
];

const SURFACE_ROAD_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'surface'],
  'gravel', '#d8cfbd',
  'unpaved', '#ddd2bc',
  'dirt', '#d4c09e',
  'ground', '#d4c09e',
  'sand', '#ead9ad',
  'cobblestone', '#d9d9d4',
  'paving_stones', '#e1e2dd',
  'concrete', '#e4e7e7',
  '#dfe4e5',
];

function buildingStoryLayers(): FillExtrusionLayerSpecification[] {
  return Array.from({ length: MAX_BUILDING_STORY_SLICES }, (_, storyIndex) => {
    const isTopSlice = storyIndex === MAX_BUILDING_STORY_SLICES - 1;
    const storyBase: ExpressionSpecification = [
      '+',
      ['get', 'base'],
      ['*', BUILDING_STORY_HEIGHT, storyIndex],
    ];
    const storyTop: ExpressionSpecification = isTopSlice
      ? BUILDING_BODY_HEIGHT
      : [
          'min',
          BUILDING_BODY_HEIGHT,
          [
            '+',
            ['get', 'base'],
            ['*', BUILDING_STORY_HEIGHT, storyIndex + 1],
          ],
        ];

    return {
      id: `building-story-${storyIndex + 1}`,
      type: 'fill-extrusion',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: BUILDING_DETAIL_MIN_ZOOM,
      filter: ['>', ['get', 'levels'], storyIndex],
      paint: {
        'fill-extrusion-color': storyIndex % 2 === 0 ? BUILDING_COLOR : BUILDING_COLOR_ALT,
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
      ['!', ['has', 'bridge']],
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
        20, side * 21.39,
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
    { id: 'background', type: 'background', paint: { 'background-color': '#f7f8f5' } },
    {
      id: 'landuse',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'landuse',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'forest', '#cdebc3',
          'wood', '#bfe4b5',
          'scrub', '#d8eabb',
          'heath', '#e9e5b6',
          'wetland', [
            'match',
            ['get', 'wetland'],
            'marsh', '#e4edc3',
            'swamp', '#d4e5c7',
            'bog', '#dce7d0',
            'fen', '#d9e8c9',
            '#dbe7cd',
          ],
          'bare_rock', '#e5e3dd',
          'sand', '#f4dfa7',
          'beach', '#f7e6b6',
          'farmland', '#edf0bb',
          'farmyard', '#eee7d6',
          'orchard', '#dfedc4',
          'vineyard', '#e2ebc0',
          'park', '#c4ebba',
          'recreation_ground', '#cfedbd',
          'meadow', '#dcefba',
          'grass', '#d3edbc',
          'allotments', '#dbebbd',
          'cemetery', '#d9ead4',
          'nature_reserve', '#b8e1ae',
          'pitch', '#bce6a8',
          'playground', '#e9edaa',
          'sports_centre', '#d7e9c1',
          'stadium', '#d2e7b9',
          'track', '#dceac0',
          'golf_course', '#d0e8bd',
          'residential', '#f4f4f0',
          'commercial', '#eee8f4',
          'retail', '#f7e8df',
          'industrial', '#e4ebf0',
          'brownfield', '#eee2d0',
          '#f1f3ee',
        ],
        'fill-opacity': 0.9,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water',
      paint: { 'fill-color': '#afe0f5' },
    },
    {
      id: 'water-detail',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water_detail',
      paint: { 'fill-color': '#afe0f5' },
    },
    {
      id: 'river-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'river_areas',
      paint: {
        'fill-color': '#afe0f5',
        'fill-opacity': 0.96,
        'fill-outline-color': '#8bd0ed',
      },
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
      id: 'bridges',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'bridges',
      // Transport-tagged bridge ways are rendered by BridgeModelLayer below.
      // The old man_made=bridge polygons are often broad footprints and can
      // duplicate the physical deck, especially at multi-modal bridges.
      layout: { visibility: 'none' },
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
        'fill-opacity': 0.95,
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
        ['!', ['has', 'bridge']],
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
        ['!', ['has', 'bridge']],
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
        ['!', ['has', 'bridge']],
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
        ['!', ['has', 'bridge']],
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
        ['!', ['has', 'bridge']],
      ],
      paint: {
        'line-color': '#c6ced0',
        'line-width': ROAD_CASING_WIDTH,
        'line-opacity': 0.9,
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
        ['!', ['has', 'bridge']],
      ],
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
        ['!', ['has', 'bridge']],
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
        ['!', ['has', 'bridge']],
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
        'text-halo-color': '#afe0f5',
        'text-halo-width': 1.25,
      },
    },
    {
      id: 'waterway-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'waterways',
      minzoom: 12,
      filter: ['has', 'name'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-font': ['Open Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 16,
      },
      paint: {
        'text-color': '#3f91b4',
        'text-halo-color': '#afe0f5',
        'text-halo-width': 1.25,
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
        ['!', ['has', 'bridge']],
      ],
      paint: {
        'line-color': ['case', ['has', 'cutting'], '#b2aaa0', '#c3b79f'],
        'line-width': 3,
        'line-opacity': 0.4,
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
        ['!', ['has', 'bridge']],
      ],
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'class'], 'cycleway'], '#82cbbb',
          [
            'match',
            ['get', 'surface'],
            'asphalt', '#b2bec1',
            'gravel', '#d8bf92',
            'dirt', '#ca9f68',
            'ground', '#ca9f68',
            'sand', '#e5c374',
            '#96bd8d',
          ],
        ],
        'line-width': PATH_WIDTH,
        'line-dasharray': [2, 2],
        'line-opacity': 0.92,
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
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: 12,
      maxzoom: BUILDING_DETAIL_MIN_ZOOM,
      paint: {
        'fill-extrusion-color': BUILDING_COLOR,
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 0.94,
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
        'fill-extrusion-base': ['-', ['get', 'height'], ['get', 'roof_height']],
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
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [terrainEnabled, setTerrainEnabled] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: TAMPERE_STYLE,
      center: TAMPERE,
      zoom: 11,
      pitch: 45,
      bearing: 0,
      maxPitch: 70,
      maxZoom: 20,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    const roofLayer = new BuildingRoofLayer();
    const bridgeLayer = new BridgeModelLayer();
    const infrastructureLayer = new InfrastructureModelLayer();
    const treeLayer = new TreeModelLayer();
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
      map.addLayer(roofLayer, 'places-labels');
      map.addLayer(bridgeLayer, 'places-labels');
      map.addLayer(infrastructureLayer, 'places-labels');
      map.addLayer(treeLayer, 'places-labels');
      scheduleTreeUpdate();
      setMapLoaded(true);
    });
    map.on('moveend', scheduleTreeUpdate);
    map.on('sourcedata', scheduleTreeUpdate);
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
      map.off('sourcedata', scheduleTreeUpdate);
      map.remove();
      mapRef.current = null;
      treeRefreshRef.current = null;
    };
  }, []);

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
        <button
          className="terrain-toggle"
          type="button"
          aria-pressed={terrainEnabled}
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const nextEnabled = !terrainEnabled;
            map.setTerrain(nextEnabled ? { source: 'terrain', exaggeration: 1.0 } : null);
            map.setLayoutProperty('terrain-hillshade', 'visibility', nextEnabled ? 'visible' : 'none');
            treeRefreshRef.current?.();
            setTerrainEnabled(nextEnabled);
          }}
        >
          {terrainEnabled ? 'Disable terrain' : 'Enable terrain'}
        </button>
      )}
    </div>
  );
}
