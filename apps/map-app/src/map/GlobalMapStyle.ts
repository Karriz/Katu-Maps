import type {
  ExpressionSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import {
  CARTOON_BUILDING_SHADOW_TRANSLATE,
  CARTOON_MAP_LIGHT_POSITION,
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_AZIMUTH_DEGREES,
} from './CartoonLighting';
import { MAP_COLORS } from './MapPalette';
import type { Map as MapLibreMap } from 'maplibre-gl';

export const OPENFREEMAP_SOURCE_ID = 'openfreemap';
export const MAPTERHORN_SOURCE_ID = 'terrain';

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

const OVERVIEW_RAIL_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
] as ExpressionSpecification;

const CYCLING_ROUTE_NETWORKS = ['icn', 'ncn', 'rcn', 'lcn'] as const;
const HIKING_ROUTE_NETWORKS = ['iwn', 'nwn', 'rwn', 'lwn'] as const;
const LOCAL_RAIL_SUBCLASSES = ['subway', 'light_rail', 'tram', 'monorail', 'funicular', 'rail', 'train'] as const;

function routeNetworkFilter(networks: readonly string[]): ExpressionSpecification {
  return [
    'any',
    ...Array.from({ length: 6 }, (_, index) => (
      ['in', ['get', `route_${index + 1}_network`], ['literal', networks]]
    )),
  ] as ExpressionSpecification;
}

function routeNetworkExpression(networks: readonly string[]): ExpressionSpecification {
  return [
    'case',
    ...Array.from({ length: 6 }, (_, index) => {
      const property = `route_${index + 1}_network`;
      return [
        ['in', ['get', property], ['literal', networks]],
        ['get', property],
      ];
    }).flat(),
    '',
  ] as ExpressionSpecification;
}

const CYCLING_ROUTE_FILTER = routeNetworkFilter(CYCLING_ROUTE_NETWORKS);
const HIKING_ROUTE_FILTER = routeNetworkFilter(HIKING_ROUTE_NETWORKS);
const CYCLING_ROUTE_NETWORK = routeNetworkExpression(CYCLING_ROUTE_NETWORKS);
const HIKING_ROUTE_NETWORK = routeNetworkExpression(HIKING_ROUTE_NETWORKS);

const CYCLING_EMPHASIS_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  CYCLING_ROUTE_FILTER,
] as ExpressionSpecification;

const HIKING_EMPHASIS_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  HIKING_ROUTE_FILTER,
] as ExpressionSpecification;

const CYCLING_PATH_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['==', ['get', 'class'], 'path'],
  [
    'any',
    ['==', ['get', 'subclass'], 'cycleway'],
    ['in', ['get', 'bicycle'], ['literal', ['yes', 'designated', 'official']]],
    ['==', ['get', 'official'], 1],
  ],
] as ExpressionSpecification;

const HIKING_PATH_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  [
    'any',
    ['==', ['get', 'class'], 'track'],
    [
      'all',
      ['==', ['get', 'class'], 'path'],
      ['in', ['get', 'subclass'], ['literal', ['path', 'footway', 'bridleway']]],
    ],
  ],
] as ExpressionSpecification;

const LOCAL_TRANSIT_RAIL_FILTER: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  [
    'any',
    ['==', ['get', 'class'], 'transit'],
    ['in', ['get', 'subclass'], ['literal', LOCAL_RAIL_SUBCLASSES]],
  ],
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

const BRIDGE_PATH_WIDTH_METRES: ExpressionSpecification = [
  'case',
  ['==', ['get', 'class'], 'track'], 3,
  ['==', ['get', 'class'], 'path_construction'], 2,
  ['all', ['==', ['get', 'class'], 'path'], ['==', ['get', 'subclass'], 'cycleway']], 2.5,
  1.8,
] as ExpressionSpecification;

const BRIDGE_PATH_EDGE_COLOR: ExpressionSpecification = [
  'case',
  ['all', ['==', ['get', 'class'], 'path'], ['==', ['get', 'subclass'], 'cycleway']], '#b99a91',
  ['==', ['get', 'class'], 'path_construction'], '#b5a997',
  '#d8d4ca',
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
  ['==', ['get', 'surface'], 'unpaved'], '#d9cbaa',
  [
    'match', ['get', 'class'],
    'motorway', '#f9f7ef',
    'trunk', '#f8f6ee',
    'primary', MAP_COLORS.road,
    'secondary', '#f5f3ec',
    'tertiary', '#f4f2eb',
    'service', '#f3f1ea',
    '#f4f2eb',
  ],
] as ExpressionSpecification;

