import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import {
  CARTOON_BUILDING_SHADOW_TRANSLATE,
  CARTOON_MAP_LIGHT_POSITION,
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_AZIMUTH_DEGREES,
} from './CartoonLighting';

export const OPENFREEMAP_SOURCE_ID = 'openfreemap';
export const MAPTERHORN_SOURCE_ID = 'terrain';
export const MAPTERHORN_DETAIL_SOURCE_ID = 'terrain-detail';

const browserLanguage = typeof navigator === 'undefined'
  ? 'en'
  : navigator.language.split('-')[0]?.toLowerCase();
const preferredNameKey = browserLanguage && /^[a-z]{2,3}$/.test(browserLanguage)
  ? `name:${browserLanguage}`
  : 'name';

const LOCALIZED_NAME: ExpressionSpecification = [
  'coalesce',
  ['get', preferredNameKey],
  ['get', 'name'],
  ['get', 'name:en'],
] as ExpressionSpecification;

const ROAD_CLASSES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service',
] as const;

const ROAD_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
] as ExpressionSpecification;

const OVERVIEW_ROAD_FILTER: ExpressionSpecification = [
  'all',
  ROAD_FILTER,
  ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
] as ExpressionSpecification;

const REGIONAL_ROAD_FILTER: ExpressionSpecification = [
  'all',
  ROAD_FILTER,
  ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
] as ExpressionSpecification;

const OVERVIEW_RAIL_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
] as ExpressionSpecification;

const SURFACE_ROAD_FILTER: ExpressionSpecification = [
  'all',
  ROAD_FILTER,
  ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
] as ExpressionSpecification;

const BRIDGE_AREA_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'Polygon'],
  ['==', ['get', 'brunnel'], 'bridge'],
] as ExpressionSpecification;

const PATH_BRIDGE_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', ['path', 'track', 'path_construction']]],
  ['==', ['get', 'brunnel'], 'bridge'],
] as ExpressionSpecification;

const PIER_AREA_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'Polygon'],
  ['==', ['get', 'class'], 'pier'],
] as ExpressionSpecification;

const PIER_LINE_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['==', ['get', 'class'], 'pier'],
] as ExpressionSpecification;

const ROAD_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'surface'], 'unpaved'], '#d0c7b6',
  [
    'match', ['get', 'class'],
    'motorway', '#b5bfbb',
    'trunk', '#b9c2be',
    'primary', '#bdc5c0',
    'secondary', '#c1c8c3',
    'tertiary', '#c5cbc5',
    'service', '#c9cec8',
    '#c6cbc6',
  ],
] as ExpressionSpecification;

const BRIDGE_ROAD_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'surface'], 'unpaved'], '#bbb2a4',
  [
    'match', ['get', 'class'],
    'motorway', '#b7c1bd',
    'trunk', '#b8c2be',
    'primary', '#b9c3be',
    'secondary', '#bbc5c0',
    'tertiary', '#bec7c1',
    'service', '#c2c9c3',
    '#bbc4bf',
  ],
] as ExpressionSpecification;

const ROAD_SORT_KEY: ExpressionSpecification = [
  '+',
  ['coalesce', ['get', 'layer'], 0],
  [
    'match', ['get', 'class'],
    'motorway', 0.9,
    'trunk', 0.8,
    'primary', 0.7,
    'secondary', 0.6,
    'tertiary', 0.5,
    'minor', 0.4,
    0.3,
  ],
] as ExpressionSpecification;

export const GLOBAL_ROAD_CASING_LAYER_IDS = [
  'global-road-tunnel-casing',
  'global-road-casing',
  'global-road-bridge-shadow',
  'global-road-bridge-casing',
];

export const GLOBAL_ROAD_LAYER_IDS = [
  'global-road-tunnels',
  'global-roads',
  'global-road-bridges',
];

const GLOBAL_BUILDING_DETAIL_START_ZOOM = 16.5;
const GLOBAL_BUILDING_DETAIL_FULL_ZOOM = 17.5;
const GLOBAL_BUILDING_MAX_ESTIMATED_STORIES = 34;
const GLOBAL_BUILDING_MIN_MARKED_HEIGHT_METRES = 6;
const GLOBAL_BUILDING_MAX_MARKED_HEIGHT_METRES = 100;
const GLOBAL_BUILDING_DETAIL_BAND_HEIGHT_METRES = 0.4;
const GLOBAL_BUILDING_ROOF_RIM_HEIGHT_METRES = 0.08;
const GLOBAL_BUILDING_ROOF_CAP_HEIGHT_METRES = 0.32;
const GLOBAL_MAP_SUN_COLOR = '#fffdf9';

export const GLOBAL_BUILDING_FACADE_LAYER_IDS = [
  'global-building-ground-storeys',
  'global-building-lower-facades',
  'global-building-lower-detail-bands',
  'global-building-middle-facades',
  'global-building-upper-detail-bands',
  'global-building-upper-facades',
];

export const GLOBAL_BUILDING_ROOF_LAYER_IDS = [
  'global-building-roof-rims',
  'global-building-roof-caps',
];

export const GLOBAL_BUILDING_LAYER_IDS = [
  'global-building-footprints',
  'global-buildings',
  ...GLOBAL_BUILDING_FACADE_LAYER_IDS,
  ...GLOBAL_BUILDING_ROOF_LAYER_IDS,
];

const TAGGED_BUILDING_COLOR: ExpressionSpecification = [
  'match', ['downcase', ['to-string', ['coalesce', ['get', 'colour'], ['get', 'color'], '']]],
  'black', '#a3a8a5',
  'red', '#d2ada8',
  'green', '#c4cec0',
  'blue', '#b3cfdb',
  'brown', '#c8b6a5',
  'beige', '#dfd0ad',
  'orange', '#dfb18a',
  'pink', '#ddb5bd',
  'maroon', '#b99396',
  'silver', '#c7ccca',
  'yellow', '#dfcb91',
  'white', '#f1f2ed',
  'lightgray', '#d7dcda',
  'lightgrey', '#d7dcda',
  'grey', '#d6dbd8',
  'gray', '#d6dbd8',
  '#e3e6e1',
] as ExpressionSpecification;

// Temporary visual experiment: keep the building material system and facade
// depth, but remove source-specific building colors so we can judge the map's
// hierarchy and lighting independently of landmark colors.
const SHOW_SOURCE_BUILDING_COLORS = false;

