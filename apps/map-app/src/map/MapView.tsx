import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type FillExtrusionLayerSpecification,
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
    { id: 'background', type: 'background', paint: { 'background-color': '#f4f6f2' } },
    {
      id: 'landuse',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'landuse',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'forest', '#d7e8d1',
          'wood', '#c9e2c2',
          'scrub', '#d5e5b4',
          'heath', '#dce3ad',
          'wetland', [
            'match',
            ['get', 'wetland'],
            'marsh', '#dbe7ae',
            'swamp', '#c6dcb2',
            'bog', '#d2dfbb',
            'fen', '#cfdfb1',
            '#d1dfb9',
          ],
          'bare_rock', '#ddd9ce',
          'sand', '#f0dfae',
          'beach', '#f2e2b7',
          'farmland', '#e9edbf',
          'farmyard', '#e8e0c8',
          'orchard', '#d5e7b3',
          'vineyard', '#d9e4ad',
          'park', '#c5e6bb',
          'recreation_ground', '#d0eabd',
          'meadow', '#dcebb4',
          'grass', '#d7eab8',
          'allotments', '#d1e5a9',
          'cemetery', '#cfe3c6',
          'nature_reserve', '#bfe0b7',
          'pitch', '#b8dfa9',
          'playground', '#d8e8aa',
          'sports_centre', '#c9e2ad',
          'stadium', '#c2dfa5',
          'track', '#d1e4ad',
          'golf_course', '#c4e2af',
          'residential', '#f1f0e8',
          'commercial', '#ece9df',
          'retail', '#f1e8d9',
          'industrial', '#e4e5e1',
          'brownfield', '#e4d9c4',
          '#edf0e8',
        ],
        'fill-opacity': 0.9,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water',
      paint: { 'fill-color': '#b9def1' },
    },
    {
      id: 'water-detail',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water_detail',
      paint: { 'fill-color': '#b9def1' },
    },
    {
      id: 'river-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'river_areas',
      paint: {
        'fill-color': '#b9def1',
        'fill-opacity': 0.96,
        'fill-outline-color': '#a4d2e8',
      },
    },
    {
      id: 'waterways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'waterways',
      paint: {
        'line-color': '#8fc9e7',
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
        'fill-color': '#e3e0d8',
        'fill-outline-color': '#c9c5bb',
        'fill-opacity': 0.9,
      },
    },
    {
      id: 'pedestrian-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'pedestrian_areas',
      paint: {
        'fill-color': '#eee5d3',
        'fill-outline-color': '#d7cbb6',
        'fill-opacity': 0.95,
      },
    },
    {
      id: 'aeroway-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'aeroway',
      paint: { 'fill-color': '#e5e4e0', 'fill-opacity': 0.9 },
    },
    {
      id: 'aeroway-lines',
      type: 'line',
      source: 'tampere',
      'source-layer': 'aeroway',
      paint: { 'line-color': '#cbc9c2', 'line-width': 2, 'line-opacity': 0.9 },
    },
    {
      id: 'power-lines',
      type: 'line',
      source: 'tampere',
      'source-layer': 'power',
      paint: { 'line-color': '#c1c0b8', 'line-width': 1.2, 'line-opacity': 0.55 },
    },
    {
      id: 'power-points',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'power',
      paint: { 'circle-color': '#c1c0b8', 'circle-radius': 1.5, 'circle-opacity': 0.55 },
    },
    {
      id: 'retaining-walls',
      type: 'line',
      source: 'tampere',
      'source-layer': 'barriers',
      filter: ['==', ['get', 'class'], 'retaining_wall'],
      paint: {
        'line-color': '#82796b',
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
      paint: { 'line-color': '#a9a28d', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.75 },
    },
    {
      id: 'railways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      filter: ['all', ['!', ['has', 'tunnel']], ['!', ['has', 'covered']]],
      paint: { 'line-color': '#a99aa8', 'line-width': 2, 'line-opacity': 0.8 },
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
        'line-color': ['case', ['has', 'cutting'], '#938675', '#a89572'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 9, 17, 14],
        'line-opacity': 0.4,
      },
    },
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
          ['has', 'cutting'], '#938675',
          '#a89572',
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
      filter: ['all', ['!', ['has', 'tunnel']], ['!', ['has', 'covered']]],
      paint: {
        'line-color': '#d3d8d5',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 10],
        'line-opacity': 0.85,
      },
    },
    {
      id: 'roads',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      filter: ['all', ['!', ['has', 'tunnel']], ['!', ['has', 'covered']]],
      paint: {
        'line-color': [
          'match',
          ['get', 'surface'],
          'gravel', '#d9c9a7',
          'unpaved', '#decda9',
          'dirt', '#cdb78a',
          'ground', '#cdb78a',
          'sand', '#ead39b',
          'cobblestone', '#eee1cb',
          'paving_stones', '#f5ead2',
          'concrete', '#f3eee5',
          '#fffdf7',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 7],
        'line-opacity': 0.95,
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
        'text-color': '#59645c',
        'text-halo-color': '#f4f6f2',
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
        'text-color': '#4f91ad',
        'text-halo-color': '#b9def1',
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
        'text-color': '#4f91ad',
        'text-halo-color': '#b9def1',
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
      ],
      paint: {
        'line-color': ['case', ['has', 'cutting'], '#938675', '#a89572'],
        'line-width': 3,
        'line-opacity': 0.4,
      },
    },
    {
      id: 'paths',
      type: 'line',
      source: 'tampere',
      'source-layer': 'paths',
      filter: ['all', ['!', ['has', 'tunnel']], ['!', ['has', 'covered']]],
      paint: {
        'line-color': [
          'match',
          ['get', 'surface'],
          'asphalt', '#8d9c84',
          'gravel', '#b89d70',
          'dirt', '#aa8759',
          'ground', '#aa8759',
          'sand', '#d2b878',
          '#91a989',
        ],
        'line-width': 1.4,
        'line-dasharray': [2, 2],
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
      maxPitch: 85,
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