const BRIDGE_ROAD_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'surface'], 'unpaved'], '#d3c4a5',
  [
    'match', ['get', 'class'],
    'motorway', '#f4f2ea',
    'trunk', '#f3f1e9',
    'primary', '#f2f0e8',
    'secondary', '#f1efe7',
    'tertiary', '#f0eee6',
    'service', '#efede5',
    '#f1efe7',
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

const BRIDGE_DECK_LAYER_IDS = new Set([
  'global-bridge-deck-shadow',
  'global-bridge-decks',
]);

const BRIDGE_OVERLAY_LAYER_IDS = new Set([
  'global-road-bridge-shadow',
  'global-road-bridge-casing',
  'global-road-bridges',
  'global-path-bridge-shadow',
  'global-path-bridge-edge',
  'global-bridge-deck-edge',
  'global-railway-bridge-shadow',
  'global-railway-bridge-casing',
  'global-railway-bridges',
]);

function orderBridgeLayers(layers: StyleSpecification['layers']): StyleSpecification['layers'] {
  const bridgeDeckLayers = layers.filter((layer) => BRIDGE_DECK_LAYER_IDS.has(layer.id));
  const bridgeOverlayLayers = layers.filter((layer) => BRIDGE_OVERLAY_LAYER_IDS.has(layer.id));
  const layersWithoutBridgeGeometry = layers.filter((layer) => (
    !BRIDGE_DECK_LAYER_IDS.has(layer.id) && !BRIDGE_OVERLAY_LAYER_IDS.has(layer.id)
  ));
  const railwayIndex = layersWithoutBridgeGeometry.findIndex((layer) => layer.id === 'global-railways');

  if (railwayIndex === -1) return layers;

  return [
    ...layersWithoutBridgeGeometry.slice(0, railwayIndex + 1),
    ...bridgeDeckLayers,
    ...bridgeOverlayLayers,
    ...layersWithoutBridgeGeometry.slice(railwayIndex + 1),
  ];
}

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

export const GLOBAL_CYCLING_LAYER_IDS = [
  'global-cycling-path-casing',
  'global-cycling-paths',
  'global-cycling-route-casing',
  'global-cycling-routes',
  'global-cycling-route-labels',
];

export const GLOBAL_HIKING_LAYER_IDS = [
  'global-hiking-path-casing',
  'global-hiking-paths',
  'global-hiking-route-casing',
  'global-hiking-routes',
  'global-hiking-route-labels',
  'global-hiking-pois',
];

export const GLOBAL_TRANSIT_LINE_LAYER_IDS = [
  'global-local-transit-casing',
  'global-local-transit-lines',
  'global-local-transit-route-colors',
  'global-transit-line-labels',
];

const GLOBAL_BUILDING_MIN_MULTI_STOREY_HEIGHT_METRES = 5.5;
const GLOBAL_MAP_SUN_COLOR = MAP_COLORS.sun;

export const GLOBAL_BUILDING_FACADE_LAYER_IDS = [
  'global-building-ground-storeys',
];

export const GLOBAL_BUILDING_TRANSITION_FOOTPRINT_LAYER_ID = 'global-building-footprints';
export const GLOBAL_BUILDING_2D_LAYER_ID = 'global-building-footprints-2d';

export const GLOBAL_BUILDING_3D_LAYER_IDS = [
  'global-buildings',
  ...GLOBAL_BUILDING_FACADE_LAYER_IDS,
];

export const GLOBAL_BUILDING_LAYER_IDS = [
  GLOBAL_BUILDING_TRANSITION_FOOTPRINT_LAYER_ID,
  GLOBAL_BUILDING_2D_LAYER_ID,
  ...GLOBAL_BUILDING_3D_LAYER_IDS,
];

const GLOBAL_BUILDING_COLOR = MAP_COLORS.building;
const GLOBAL_BUILDING_GROUND_COLOR = MAP_COLORS.buildingBand;

const WATER_COLOR: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  0, '#5fa9bc',
  3, '#6db5c7',
  6, MAP_COLORS.water,
] as ExpressionSpecification;

const GLOBAL_BUILDING_BASE: ExpressionSpecification = [
  'coalesce', ['get', 'render_min_height'], 0,
] as ExpressionSpecification;

const GLOBAL_BUILDING_HEIGHT: ExpressionSpecification = [
  'coalesce', ['get', 'render_height'], 6,
] as ExpressionSpecification;

const GLOBAL_BUILDING_BODY_HEIGHT: ExpressionSpecification = [
  'max', 0, ['-', GLOBAL_BUILDING_HEIGHT, GLOBAL_BUILDING_BASE],
] as ExpressionSpecification;

const GLOBAL_ESTIMATED_BUILDING_STORIES: ExpressionSpecification = [
  'max', 1, ['round', ['/', GLOBAL_BUILDING_BODY_HEIGHT, 3]],
] as ExpressionSpecification;

const GLOBAL_BUILDING_STORY_HEIGHT: ExpressionSpecification = [
  '/', GLOBAL_BUILDING_BODY_HEIGHT, GLOBAL_ESTIMATED_BUILDING_STORIES,
] as ExpressionSpecification;

const GLOBAL_BUILDING_FIRST_STORY_TOP: ExpressionSpecification = [
  'min',
  GLOBAL_BUILDING_HEIGHT,
  ['+', GLOBAL_BUILDING_BASE, GLOBAL_BUILDING_STORY_HEIGHT],
] as ExpressionSpecification;