const GLOBAL_BUILDING_SOURCE_COLOR: ExpressionSpecification = [
  'case',
  ['any', ['has', 'colour'], ['has', 'color']],
  TAGGED_BUILDING_COLOR,
  '#efefeb',
] as ExpressionSpecification;

const GLOBAL_BUILDING_COLOR: ExpressionSpecification = [
  'case',
  SHOW_SOURCE_BUILDING_COLORS,
  ['coalesce', ['feature-state', 'pastelBuildingColor'], GLOBAL_BUILDING_SOURCE_COLOR],
  '#efefeb',
] as ExpressionSpecification;

const GLOBAL_BUILDING_SOURCE_COLOR_ALT: ExpressionSpecification = [
  'case',
  ['any', ['has', 'colour'], ['has', 'color']],
  TAGGED_BUILDING_COLOR,
  '#dedfda',
] as ExpressionSpecification;

const GLOBAL_BUILDING_COLOR_ALT: ExpressionSpecification = [
  'case',
  SHOW_SOURCE_BUILDING_COLORS,
  ['coalesce', ['feature-state', 'pastelBuildingColorAlt'], GLOBAL_BUILDING_SOURCE_COLOR_ALT],
  '#dedfda',
] as ExpressionSpecification;

const GLOBAL_BUILDING_DETAIL_BAND_SOURCE_COLOR: ExpressionSpecification = [
  'case',
  ['any', ['has', 'colour'], ['has', 'color']],
  [
    'interpolate', ['linear'], 0.16,
    0, TAGGED_BUILDING_COLOR,
    1, '#87918e',
  ],
  '#d1d5d2',
] as ExpressionSpecification;

const GLOBAL_BUILDING_DETAIL_BAND_COLOR: ExpressionSpecification = [
  'case',
  SHOW_SOURCE_BUILDING_COLORS,
  ['coalesce', ['feature-state', 'pastelBuildingBandColor'], GLOBAL_BUILDING_DETAIL_BAND_SOURCE_COLOR],
  '#d1d5d2',
] as ExpressionSpecification;

const GLOBAL_BUILDING_ROOF_COLOR = '#aab3af';
const GLOBAL_BUILDING_ROOF_RIM_COLOR = '#8f9995';

const GLOBAL_BUILDING_BASE: ExpressionSpecification = [
  'coalesce', ['get', 'render_min_height'], 0,
] as ExpressionSpecification;

const GLOBAL_BUILDING_HEIGHT: ExpressionSpecification = [
  'coalesce', ['get', 'render_height'], 6,
] as ExpressionSpecification;

const GLOBAL_BUILDING_BODY_HEIGHT: ExpressionSpecification = [
  'max', 0, ['-', GLOBAL_BUILDING_HEIGHT, GLOBAL_BUILDING_BASE],
] as ExpressionSpecification;

function animatedBuildingHeight(height: ExpressionSpecification): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    13, GLOBAL_BUILDING_BASE,
    13.6, height,
  ] as ExpressionSpecification;
}

const GLOBAL_ESTIMATED_BUILDING_STORIES: ExpressionSpecification = [
  'min',
  GLOBAL_BUILDING_MAX_ESTIMATED_STORIES,
  ['max', 1, ['round', ['/', GLOBAL_BUILDING_BODY_HEIGHT, 3]]],
] as ExpressionSpecification;

const GLOBAL_BUILDING_STORY_HEIGHT: ExpressionSpecification = [
  '/', GLOBAL_BUILDING_BODY_HEIGHT, GLOBAL_ESTIMATED_BUILDING_STORIES,
] as ExpressionSpecification;

function buildingStoryTop(storyCount: number): ExpressionSpecification {
  return [
    'min',
    GLOBAL_BUILDING_HEIGHT,
    [
      '+',
      GLOBAL_BUILDING_BASE,
      ['*', GLOBAL_BUILDING_STORY_HEIGHT, storyCount],
    ],
  ] as ExpressionSpecification;
}

const GLOBAL_BUILDING_FIRST_STORY_TOP = buildingStoryTop(1);
const GLOBAL_BUILDING_SECOND_STORY_TOP = buildingStoryTop(2);
const GLOBAL_BUILDING_FIFTH_STORY_TOP = buildingStoryTop(5);
const GLOBAL_BUILDING_LOWER_BAND_BASE: ExpressionSpecification = [
  'max',
  GLOBAL_BUILDING_FIRST_STORY_TOP,
  ['-', GLOBAL_BUILDING_SECOND_STORY_TOP, GLOBAL_BUILDING_DETAIL_BAND_HEIGHT_METRES],
] as ExpressionSpecification;
const GLOBAL_BUILDING_UPPER_BAND_BASE: ExpressionSpecification = [
  'max',
  buildingStoryTop(4),
  ['-', GLOBAL_BUILDING_FIFTH_STORY_TOP, GLOBAL_BUILDING_DETAIL_BAND_HEIGHT_METRES],
] as ExpressionSpecification;

const GLOBAL_BUILDING_GROUND_COLOR: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  GLOBAL_BUILDING_DETAIL_START_ZOOM, GLOBAL_BUILDING_COLOR,
  GLOBAL_BUILDING_DETAIL_FULL_ZOOM, GLOBAL_BUILDING_COLOR_ALT,
] as ExpressionSpecification;

const GLOBAL_BUILDING_BAND_COLOR: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  GLOBAL_BUILDING_DETAIL_START_ZOOM, GLOBAL_BUILDING_COLOR,
  GLOBAL_BUILDING_DETAIL_FULL_ZOOM, GLOBAL_BUILDING_DETAIL_BAND_COLOR,
] as ExpressionSpecification;