const GLOBAL_BUILDING_UPPER_BASE: ExpressionSpecification = [
  'case',
  ['>=', GLOBAL_BUILDING_BODY_HEIGHT, GLOBAL_BUILDING_MIN_MULTI_STOREY_HEIGHT_METRES],
  GLOBAL_BUILDING_FIRST_STORY_TOP,
  GLOBAL_BUILDING_BASE,
] as ExpressionSpecification;

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

export function aerowayWidthExpression(latitude: number): ExpressionSpecification {
  const widthMetres: ExpressionSpecification = [
    'match', ['get', 'class'],
    'runway', 45,
    'taxiway', 23,
    'apron', 12,
    6,
  ] as ExpressionSpecification;

  return [
    'interpolate', ['exponential', 2], ['zoom'],
    10, ['max', 1, ['*', widthMetres, pixelsPerMetre(10, latitude)]],
    12, ['max', 1.5, ['*', widthMetres, pixelsPerMetre(12, latitude)]],
    14, ['*', widthMetres, pixelsPerMetre(14, latitude)],
    16, ['*', widthMetres, pixelsPerMetre(16, latitude)],
    18, ['*', widthMetres, pixelsPerMetre(18, latitude)],
  ] as ExpressionSpecification;
}

function pathWidthExpression(
  widthMetres: number | ExpressionSpecification,
  latitude: number,
  casing = false,
): ExpressionSpecification {
  const renderedWidthMetres: number | ExpressionSpecification = casing
    ? ['+', widthMetres, 0.6] as ExpressionSpecification
    : widthMetres;

  return [
    'interpolate', ['exponential', 2], ['zoom'],
    12, ['max', casing ? 1 : 0.6, ['*', renderedWidthMetres, pixelsPerMetre(12, latitude)]],
    14, ['*', renderedWidthMetres, pixelsPerMetre(14, latitude)],
    16, ['*', renderedWidthMetres, pixelsPerMetre(16, latitude)],
    18, ['*', renderedWidthMetres, pixelsPerMetre(18, latitude) * 0.82],
  ] as ExpressionSpecification;
}