function globalBuildingFacadeLayer(
  id: string,
  base: ExpressionSpecification,
  height: ExpressionSpecification,
  color: ExpressionSpecification,
  minimumStories: number,
): FillExtrusionLayerSpecification {
  return {
    id,
    type: 'fill-extrusion',
    source: OPENFREEMAP_SOURCE_ID,
    'source-layer': 'building',
    minzoom: 13,
    filter: [
      'all',
      ['!', ['==', ['get', 'hide_3d'], true]],
      ['>=', GLOBAL_BUILDING_BODY_HEIGHT, GLOBAL_BUILDING_MIN_MARKED_HEIGHT_METRES],
      ['<=', GLOBAL_BUILDING_HEIGHT, GLOBAL_BUILDING_MAX_MARKED_HEIGHT_METRES],
      ['>=', GLOBAL_ESTIMATED_BUILDING_STORIES, minimumStories],
    ],
    paint: {
      'fill-extrusion-color': color,
      'fill-extrusion-height': animatedBuildingHeight(height),
      'fill-extrusion-base': animatedBuildingHeight(base),
      'fill-extrusion-opacity': [
        'interpolate', ['linear'], ['zoom'],
        13, 0,
        13.45, 0.96,
        18, 1,
      ],
      'fill-extrusion-vertical-gradient': true,
    },
  };
}

function globalBuildingFacadeLayers(): FillExtrusionLayerSpecification[] {
  const middleFacadeTop: ExpressionSpecification = [
    'case',
    ['>=', GLOBAL_ESTIMATED_BUILDING_STORIES, 5],
    GLOBAL_BUILDING_UPPER_BAND_BASE,
    GLOBAL_BUILDING_HEIGHT,
  ];

  return [
    globalBuildingFacadeLayer(
      GLOBAL_BUILDING_FACADE_LAYER_IDS[0],
      GLOBAL_BUILDING_BASE,
      GLOBAL_BUILDING_FIRST_STORY_TOP,
      GLOBAL_BUILDING_GROUND_COLOR,
      1,
    ),
    globalBuildingFacadeLayer(
      GLOBAL_BUILDING_FACADE_LAYER_IDS[1],
      GLOBAL_BUILDING_FIRST_STORY_TOP,
      middleFacadeTop,
      GLOBAL_BUILDING_COLOR,
      2,
    ),
    globalBuildingFacadeLayer(
      GLOBAL_BUILDING_FACADE_LAYER_IDS[4],
      GLOBAL_BUILDING_UPPER_BAND_BASE,
      GLOBAL_BUILDING_FIFTH_STORY_TOP,
      GLOBAL_BUILDING_BAND_COLOR,
      5,
    ),
    globalBuildingFacadeLayer(
      GLOBAL_BUILDING_FACADE_LAYER_IDS[5],
      GLOBAL_BUILDING_FIFTH_STORY_TOP,
      GLOBAL_BUILDING_HEIGHT,
      GLOBAL_BUILDING_COLOR,
      6,
    ),
  ];
}

const ESTIMATED_ROAD_WIDTH_METRES: ExpressionSpecification = [
  'case',
  ['==', ['get', 'ramp'], 1],
  [
    'match', ['get', 'class'],
    'motorway', 7.5,
    'trunk', 7,
    'primary', 6.5,
    'secondary', 6,
    'tertiary', 5.5,
    5,
  ],
  ['==', ['get', 'class'], 'service'],
  [
    'match', ['get', 'service'],
    'parking_aisle', 3,
    'driveway', 3.2,
    'alley', 3.2,
    'crossover', 3.5,
    4,
  ],
  [
    'match', ['get', 'class'],
    // Divided highways are normally encoded as one centerline per
    // carriageway, so using the full combined-road width overstates them at
    // close zooms. Allow roughly two lanes plus shoulders per line instead.
    'motorway', 10.5,
    'trunk', 9.5,
    'primary', 9,
    'secondary', 8,
    'tertiary', 7,
    'minor', 5.5,
    5,
  ],
] as ExpressionSpecification;

function pixelsPerMetre(zoom: number, latitude: number) {
  const safeLatitude = Math.max(-80, Math.min(80, latitude));
  const groundCircumference = 40_075_016.686 * Math.cos(safeLatitude * Math.PI / 180);
  return (512 * 2 ** zoom) / groundCircumference;
}

export function roadWidthExpression(
  latitude: number,
  casing = false,
): ExpressionSpecification {
  const widthMetres: ExpressionSpecification = casing
    ? ['+', ESTIMATED_ROAD_WIDTH_METRES, 1]
    : ESTIMATED_ROAD_WIDTH_METRES;

  return [
    'interpolate', ['exponential', 2], ['zoom'],
    6, ['max', casing ? 0.65 : 0.4, ['*', widthMetres, pixelsPerMetre(6, latitude)]],
    10, ['max', casing ? 0.8 : 0.5, ['*', widthMetres, pixelsPerMetre(10, latitude)]],
    12, ['max', casing ? 1 : 0.6, ['*', widthMetres, pixelsPerMetre(12, latitude)]],
    14, ['*', widthMetres, pixelsPerMetre(14, latitude)],
    16, ['*', widthMetres, pixelsPerMetre(16, latitude)],
    // Damp the closest view slightly so wide motorways do not dominate a
    // highly pitched scene while retaining approximately physical scaling.
    18, ['*', widthMetres, pixelsPerMetre(18, latitude) * 0.82],
  ] as ExpressionSpecification;
}