export const GLOBAL_MAP_STYLE: StyleSpecification = {
  version: 8,
  name: 'Global OpenFreeMap with Mapterhorn terrain',
  projection: { type: 'globe' },
  sky: {
    // Keep just enough atmosphere to describe the globe's rim. Stronger
    // blending bleaches the daylight hemisphere at world zooms.
    'atmosphere-blend': [
      'interpolate', ['linear'], ['zoom'],
      0, 0.32,
      2.5, 0.22,
      5, 0.06,
      7, 0,
    ],
  },
  light: {
    // The Three.js model layers derive their sun from these same shared
    // constants, keeping low-poly facets and building walls coherent.
    anchor: 'map',
    position: CARTOON_MAP_LIGHT_POSITION,
    color: GLOBAL_MAP_SUN_COLOR,
    intensity: 0.34,
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
      // This experiment intentionally caps DEM requests at z12. MapLibre
      // overzooms these globally available tiles at closer camera zooms.
      maxzoom: 12,
      attribution: '<a href="https://mapterhorn.com/attribution/">© Mapterhorn terrain data</a>',
    },
  },
  layers: orderBridgeLayers([
    {
      id: 'global-background',
      type: 'background',
      // OpenMapTiles represents the ocean as water polygons and leaves the
      // land mass implicit. A green base therefore gives every continent a
      // continuous natural surface, including low zooms with sparse landcover.
      paint: {
        'background-color': [
          'interpolate', ['linear'], ['zoom'],
          0, '#a9c58e',
          3, '#b8d19f',
          6, MAP_COLORS.ground,
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
          ['==', ['get', 'subclass'], 'park'], MAP_COLORS.park,
          ['in', ['get', 'subclass'], ['literal', ['scrub', 'shrubbery', 'heath']]], MAP_COLORS.scrub,
          ['in', ['get', 'subclass'], ['literal', ['orchard', 'plant_nursery']]], '#c9dda4',
          ['==', ['get', 'subclass'], 'vineyard'], '#d7dda0',
          ['in', ['get', 'subclass'], ['literal', ['garden', 'flowerbed']]], '#bfe19c',
          ['in', ['get', 'subclass'], ['literal', ['meadow', 'grassland', 'village_green']]], MAP_COLORS.meadow,
          [
            'match', ['get', 'class'],
            'wood', MAP_COLORS.forest,
            'grass', MAP_COLORS.grass,
            'farmland', MAP_COLORS.farmland,
            'wetland', '#c3dcaa',
            'sand', '#f4dfa7',
            'rock', '#e5e3dd',
            'ice', '#e7f3f5',
            MAP_COLORS.ground,
          ],
        ],
        // Broad natural regions arrive before their close-range detail. Fade
        // them in so low-zoom source generalisation does not form hard blocks.
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          1.5, 0.18,
          4, 0.38,
          7, 0.62,
          10, 0.9,
        ],
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
          'residential', MAP_COLORS.urban,
          'commercial', MAP_COLORS.commercial,
          'retail', '#eee3cb',
          'industrial', MAP_COLORS.industrial,
          'military', '#d6d9b4',
          'cemetery', '#cae0bc',
          'school', '#f1e6c7',
          'kindergarten', '#f1e6c7',
          'education', '#f1e6c7',
          'university', '#e4e8cf',
          'college', '#e4e8cf',
          'hospital', '#ece6df',
          'parking', '#e6e4dd',
          'park', MAP_COLORS.park,
          'garden', '#b7df96',
          'allotments', '#c9e2a7',
          'orchard', '#c4dc96',
          'vineyard', '#d7dda0',
          'farmland', MAP_COLORS.farmland,
          'farmyard', '#e5d9b7',
          'quarry', '#d9d7d0',
          'pitch', '#a8d88b',
          'playground', '#e0e8a6',
          'stadium', '#d7edbd',
          'railway', '#dde3df',
          '#eff1e8',
        ],
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          4, 0.12,
          7, 0.38,
          10, 0.78,
          12, 0.94,
        ],
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
        'fill-color': MAP_COLORS.park,
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          4, 0.18,
          7, 0.48,
          10, 0.78,
          12, 0.94,
        ],
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
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['!=', ['get', 'class'], 'runway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'runway', '#9ea29f',
          'taxiway', '#b5b9b5',
          '#c1c4bf',
        ],
        'line-width': aerowayWidthExpression(0),
      },
    },
    {
      id: 'global-aeroway-runways',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['get', 'class'], 'runway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#9ea29f',
        'line-width': aerowayWidthExpression(0),
      },
    },
    {
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: MAPTERHORN_SOURCE_ID,
      layout: { visibility: 'visible' },
      paint: {
        'hillshade-exaggeration': [
          'interpolate', ['linear'], ['zoom'],
          0, 0.08,
          5, 0.16,
          10, 0.26,
          14, 0.32,
        ],
        'hillshade-illumination-direction': CARTOON_SUN_AZIMUTH_DEGREES,
        'hillshade-illumination-anchor': 'map',
        'hillshade-shadow-color': '#7d8e82',
        'hillshade-highlight-color': '#f7f2db',
        'hillshade-accent-color': '#b3c0b5',
      },
    },
    {
      id: 'global-waterway',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'waterway',
      paint: {
        'line-color': WATER_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 16, 3],
      },
    },
    {
      id: 'global-water-edge-shade',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'water',
      paint: {
        'fill-color': MAP_COLORS.waterEdge,
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
      paint: {
        'fill-color': WATER_COLOR,
      },
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
      paint: { 'fill-color': '#eee9dc', 'fill-opacity': 0.92 },
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
      minzoom: 10.5,
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.62],
      },
    },
    {
      id: 'global-road-tunnels',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.56],
      },
    },
    {
      id: 'global-overview-road-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 1.5,
      maxzoom: 14,
      filter: OVERVIEW_ROAD_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': MAP_COLORS.roadCasing,
        'line-width': [
          'interpolate', ['exponential', 2], ['zoom'],
          1.5, ['match', ['get', 'class'], 'motorway', 3.8, 'trunk', 3.1, 'primary', 2, 1.35],
          4, ['match', ['get', 'class'], 'motorway', 4.5, 'trunk', 3.8, 'primary', 2.4, 1.7],
          7, ['match', ['get', 'class'], 'motorway', 5.7, 'trunk', 5, 'primary', 3.5, 2.6],
          10, ['match', ['get', 'class'], 'motorway', 6.3, 'trunk', 5.7, 'primary', 4.5, 3.8],
          13.5, ['match', ['get', 'class'], 'motorway', 6.7, 'trunk', 6.2, 'primary', 5.3, 4.7],
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          1.5, 0,
          2.2, 0.78,
          11, 0.74,
          13.75, 0,
        ],
      },
    },
    {
      id: 'global-overview-roads',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 1.5,
      maxzoom: 14,
      filter: OVERVIEW_ROAD_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROAD_COLOR,
        'line-width': [
          'interpolate', ['exponential', 2], ['zoom'],
          1.5, ['match', ['get', 'class'], 'motorway', 2.8, 'trunk', 2.2, 'primary', 1.35, 0.8],
          4, ['match', ['get', 'class'], 'motorway', 3.5, 'trunk', 2.9, 'primary', 1.7, 1.1],
          7, ['match', ['get', 'class'], 'motorway', 4.6, 'trunk', 4, 'primary', 2.5, 1.8],
          10, ['match', ['get', 'class'], 'motorway', 5.2, 'trunk', 4.7, 'primary', 3.4, 2.8],
          13.5, ['match', ['get', 'class'], 'motorway', 5.6, 'trunk', 5.2, 'primary', 4.3, 3.8],
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          1.5, 0,
          2.2, 0.94,
          11, 1,
          13.75, 0,
        ],
      },
    },
    {
      id: 'global-road-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
      filter: SURFACE_ROAD_FILTER,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': MAP_COLORS.roadCasing,
        'line-width': roadWidthExpression(61.4981, true),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.78],
      },
    },
    {
      id: 'global-roads',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
      filter: SURFACE_ROAD_FILTER,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': ROAD_COLOR,
        'line-width': roadWidthExpression(61.4981),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.98],
      },
    },
    {
      id: 'global-road-bridge-shadow',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.25],
      },
    },
    {
      id: 'global-road-bridge-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.84],
      },
    },
    {
      id: 'global-road-bridges',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
      filter: ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'bridge']],
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
        'line-sort-key': ROAD_SORT_KEY,
      },
      paint: {
        'line-color': BRIDGE_ROAD_COLOR,
        'line-width': roadWidthExpression(61.4981),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 1],
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
      minzoom: 10.5,
      filter: PATH_BRIDGE_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CARTOON_SHADOW_COLOR,
        'line-width': pathWidthExpression(BRIDGE_PATH_WIDTH_METRES, 61.4981, true),
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
        'line-color': BRIDGE_PATH_EDGE_COLOR,
        'line-width': pathWidthExpression(BRIDGE_PATH_WIDTH_METRES, 61.4981, true),
        'line-opacity': 0.84,
      },
    },
    {
      id: 'global-path-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12.5,
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['in', ['get', 'class'], ['literal', ['path', 'track']]],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#d8d4ca',
        'line-width': pathWidthExpression(
          ['case', ['==', ['get', 'class'], 'track'], 3, 1.8] as ExpressionSpecification,
          61.4981,
          true,
        ),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.42],
      },
    },
    {
      id: 'global-cycleway-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
      filter: [
        'all',
        ['==', ['get', 'class'], 'path'],
        ['==', ['get', 'subclass'], 'cycleway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f3f0e9',
        'line-width': pathWidthExpression(2.5, 61.4981, true),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.5, 0.58, 13, 0.82],
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
      minzoom: 10.5,
      filter: [
        'all',
        ['==', ['get', 'class'], 'path'],
        ['==', ['get', 'subclass'], 'cycleway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#b99a91',
        'line-width': pathWidthExpression(2.5, 61.4981),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.76],
      },
    },
    {
      id: 'global-footways',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 12.5,
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
        'line-width': pathWidthExpression(1.8, 61.4981),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 0.5],
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
      minzoom: 2,
      maxzoom: 11,
      filter: OVERVIEW_RAIL_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#7f898b',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          2, 0.8,
          3, 1,
          6, 1.35,
          9, 1.8,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          2, 0,
          3, 0.72,
          6, 0.86,
          9, 0.9,
          10.75, 0,
        ],
      },
    },
    {
      id: 'global-railway-bed',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 8.5,
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0, 10, 0.82],
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
      minzoom: 8.5,
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
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          8.5, 0,
          10, ['match', ['get', 'class'], 'transit', 0.9, 0.86],
        ],
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
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          0, 0.18,
          2, 0.42,
          5, 0.62,
          8, 0.7,
        ],
      },
    },
    {
      id: 'global-building-footprints',
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 12,
      maxzoom: 13.75,
      paint: {
        'fill-color': GLOBAL_BUILDING_COLOR,
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0.78,
          13.45, 0.5,
          13.75, 0,
        ],
        'fill-outline-color': '#c8c5ba',
      },
    },
    {
      id: GLOBAL_BUILDING_2D_LAYER_ID,
      type: 'fill',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 12,
      layout: { visibility: 'none' },
      paint: {
        // This is the persistent flat representation used when 3D buildings
        // are disabled. It gains a little definition at close zooms without
        // trying to imitate extrusion lighting.
        'fill-color': '#fffef9',
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          12, 0,
          12.7, 0.84,
          15, 0.92,
          18, 0.95,
        ],
        // Fill outlines render as a restrained one-pixel hairline in
        // MapLibre, keeping adjacent footprints legible without heavy rims.
        'fill-outline-color': '#b7beb7',
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
          13, 1.3,
          18, 3.1,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.5, 0.16,
          18, 0.32,
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
          13, 0.7,
          18, 1.45,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.45, 0.22,
          18, 0.4,
        ],
      },
    },
    {
      id: GLOBAL_BUILDING_FACADE_LAYER_IDS[0],
      type: 'fill-extrusion',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      filter: [
        'all',
        ['!', ['==', ['get', 'hide_3d'], true]],
        ['>=', GLOBAL_BUILDING_BODY_HEIGHT, GLOBAL_BUILDING_MIN_MULTI_STOREY_HEIGHT_METRES],
      ],
      paint: {
        'fill-extrusion-color': GLOBAL_BUILDING_GROUND_COLOR,
        // Keep the real height present while the layer fades in. The opacity
        // transition below handles the low-zoom handoff from footprints;
        // animating height here makes pitched, distant buildings look flat.
        'fill-extrusion-height': GLOBAL_BUILDING_FIRST_STORY_TOP,
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
    {
      id: 'global-buildings',
      type: 'fill-extrusion',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      filter: ['!', ['==', ['get', 'hide_3d'], true]],
      paint: {
        'fill-extrusion-color': GLOBAL_BUILDING_COLOR,
        'fill-extrusion-height': GLOBAL_BUILDING_HEIGHT,
        // Multi-storey buildings begin above the darker ground floor. Short
        // buildings remain a single extrusion from their normal base.
        'fill-extrusion-base': GLOBAL_BUILDING_UPPER_BASE,
        'fill-extrusion-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.45, 0.96,
          18, 1,
        ],
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: 'global-hiking-path-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
      filter: HIKING_PATH_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#fff8e8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10.5, 2.2, 14, 4.2, 18, 7],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.5, 0.78],
      },
    },
    {
      id: 'global-hiking-paths',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10.5,
      filter: HIKING_PATH_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'surface'],
          'paved', '#b47750',
          'unpaved', '#a96343',
          '#b26e48',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10.5, 0.85, 14, 1.8, 18, 3.4],
        'line-dasharray': [1.8, 1.1],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.5, 0.88],
      },
    },
    {
      id: 'global-hiking-route-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 6,
      filter: HIKING_EMPHASIS_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#fff8e8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.1, 11, 3.8, 16, 7],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.62, 11, 0.88],
      },
    },
    {
      id: 'global-hiking-routes',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 6,
      filter: HIKING_EMPHASIS_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', HIKING_ROUTE_NETWORK,
          'iwn', '#a33b35',
          'nwn', '#ba4b3d',
          'rwn', '#cf7045',
          'lwn', '#dc8a52',
          '#b67b4f',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.05, 11, 1.8, 16, 3.6],
        'line-dasharray': [2.1, 1.15],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.75, 11, 0.96],
      },
    },
    {
      id: 'global-hiking-route-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 9,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], HIKING_ROUTE_FILTER],
      layout: {
        visibility: 'none',
        'symbol-placement': 'line',
        'text-field': [
          'coalesce',
          ['get', 'route_1_ref'], ['get', 'route_2_ref'], ['get', 'route_3_ref'],
          ['get', 'route_1_name'], ['get', 'route_2_name'], LOCALIZED_NAME,
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9.5, 15, 11.5],
        'text-font': ['Noto Sans Regular'],
        'text-padding': 24,
      },
      paint: {
        'text-color': '#97433a',
        'text-halo-color': '#fff8e8',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'global-cycling-path-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: CYCLING_PATH_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f5fbff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 14, 4.6, 18, 7.6],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 0.82],
      },
    },
    {
      id: 'global-cycling-paths',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: CYCLING_PATH_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'surface'],
          'unpaved', '#b44a4a',
          '#c94a4a',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.2, 18, 4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 0.92],
      },
    },
    {
      id: 'global-cycling-route-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 5,
      filter: CYCLING_EMPHASIS_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f5fbff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.1, 11, 4.2, 16, 7.5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.64, 11, 0.92],
      },
    },
    {
      id: 'global-cycling-routes',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 5,
      filter: CYCLING_EMPHASIS_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', CYCLING_ROUTE_NETWORK,
          'icn', '#d93d3d',
          'ncn', '#e14a4a',
          'rcn', '#ef5d5d',
          'lcn', '#f06f6f',
          '#d93d3d',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.1, 11, 2.1, 16, 4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 11, 0.98],
      },
    },
    {
      id: 'global-cycling-route-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 9,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], CYCLING_ROUTE_FILTER],
      layout: {
        visibility: 'none',
        'symbol-placement': 'line',
        'text-field': [
          'coalesce',
          ['get', 'route_1_ref'], ['get', 'route_2_ref'], ['get', 'route_3_ref'],
          ['get', 'route_1_name'], ['get', 'route_2_name'], LOCALIZED_NAME,
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9.5, 15, 11.5],
        'text-font': ['Noto Sans Regular'],
        'text-padding': 24,
      },
      paint: {
        'text-color': '#8b2d2d',
        'text-halo-color': '#f5fbff',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'global-local-transit-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 4,
      filter: LOCAL_TRANSIT_RAIL_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#fffdf8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.4, 11, 5, 16, 8],
        'line-opacity': 0.94,
      },
    },
    {
      id: 'global-local-transit-lines',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 4,
      filter: LOCAL_TRANSIT_RAIL_FILTER,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'subclass'],
          'subway', '#e06b2f',
          'tram', '#c84059',
          'light_rail', '#7565bb',
          'monorail', '#16878c',
          'funicular', '#b77932',
          'rail', '#4f9b70',
          'train', '#4f9b70',
          '#4f9b70',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.1, 11, 2.7, 16, 4.8],
        'line-opacity': 0.96,
      },
    },
    {
      id: 'global-local-transit-route-colors',
      type: 'line',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 4,
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['get', 'class'], 'transit'],
        ['has', 'route_1_colour'],
      ],
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['to-color', ['get', 'route_1_colour'], '#c84059'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 12, 3, 16, 5],
        'line-opacity': 0.98,
      },
    },
    {
      id: 'global-hiking-pois',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'poi',
      minzoom: 10,
      maxzoom: 13.5,
      filter: [
        'any',
        ['in', ['get', 'class'], ['literal', ['shelter', 'wilderness_hut', 'alpine_hut', 'viewpoint', 'information', 'guidepost', 'picnic_site', 'campsite', 'camp_site', 'drinking_water', 'toilets']]],
        ['in', ['get', 'subclass'], ['literal', ['shelter', 'wilderness_hut', 'alpine_hut', 'viewpoint', 'information', 'guidepost', 'picnic_site', 'campsite', 'camp_site', 'drinking_water', 'toilets']]],
      ],
      layout: {
        visibility: 'none',
        'icon-image': [
          'match', ['get', 'class'],
          'viewpoint', 'location-viewpoint-icon',
          'information', 'location-guidepost-icon',
          'guidepost', 'location-guidepost-icon',
          'picnic_site', 'location-picnic_site-icon',
          'campsite', 'location-campsite-icon',
          'camp_site', 'location-campsite-icon',
          'drinking_water', 'location-drinking_water-icon',
          'toilets', 'location-toilets-icon',
          [
            'match', ['get', 'subclass'],
            'viewpoint', 'location-viewpoint-icon',
            'information', 'location-guidepost-icon',
            'guidepost', 'location-guidepost-icon',
            'picnic_site', 'location-picnic_site-icon',
            'campsite', 'location-campsite-icon',
            'camp_site', 'location-campsite-icon',
            'drinking_water', 'location-drinking_water-icon',
            'toilets', 'location-toilets-icon',
            'location-shelter-icon',
          ],
        ],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 13.5, 1.18],
        'icon-padding': 8,
        'text-field': LOCALIZED_NAME,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 13.5, 11],
        'text-font': ['Noto Sans Regular'],
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-padding': 10,
        'text-optional': true,
      },
      paint: {
        'text-color': '#6f563b',
        'text-halo-color': '#fff9eb',
        'text-halo-width': 1.35,
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
        visibility: 'none',
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
      minzoom: 6,
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
        'text-color': MAP_COLORS.label,
        'text-halo-color': MAP_COLORS.labelHalo,
        'text-halo-width': 1.75,
      },
    },
    {
      id: 'global-major-protected-area-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'park',
      minzoom: 5,
      filter: [
        'all',
        ['has', 'name'],
        ['in', ['get', 'class'], ['literal', ['national_park', 'nature_reserve']]],
      ],
      layout: {
        'text-field': LOCALIZED_NAME,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10.5, 9, 13, 14, 15],
        'text-max-width': 12,
        'text-padding': 14,
      },
      paint: {
        'text-color': '#4e6b4d',
        'text-halo-color': '#f7fbf2',
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'global-water-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'water_name',
      minzoom: 6,
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
        'text-opacity': [
          'interpolate', ['linear'], ['zoom'],
          6.5, 1,
          8, 0,
        ],
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
        'text-padding': 12,
      },
      paint: {
        'text-color': MAP_COLORS.label,
        'text-halo-color': MAP_COLORS.labelHalo,
        'text-halo-width': 1.8,
        'text-opacity': [
          'interpolate', ['linear'], ['zoom'],
          3, 0,
          4, 1,
        ],
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
        'icon-image': 'location-airport-icon',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.9, 14, 1.15],
        'icon-padding': 12,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-padding': 18,
        'text-optional': true,
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
          '#4f6056',
        ],
        'text-halo-color': MAP_COLORS.labelHalo,
        'text-halo-width': 1.3,
      },
    },
    {
      id: 'global-housenumbers',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE_ID,
      'source-layer': 'housenumber',
      minzoom: 17,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 17, 9, 19, 12],
        'text-font': ['Noto Sans Regular'],
        'text-padding': 2,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#78817b',
        'text-halo-color': '#f5f7f3',
        'text-halo-width': 1,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 17, 0, 17.25, 0.9],
      },
    },
  ]),
};