export const GLOBAL_MAP_STYLE: StyleSpecification = {
  version: 8,
  name: 'Global OpenFreeMap with Mapterhorn terrain',
  projection: { type: 'globe' },
  sky: {
    'atmosphere-blend': [
      'interpolate', ['linear'], ['zoom'],
      0, 0.8,
      5, 0.65,
      7, 0,
    ],
  },
  light: {
    // The Three.js model layers derive their sun from these same shared
    // constants, keeping low-poly facets and building walls coherent.
    anchor: 'map',
    position: CARTOON_MAP_LIGHT_POSITION,
    color: GLOBAL_MAP_SUN_COLOR,
    intensity: 0.22,
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    [OPENFREEMAP_SOURCE_ID]: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    [MAPTERHORN_SOURCE_ID]: {
      type: 'raster-dem',
      url: 'https://tiles.mapterhorn.com/tilejson.json',
      // Mapterhorn publishes 512px WebP elevation tiles using Mapzen's
      // Terrarium RGB encoding. Declaring both values here also documents the
      // contract if the TileJSON source is later replaced with our own URL.
      tileSize: 512,
      encoding: 'terrarium',
      // Mapterhorn guarantees full-planet coverage through z12. The runtime
      // probes the visible area before installing a separate z13+ source;
      // keeping this source capped makes the fallback deterministic.
      maxzoom: 12,
      attribution: '<a href="https://mapterhorn.com/attribution/">© Mapterhorn terrain data</a>',
    },
  },
  layers: [
    {
      id: 'global-background',
      type: 'background',
      // OpenMapTiles represents the ocean as water polygons and leaves the
      // land mass implicit. A green base therefore gives every continent a
      // continuous natural surface, including low zooms with sparse landcover.
      paint: { 'background-color': '#b8d3aa' },
    },
    {
      id: 'global-major-highway-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 2,
      maxzoom: 13,
      filter: [
        'all',
        ROAD_FILTER,
        ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ROAD_SORT_KEY },
      paint: {
        'line-color': '#5e7b76',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          2, ['match', ['get', 'class'], 'motorway', 2.8, 2.35],
          5, ['match', ['get', 'class'], 'motorway', 4.1, 3.55],
          9, ['match', ['get', 'class'], 'motorway', 5.3, 4.7],
          13, ['match', ['get', 'class'], 'motorway', 6.1, 5.5],
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          2, 0.48,
          5, 0.56,
          9, 0.62,
          13, 0.68,
        ],
      },
    },
    {
      id: 'global-regional-road-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 2,
      maxzoom: 7,
      filter: REGIONAL_ROAD_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#72857d',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          2, ['match', ['get', 'class'], 'motorway', 2.2, 'trunk', 1.95, 'primary', 1.7, 1.45],
          5, ['match', ['get', 'class'], 'motorway', 3.1, 'trunk', 2.8, 'primary', 2.45, 2],
          7, ['match', ['get', 'class'], 'motorway', 4.1, 'trunk', 3.6, 'primary', 3.1, 2.55],
        ],
        'line-opacity': 0.68,
      },
    },
    {
      id: 'global-regional-roads',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 2,
      maxzoom: 7,
      filter: REGIONAL_ROAD_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'motorway', '#b7c6bf',
          'trunk', '#bbc9c2',
          'primary', '#c0cdc5',
          'secondary', '#c5d1c9',
          '#cad5cd',
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          2, ['match', ['get', 'class'], 'motorway', 1.4, 'trunk', 1.15, 'primary', 1, 0.76],
          5, ['match', ['get', 'class'], 'motorway', 2.3, 'trunk', 2, 'primary', 1.6, 1.2],
          7, ['match', ['get', 'class'], 'motorway', 3.1, 'trunk', 2.6, 'primary', 2.1, 1.6],
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          2, 0.9,
          5, 0.94,
          7, 0.96,
        ],
      },
    },
    {
      id: 'global-landcover',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'landcover',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'subclass'], 'park'], '#c1d1a6',
          ['in', ['get', 'subclass'], ['literal', ['scrub', 'shrubbery', 'heath']]], '#c8d3b2',
          ['in', ['get', 'subclass'], ['literal', ['orchard', 'plant_nursery']]], '#d0d9b4',
          ['==', ['get', 'subclass'], 'vineyard'], '#d4d5a2',
          ['in', ['get', 'subclass'], ['literal', ['garden', 'flowerbed']]], '#c5dda8',
          ['in', ['get', 'subclass'], ['literal', ['meadow', 'grassland', 'village_green']]], '#c8dea8',
          [
            'match', ['get', 'class'],
            'wood', '#b7c9a6',
            'grass', '#c4d5ae',
            'farmland', '#edf0bb',
            'wetland', '#c6d9ad',
            'sand', '#f4dfa7',
            'rock', '#e5e3dd',
            'ice', '#e7f3f5',
            '#b8d3aa',
          ],
        ],
        'fill-opacity': 0.96,
      },
    },
    {
      id: 'global-protected-areas',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'park',
      filter: [
        'in',
        ['get', 'class'],
        ['literal', [
          'UNESCO Global Geopark',
          'nature_reserve', 'national_park', 'protected_area', 'landscape_protection',
        ]],
      ],
      paint: {
        // A regional nature-park boundary should provide context without
        // repainting residential or industrial landuse green.
        'fill-color': '#b8cfaa',
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          2, 0.14,
          5, 0.1,
          9, 0.06,
          13, 0.035,
        ],
      },
    },
    {
      id: 'global-landuse',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'landuse',
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'residential', '#cbd4c6',
          'commercial', '#c7d0ce',
          'retail', '#d8d1bc',
          'industrial', '#b8c7c7',
          'military', '#c1c7a5',
          'cemetery', '#c2d9b5',
          'school', '#eadfbd',
          'kindergarten', '#eadfbd',
          'education', '#eadfbd',
          'university', '#d9dfc6',
          'college', '#d9dfc6',
          'hospital', '#d9ddd6',
          'parking', '#dad8d2',
          'park', '#c1d1a6',
          'garden', '#aad68a',
          'allotments', '#c8dca9',
          'orchard', '#c5d79a',
          'vineyard', '#d4d5a2',
          'farmland', '#e4e2ad',
          'farmyard', '#ddd3ad',
          'quarry', '#cbc9c2',
          'pitch', '#add38e',
          'playground', '#d6df9d',
          'stadium', '#d2e7b9',
          'railway', '#c9d0cf',
          '#e8ece5',
        ],
        'fill-opacity': 0.96,
      },
    },
    {
      id: 'global-parks',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'park',
      filter: [
        '!',
        ['in', ['get', 'class'], ['literal', [
          'UNESCO Global Geopark',
          'nature_reserve', 'national_park', 'protected_area', 'landscape_protection',
        ]]],
      ],
      paint: {
        'fill-color': '#c1d1a6',
        'fill-opacity': 0.96,
      },
    },
    {
      id: 'global-aeroway-areas',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'runway', '#b7b9b5',
          'taxiway', '#c7c9c3',
          'apron', '#d4d5cf',
          'helipad', '#c5c9c4',
          '#d7d9d3',
        ],
        'fill-opacity': 0.92,
      },
    },
    {
      id: 'global-aeroway-lines',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'runway', '#9ea29f',
          'taxiway', '#b5b9b5',
          '#c1c4bf',
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, ['match', ['get', 'class'], 'runway', 2, 0.8],
          16, ['match', ['get', 'class'], 'runway', 18, 'taxiway', 7, 3],
        ],
      },
    },
    {
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: MAPTERHORN_SOURCE_ID,
      layout: { visibility: 'visible' },
      paint: {
        'hillshade-exaggeration': 0.36,
        'hillshade-illumination-direction': CARTOON_SUN_AZIMUTH_DEGREES,
        'hillshade-illumination-anchor': 'map',
        'hillshade-shadow-color': '#5e6c65',
        'hillshade-highlight-color': '#fff9ea',
        'hillshade-accent-color': '#9eaaa2',
      },
    },
    {
      id: 'global-waterway',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'waterway',
      paint: {
        'line-color': '#8fb8c3',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 16, 3],
      },
    },
    {
      id: 'global-water-edge-shade',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'water',
      paint: {
        'fill-color': '#91b4be',
        'fill-translate': [
          'interpolate', ['linear'], ['zoom'],
          0, ['literal', [0.4, -0.4]],
          18, ['literal', [2.5, -2.5]],
        ],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.1,
      },
    },
    {
      id: 'global-water',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'water',
      paint: { 'fill-color': '#91bac5' },
    },
    {
      id: 'global-pedestrian-areas',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: [
        'all',
        ['==', ['geometry-type'], 'Polygon'],
        ['in', ['get', 'subclass'], ['literal', ['pedestrian', 'platform']]],
      ],
      paint: { 'fill-color': '#e5dfd4', 'fill-opacity': 0.9 },
    },
    {
      id: 'global-pier-area-shadow',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: PIER_AREA_FILTER,
      paint: {
        'fill-color': CARTOON_SHADOW_COLOR,
        'fill-translate': [2, -2],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.22,
      },
    },
    {
      id: 'global-pier-areas',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: PIER_AREA_FILTER,
      paint: {
        'fill-color': '#d8d1bf',
        'fill-opacity': 0.98,
      },
    },
    {
      id: 'global-pier-area-edge',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: PIER_AREA_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#87938d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 18, 1.6],
        'line-opacity': 0.72,
      },
    },
    {
      id: 'global-pier-line-shadow',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: PIER_LINE_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 18, 8],
        'line-translate': [1.5, -1.5],
        'line-translate-anchor': 'map',
        'line-blur': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 1.1],
        'line-opacity': 0.22,
      },
    },
    {
      id: 'global-pier-line-edge',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: PIER_LINE_FILTER,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#87938d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.8, 18, 5.8],
        'line-opacity': 0.74,
      },
    },
    {
      id: 'global-pier-lines',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: PIER_LINE_FILTER,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#d8d1bf',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 5.4],
      },
    },
    {
      id: 'global-bridge-deck-shadow',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: BRIDGE_AREA_FILTER,
      paint: {
        'fill-color': CARTOON_SHADOW_COLOR,
        'fill-translate': [3, -3],
        'fill-translate-anchor': 'map',
        'fill-opacity': 0.26,
      },
    },
    {
      id: 'global-bridge-decks',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: BRIDGE_AREA_FILTER,
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'rail', '#c8ceca',
          'transit', '#c8ceca',
          'path', '#ded9cd',
          '#d8dad4',
        ],
        'fill-opacity': 0.98,
      },
    },
    {
      id: 'global-road-tunnel-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'tunnel']],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        // Rounded casing under the butt-ended road exposes a short dark cap at
        // either endpoint, reading as a simple portal without point data.
        'line-color': '#46514d',
        'line-width': roadWidthExpression(61.4981, true),
        'line-opacity': 0.62,
      },
    },
    {
      id: 'global-road-tunnels',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'tunnel']],
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': ROAD_COLOR,
        'line-width': roadWidthExpression(61.4981),
        'line-dasharray': [2.2, 1.6],
        'line-opacity': 0.56,
      },
    },
    {
      id: 'global-overview-road-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 3,
      maxzoom: 13,
      filter: OVERVIEW_ROAD_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#71837b',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          3, ['match', ['get', 'class'], 'motorway', 2.55, 'trunk', 2.2, 'primary', 1.9, 1.55],
          6, ['match', ['get', 'class'], 'motorway', 3.6, 'trunk', 3.2, 'primary', 2.7, 2.25],
          10, ['match', ['get', 'class'], 'motorway', 4.9, 'trunk', 4.45, 'primary', 3.95, 3.35],
          13, ['match', ['get', 'class'], 'motorway', 5.7, 'trunk', 5.25, 'primary', 4.65, 4.1],
        ],
        'line-opacity': 0.68,
      },
    },
    {
      id: 'global-overview-roads',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 3,
      maxzoom: 13,
      filter: OVERVIEW_ROAD_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'motorway', '#b6c5be',
          'trunk', '#bac8c1',
          'primary', '#bfccc4',
          'secondary', '#c4d0c8',
          '#c9d4cc',
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          3, ['match', ['get', 'class'], 'motorway', 1.65, 'trunk', 1.3, 'primary', 1.05, 0.8],
          6, ['match', ['get', 'class'], 'motorway', 2.5, 'trunk', 2.1, 'primary', 1.65, 1.3],
          10, ['match', ['get', 'class'], 'motorway', 3.7, 'trunk', 3.3, 'primary', 2.85, 2.45],
          13, ['match', ['get', 'class'], 'motorway', 4.5, 'trunk', 4.1, 'primary', 3.6, 3.1],
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          3, 0.9,
          6, 0.95,
          10, 0.98,
          13, 1,
        ],
      },
    },
    {
      id: 'global-road-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: SURFACE_ROAD_FILTER,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': '#788780',
        'line-width': roadWidthExpression(61.4981, true),
        'line-opacity': 0.78,
      },
    },
    {
      id: 'global-roads',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: SURFACE_ROAD_FILTER,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': ROAD_COLOR,
        'line-width': roadWidthExpression(61.4981),
        'line-opacity': 0.98,
      },
    },
    {
      id: 'global-road-bridge-shadow',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'bridge']],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': roadWidthExpression(61.4981, true),
        'line-translate': [2, -2],
        'line-translate-anchor': 'map',
        'line-blur': 1.4,
        'line-opacity': 0.25,
      },
    },
    {
      id: 'global-road-bridge-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'bridge']],
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        // A dark deck rim separates the bridge from the road or water below.
        'line-color': '#87918d',
        'line-width': roadWidthExpression(61.4981, true),
        'line-opacity': 0.84,
      },
    },
    {
      id: 'global-road-bridges',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      filter: ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'bridge']],
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': BRIDGE_ROAD_COLOR,
        'line-width': roadWidthExpression(61.4981),
      },
    },
    {
      id: 'global-road-center-markings',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 15,
      filter: [
        'all',
        ROAD_FILTER,
        ['!', ['==', ['get', 'brunnel'], 'tunnel']],
        ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
        ['!', ['in', ['get', 'surface'], ['literal', ['unpaved', 'gravel', 'dirt', 'ground', 'sand']]]],
      ],
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': '#c7ccc8',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          15, 0.5,
          18, 0.95,
        ],
        'line-dasharray': [3, 4],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          15, 0,
          15.8, 0.4,
          18, 0.52,
        ],
      },
    },
    {
      id: 'global-path-bridge-shadow',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: PATH_BRIDGE_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.6, 18, 7],
        'line-translate': [1.5, -1.5],
        'line-translate-anchor': 'map',
        'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 18, 1.2],
        'line-opacity': 0.2,
      },
    },
    {
      id: 'global-path-bridge-edge',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: PATH_BRIDGE_FILTER,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#87918d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 18, 6.2],
        'line-opacity': 0.84,
      },
    },
    {
      id: 'global-path-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['in', ['get', 'class'], ['literal', ['path', 'track']]],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#d8d4ca',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.3, 18, 4.1],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.42],
      },
    },
    {
      id: 'global-cycleway-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['==', ['get', 'class'], 'path'],
        ['==', ['get', 'subclass'], 'cycleway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f3f0e9',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.35, 18, 5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.66],
      },
    },
    {
      id: 'global-tracks',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['==', ['get', 'class'], 'track'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'surface'],
          'paved', '#9ca4a1',
          'unpaved', '#a99578',
          '#a99c86',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.65, 18, 3],
        'line-dasharray': [2.5, 1.4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.56],
      },
    },
    {
      id: 'global-cycleways',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['==', ['get', 'class'], 'path'],
        ['==', ['get', 'subclass'], 'cycleway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#b99a91',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 3.8],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.76],
      },
    },
    {
      id: 'global-footways',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['==', ['get', 'class'], 'path'],
        ['in', ['get', 'subclass'], ['literal', ['footway', 'pedestrian', 'path', 'platform', 'corridor', 'bridleway']]],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'surface'],
          'paved', '#9ca4a1',
          'unpaved', '#a99578',
          '#a99c86',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 18, 2.65],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.52],
      },
    },
    {
      id: 'global-steps',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: [
        'all',
        ['==', ['get', 'class'], 'path'],
        ['==', ['get', 'subclass'], 'steps'],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#968a78',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, 4],
        'line-dasharray': [0.45, 0.55],
      },
    },
    {
      id: 'global-other-paths',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['==', ['get', 'class'], 'path'],
        ['!', ['in', ['get', 'subclass'], ['literal', ['cycleway', 'footway', 'pedestrian', 'path', 'platform', 'corridor', 'bridleway', 'steps']]]],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#a99c86',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 18, 2.5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.5],
      },
    },
    {
      id: 'global-paths-under-construction',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['==', ['get', 'class'], 'path_construction'],
      paint: {
        'line-color': '#b5a997',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 18, 2.5],
        'line-dasharray': [1.5, 1.5],
        'line-opacity': 0.46,
      },
    },
    {
      id: 'global-bridge-deck-edge',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: BRIDGE_AREA_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#a3aaa6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 18, 1.8],
        'line-opacity': 0.6,
      },
    },
    {
      id: 'global-railway-tunnel-portals',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        ['==', ['get', 'brunnel'], 'tunnel'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#46514d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 18, 5],
        'line-opacity': 0.62,
      },
    },
    {
      id: 'global-railway-tunnels',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        ['==', ['get', 'brunnel'], 'tunnel'],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'transit', '#909a9d',
          '#909a9d',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 18, 2.2],
        'line-dasharray': [2, 2],
        'line-opacity': 0.5,
      },
    },
    {
      id: 'global-overview-railways',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 3,
      maxzoom: 12,
      filter: OVERVIEW_RAIL_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#7f898b',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          3, 1,
          6, 1.35,
          8, 1.8,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          3, 0.78,
          6, 0.86,
          8, 0.9,
        ],
      },
    },
    {
      id: 'global-railway-bed',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 7,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'transit', '#c0c5c2',
          '#c0c5c2',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 14, 2.4, 18, 8],
        'line-opacity': 0.82,
      },
    },
    {
      id: 'global-railway-sleepers',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 15,
      filter: [
        'all',
        ['==', ['get', 'class'], 'rail'],
        ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#e7ebe7',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.4, 18, 9],
        'line-dasharray': [0.18, 1.15],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          15, 0,
          16.5, 0.56,
          18, 0.7,
        ],
      },
    },
    {
      id: 'global-railways',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 8,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
      ],
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'transit', '#828c8d',
          '#828c8d',
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          11, 0.5,
          18, ['match', ['get', 'class'], 'transit', 1.8, 1.4],
        ],
        'line-opacity': ['match', ['get', 'class'], 'transit', 0.9, 0.86],
      },
    },
    {
      id: 'global-railway-bridge-shadow',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        ['==', ['get', 'brunnel'], 'bridge'],
      ],
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 18, 10],
        'line-translate': [2, -2],
        'line-translate-anchor': 'map',
        'line-blur': 1.2,
        'line-opacity': 0.23,
      },
    },
    {
      id: 'global-railway-bridge-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        ['==', ['get', 'brunnel'], 'bridge'],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#87918d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 18, 6],
        'line-opacity': 0.84,
      },
    },
    {
      id: 'global-railway-bridges',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: [
        'all',
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        ['==', ['get', 'brunnel'], 'bridge'],
      ],
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'transit', '#d0d5d1',
          '#d0d5d1',
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          9, 0.8,
          18, ['match', ['get', 'class'], 'transit', 2.6, 2.2],
        ],
      },
    },
    {
      id: 'global-boundaries',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'boundary',
      filter: ['!', ['==', ['get', 'maritime'], 1]],
      paint: {
        'line-color': '#8ea097',
        'line-width': [
          'match', ['get', 'admin_level'],
          2, 1.2,
          4, 0.8,
          0.5,
        ],
        'line-dasharray': [3, 2],
        'line-opacity': 0.7,
      },
    },
    {
      id: 'global-building-footprints',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 14,
      maxzoom: 13.75,
      paint: {
        'fill-color': GLOBAL_BUILDING_COLOR,
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.78,
          13.45, 0.5,
          13.75, 0,
        ],
        'fill-outline-color': '#b5bdb8',
      },
    },
    {
      id: 'global-building-shadow',
      // Keep the shadow on the footprint boundary so it reads as ambient
      // occlusion without overlapping the real extrusion at a pitched camera.
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      filter: ['!', ['==', ['get', 'hide_3d'], true]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, 2.4,
          15, 5.4,
          18, 10,
        ],
        'line-translate': CARTOON_BUILDING_SHADOW_TRANSLATE,
        'line-translate-anchor': 'map',
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          13, 1,
          18, 2.4,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.5, 0.14,
          18, 0.29,
        ],
      },
    },
    {
      id: 'global-building-contact-shadow',
      // A compact ambient-occlusion cue at the wall/ground seam gives the
      // pastel extrusions weight without needing another 3D shadow volume.
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      filter: [
        'all',
        ['!', ['==', ['get', 'hide_3d'], true]],
        ['<=', GLOBAL_BUILDING_BASE, 0.5],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          13, 1.3,
          15, 2.8,
          18, 5.2,
        ],
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.55,
          18, 1.2,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.45, 0.25,
          18, 0.48,
        ],
      },
    },
    {
      id: 'global-buildings',
      type: 'fill-extrusion',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      // Ordinary buildings use the story slices below at every zoom. Keeping
      // this single extrusion exclusive to unbanded structures prevents the
      // coplanar surfaces that caused flickering during the former LOD blend.
      filter: [
        'all',
        ['!', ['==', ['get', 'hide_3d'], true]],
        [
          'any',
          ['<', GLOBAL_BUILDING_BODY_HEIGHT, GLOBAL_BUILDING_MIN_MARKED_HEIGHT_METRES],
          ['>', GLOBAL_BUILDING_HEIGHT, GLOBAL_BUILDING_MAX_MARKED_HEIGHT_METRES],
        ],
      ],
      paint: {
        'fill-extrusion-color': GLOBAL_BUILDING_COLOR,
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          13, GLOBAL_BUILDING_BASE,
          13.6, GLOBAL_BUILDING_HEIGHT,
        ],
        'fill-extrusion-base': GLOBAL_BUILDING_BASE,
        'fill-extrusion-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.45, 0.96,
          18, 1,
        ],
        'fill-extrusion-vertical-gradient': true,
      },
    },
    ...globalBuildingFacadeLayers(),
    {
      id: 'global-building-roof-rims',
      type: 'fill-extrusion',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      filter: ['!', ['==', ['get', 'hide_3d'], true]],
      paint: {
        'fill-extrusion-color': GLOBAL_BUILDING_ROOF_RIM_COLOR,
        'fill-extrusion-base': animatedBuildingHeight(GLOBAL_BUILDING_HEIGHT),
        'fill-extrusion-height': animatedBuildingHeight([
          '+', GLOBAL_BUILDING_HEIGHT, GLOBAL_BUILDING_ROOF_RIM_HEIGHT_METRES,
        ] as ExpressionSpecification),
        'fill-extrusion-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.45, 0.94,
          18, 0.98,
        ],
        'fill-extrusion-vertical-gradient': false,
      },
    },
    {
      id: 'global-building-roof-caps',
      type: 'fill-extrusion',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      filter: ['!', ['==', ['get', 'hide_3d'], true]],
      paint: {
        'fill-extrusion-color': GLOBAL_BUILDING_ROOF_COLOR,
        'fill-extrusion-base': animatedBuildingHeight([
          '+', GLOBAL_BUILDING_HEIGHT, GLOBAL_BUILDING_ROOF_RIM_HEIGHT_METRES,
        ] as ExpressionSpecification),
        'fill-extrusion-height': animatedBuildingHeight([
          '+', GLOBAL_BUILDING_HEIGHT, GLOBAL_BUILDING_ROOF_CAP_HEIGHT_METRES,
        ] as ExpressionSpecification),
        'fill-extrusion-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.45, 0.96,
          18, 1,
        ],
        'fill-extrusion-vertical-gradient': false,
      },
    },
    {
      id: 'global-bus-stops',
      type: 'circle',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'poi',
      minzoom: 16,
      filter: [
        'all',
        ['==', ['get', 'class'], 'bus'],
        ['==', ['get', 'subclass'], 'bus_stop'],
      ],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 1.6, 18, 2.8],
        'circle-color': '#91b8b6',
        'circle-stroke-color': '#fafaf5',
        'circle-stroke-width': 0.9,
      },
    },
    {
      id: 'global-railway-stations',
      type: 'circle',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'poi',
      minzoom: 11,
      filter: [
        'any',
        ['==', ['get', 'class'], 'railway'],
        [
          'all',
          ['==', ['get', 'class'], 'bus'],
          ['==', ['get', 'subclass'], 'bus_station'],
        ],
      ],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.8, 16, 5.2],
        'circle-color': '#6f9fa5',
        'circle-stroke-color': '#fafaf5',
        'circle-stroke-width': 1.4,
      },
    },
    {
      id: 'global-railway-station-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'poi',
      minzoom: 11,
      filter: [
        'all',
        [
          'any',
          ['==', ['get', 'class'], 'railway'],
          [
            'all',
            ['==', ['get', 'class'], 'bus'],
            ['==', ['get', 'subclass'], 'bus_station'],
          ],
        ],
        ['has', 'name'],
      ],
      layout: {
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        'text-field': LOCALIZED_NAME,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 16, 13],
        'text-font': ['Noto Sans Regular'],
        'text-offset': [0, 1.15],
        'text-padding': 14,
      },
      paint: {
        'text-color': '#426f76',
        'text-halo-color': '#fafaf5',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'global-transit-line-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 11,
      filter: [
        'all',
        ['has', 'name'],
        ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': LOCALIZED_NAME,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 16, 11.5],
        'text-font': ['Noto Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 28,
      },
      paint: {
        'text-color': [
          'match', ['get', 'class'],
          'transit', '#47777d',
          '#667274',
        ],
        'text-halo-color': '#fafaf5',
        'text-halo-width': 1.45,
      },
    },
    {
      id: 'global-cycleway-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 13.5,
      filter: [
        'all',
        ['has', 'name'],
        ['==', ['get', 'class'], 'path'],
        ['==', ['get', 'subclass'], 'cycleway'],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': LOCALIZED_NAME,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 9, 18, 11.5],
        'text-font': ['Noto Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 26,
      },
      paint: {
        'text-color': '#89736e',
        'text-halo-color': '#faf8f2',
        'text-halo-width': 1.25,
      },
    },
    {
      id: 'global-road-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 11,
      filter: [
        'all',
        ['has', 'name'],
        ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
      ],
      layout: {
        'symbol-placement': 'line',
        'symbol-sort-key': [
          'match', ['get', 'class'],
          'motorway', 1,
          'trunk', 2,
          'primary', 3,
          'secondary', 4,
          'tertiary', 5,
          6,
        ],
        'text-field': LOCALIZED_NAME,
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          8, ['match', ['get', 'class'], 'motorway', 10, 'trunk', 9, 0],
          12, ['match', ['get', 'class'], 'motorway', 12, 'trunk', 11, 'primary', 10, 9],
          16, ['match', ['get', 'class'], 'motorway', 14, 'trunk', 13, 'primary', 13, 12],
        ],
        'text-font': ['Noto Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 20,
      },
      paint: {
        'text-color': '#4f625e',
        'text-halo-color': '#f8f9f7',
        'text-halo-width': 1.65,
      },
    },
    {
      id: 'global-water-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'water_name',
      minzoom: 8,
      filter: [
        'all',
        ['has', 'name'],
        // OpenFreeMap can expose named fountains in water_name. Only label
        // water bodies that belong to the actual lake/sea hierarchy here.
        ['in', ['get', 'class'], ['literal', ['lake', 'bay', 'strait', 'sea', 'ocean']]],
      ],
      layout: {
        'text-field': LOCALIZED_NAME,
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 15],
        'text-font': ['Noto Sans Regular'],
      },
      paint: {
        'text-color': '#d7edf0',
        'text-halo-color': '#79aeba',
        'text-halo-width': 1.45,
      },
    },
    {
      id: 'global-park-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'park',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: {
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        'text-field': LOCALIZED_NAME,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 13],
        'text-font': ['Noto Sans Regular'],
        'text-padding': 12,
      },
      paint: {
        'text-color': '#456947',
        'text-halo-color': '#e7f1df',
        'text-halo-width': 1.35,
      },
    },
    {
      id: 'global-country-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'place',
      maxzoom: 8,
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        'text-field': LOCALIZED_NAME,
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 5, 16, 8, 18],
        'text-font': ['Noto Sans Regular'],
        'text-letter-spacing': 0.08,
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#48564d',
        'text-halo-color': '#eef4ea',
        'text-halo-width': 1.7,
      },
    },
    {
      id: 'global-place-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'place',
      minzoom: 3,
      filter: ['!=', ['get', 'class'], 'country'],
      layout: {
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        'text-field': LOCALIZED_NAME,
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          3, ['match', ['get', 'class'], 'city', 12, 0],
          8, ['match', ['get', 'class'], 'city', 16, 'town', 13, 10],
          14, ['match', ['get', 'class'], 'city', 19, 'town', 16, 'village', 14, 12],
        ],
        'text-font': ['Noto Sans Regular'],
        'text-padding': 10,
      },
      paint: {
        'text-color': '#4e5a52',
        'text-halo-color': '#f4f6f2',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'global-aerodrome-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'aerodrome_label',
      minzoom: 8,
      filter: ['has', 'name'],
      layout: {
        'symbol-sort-key': [
          'match', ['get', 'class'],
          'international', 1,
          'public', 2,
          'regional', 3,
          'military', 4,
          5,
        ],
        'text-field': [
          'concat',
          LOCALIZED_NAME,
          ['case', ['has', 'iata'], ['concat', ' · ', ['get', 'iata']], ''],
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13],
        'text-font': ['Noto Sans Regular'],
        'text-offset': [0, 1],
        'text-padding': 18,
      },
      paint: {
        'text-color': '#59676b',
        'text-halo-color': '#f2f3ee',
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'global-mountain-peaks',
      type: 'circle',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'mountain_peak',
      minzoom: 12,
      filter: ['has', 'name'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 3.5],
        'circle-color': '#8c8174',
        'circle-stroke-color': '#f4f1ea',
        'circle-stroke-width': 1,
      },
    },
    {
      id: 'global-mountain-peak-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'mountain_peak',
      minzoom: 12,
      filter: ['has', 'name'],
      layout: {
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        'text-field': [
          'concat',
          LOCALIZED_NAME,
          ['case', ['has', 'ele'], ['concat', ' · ', ['to-string', ['round', ['get', 'ele']]], ' m'], ''],
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 12],
        'text-font': ['Noto Sans Regular'],
        'text-offset': [0, 1],
        'text-padding': 12,
      },
      paint: {
        'text-color': '#665e55',
        'text-halo-color': '#f4f1ea',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'global-poi-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'poi',
      minzoom: 15,
      filter: [
        'all',
        ['has', 'name'],
        ['!', ['in', ['get', 'class'], ['literal', ['railway', 'bus']]]],
        // Named fountains and other tiny water features are useful as map
        // geometry, but should not compete with city-scale landmarks.
        ['!', ['in', ['get', 'class'], ['literal', ['fountain', 'pond', 'swimming_pool']]]],
        ['!', ['in', ['get', 'subclass'], ['literal', ['fountain', 'pond', 'swimming_pool']]]],
        ['<=', ['coalesce', ['get', 'rank'], 20], 10],
      ],
      layout: {
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        'text-field': LOCALIZED_NAME,
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          13, ['match', ['get', 'class'], 'railway', 11, 'hospital', 11, 10],
          17, 12,
        ],
        'text-font': ['Noto Sans Regular'],
        'text-offset': [0, 1],
        'text-padding': 9,
      },
      paint: {
        'text-color': [
          'match', ['get', 'class'],
          'railway', '#536872',
          'hospital', '#8d6262',
          'park', '#527252',
          'school', '#726c55',
          '#59645c',
        ],
        'text-halo-color': '#f4f6f2',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'global-housenumbers',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'housenumber',
      minzoom: 16,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9, 18, 11],
        'text-font': ['Noto Sans Regular'],
        'text-padding': 4,
      },
      paint: {
        'text-color': '#78817b',
        'text-halo-color': '#f5f7f3',
        'text-halo-width': 1,
      },
    },
  ],
};