/** Recolors the already-loaded style in place. This intentionally avoids
 * setStyle(): custom Three.js layers, sources, camera state, and selections
 * therefore survive an appearance change. */
export function applyMapTheme(map: MapLibreMap, theme: 'light' | 'dark') {
  const originalPaints = mapThemePaints.get(map) ?? new Map<string, Record<string, unknown>>();
  if (!mapThemePaints.has(map)) {
    (map.getStyle().layers ?? []).forEach((layer) => {
      if (layer.paint) originalPaints.set(layer.id, { ...layer.paint } as Record<string, unknown>);
    });
    mapThemePaints.set(map, originalPaints);
  }
  if (theme === 'light') {
    originalPaints.forEach((paint, id) => Object.entries(paint).forEach(([property, value]) => {
      if (map.getLayer(id)) map.setPaintProperty(id, property as never, value as never);
    }));
    if (map.getLayer('global-aerodrome-labels')) map.setLayoutProperty('global-aerodrome-labels', 'icon-image', 'location-airport-icon');
    if (map.getLayer('location-poi-icons')) map.setPaintProperty('location-poi-icons', 'icon-opacity', 1);
    if (map.getLayer('location-poi-labels')) map.setPaintProperty('location-poi-labels', 'icon-opacity', 1);
    map.triggerRepaint();
    return;
  }
  const dark = true;
  const colors = dark ? {
    background: '#071525', land: '#10253a', green: '#17384a', park: '#163944',
    water: '#0a2c46', waterEdge: '#164c66', road: '#b8aa80', roadCasing: '#625e53',
    path: '#8b9e9d', rail: '#6b8295', building: '#293f53', buildingBand: '#625f52',
    label: '#d9e8f5', halo: '#10253a', shadow: '#061322', boundary: '#7391a5',
  } : {
    background: '#f3f4f1', land: '#c9e0b4', green: '#a8c88c', park: '#bfdda0',
    water: '#7fc4d6', waterEdge: '#5d9fb3', road: '#f7f5ee', roadCasing: '#adb8af',
    path: '#fff8e8', rail: '#8ea097', building: '#fffdf8', buildingBand: '#dedad1',
    label: MAP_COLORS.label, halo: MAP_COLORS.labelHalo, shadow: '#4b5d52', boundary: '#8ea097',
  };
  const set = (id: string, property: string, value: unknown) => {
    if (map.getLayer(id)) map.setPaintProperty(id, property as never, value as never);
  };
  set('global-background', 'background-color', colors.background);
  ['global-landcover', 'global-landuse'].forEach((id) => set(id, 'fill-color', colors.land));
  ['global-protected-areas', 'global-parks'].forEach((id) => set(id, 'fill-color', colors.park));
  set('global-aeroway-areas', 'fill-color', '#29465a');
  set('global-aeroway-lines', 'line-color', '#7190a2');
  set('global-aeroway-runways', 'line-color', '#617f92');
  set('terrain-hillshade', 'hillshade-shadow-color', '#020b14');
  set('terrain-hillshade', 'hillshade-highlight-color', '#173149');
  set('terrain-hillshade', 'hillshade-accent-color', '#0b2033');
  ['global-water', 'global-waterway'].forEach((id) => set(id, id.endsWith('way') ? 'line-color' : 'fill-color', colors.water));
  set('global-water-edge-shade', 'fill-color', colors.waterEdge);
  ['global-pedestrian-areas', 'global-pier-areas', 'global-bridge-decks'].forEach((id) => set(id, 'fill-color', colors.land));
  ['global-road-tunnel-casing', 'global-road-casing', 'global-road-bridge-casing', 'global-overview-road-casing'].forEach((id) => set(id, 'line-color', colors.roadCasing));
  ['global-road-tunnels', 'global-roads', 'global-road-bridges', 'global-overview-roads'].forEach((id) => set(id, 'line-color', colors.road));
  ['global-path-casing', 'global-cycleway-casing', 'global-footways', 'global-steps', 'global-other-paths'].forEach((id) => set(id, 'line-color', colors.path));
  ['global-tracks', 'global-railways', 'global-overview-railways'].forEach((id) => set(id, 'line-color', colors.rail));
  ['global-building-footprints', 'global-building-footprints-2d'].forEach((id) => { set(id, 'fill-color', colors.building); set(id, 'fill-outline-color', colors.boundary); });
  set('global-building-ground-storeys', 'fill-extrusion-color', colors.buildingBand);
  set('global-buildings', 'fill-extrusion-color', colors.building);
  set('global-building-ground-storeys', 'fill-extrusion-vertical-gradient', false);
  set('global-buildings', 'fill-extrusion-vertical-gradient', false);
  ['global-building-shadow', 'global-building-contact-shadow'].forEach((id) => set(id, 'line-color', colors.shadow));
  ['global-boundaries'].forEach((id) => set(id, 'line-color', colors.boundary));
  (map.getStyle().layers ?? []).filter((layer) => layer.id.startsWith('global-') && layer.id.includes('label')).forEach((layer) => {
    set(layer.id, 'text-color', colors.label);
    set(layer.id, 'text-halo-color', colors.halo);
  });
  if (map.getLayer('global-aerodrome-labels')) {
    map.setLayoutProperty('global-aerodrome-labels', 'icon-image', 'location-airport-icon-dark');
  }
  ['location-poi-icons', 'location-poi-labels'].forEach((id) => set(id, 'icon-opacity', 0.78));
  map.triggerRepaint();
}

const mapThemePaints = new WeakMap<MapLibreMap, Map<string, Record<string, unknown>>>();
