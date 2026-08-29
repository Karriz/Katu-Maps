import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import {
  type ExpressionSpecification,
  type FillLayerSpecification,
  type FilterSpecification,
  type Map,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type MapSourceDataEvent,
  type Point,
} from 'maplibre-gl';
import {
  Beer,
  BookOpen,
  ArrowDown,
  Church,
  Coffee,
  GraduationCap,
  BriefcaseBusiness,
  Hospital,
  House,
  Hotel,
  Landmark,
  Palette,
  MapPin,
  Star,
  X,
  Clock3,
  Copy,
  Mountain,
  ShoppingBag,
  Store,
  Ticket,
  TreePine,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TreeModelLayer } from './TreeModelLayer';
import { MapControls, type MapLayerState } from './MapControls';
import { MAP_COLORS } from './MapPalette';
import { TransitStopsLayer } from './TransitStopsLayer';
import type { TransitVehiclePose } from './TransitStopsLayer';
import { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import { TransitDeparturesPanel } from './TransitDeparturesPanel';
import type { TransitStopSelection } from './TransitStopsLayer';
import { fetchValhallaRoute, type RouteMode, type RouteResult } from './ValhallaRouting';
import { fetchTransitRoutes, type TransitRouteResult } from './TransitRouting';
import { searchTransitStops, type TransitProviderId } from './transit';
import { coordinateBounds, panelPaddingForRects, removeIsolatedCoordinateOutliers } from './RouteCamera';
import { elevationResult, formatCoordinates, formatElevation, hasDisplayableElevation, queryTerrainElevation, type ElevationState } from './PositionInformation';
import { DistanceMeasurementController, formatDistance, type Measurement } from './DistanceMeasurement';
import { availableGpsEndpoint, markerFeatureCollection } from './LocationMarkers';
import { loadPersistedMapView, savePersistedMapView } from './PersistedMapView';
import { useInAppNavigation } from '../lib/useInAppNavigation';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { favoriteMapFeatures, loadFavorites, orderedFavorites, resolvedFavoriteEntityType, saveFavorites, upsertFavorite, type Favorite, type FavoriteKind } from '../lib/Favorites';
import {
  CARTOON_SUN_AZIMUTH_DEGREES,
} from './CartoonLighting';
import {
  GLOBAL_BUILDING_2D_LAYER_ID,
  GLOBAL_BUILDING_3D_LAYER_IDS,
  GLOBAL_BUILDING_TRANSITION_FOOTPRINT_LAYER_ID,
  GLOBAL_MAP_STYLE,
  GLOBAL_ROAD_CASING_LAYER_IDS,
  GLOBAL_ROAD_LAYER_IDS,
  OPENFREEMAP_SOURCE_ID,
  roadWidthExpression,
} from './GlobalMapStyle';

const TAMPERE: [number, number] = [23.7609, 61.4981];
const WATER_PATTERN_ID = 'water-surface-pattern';
const WATER_EFFECT_LAYER_IDS = ['global-water-pattern'];
const BUILDING_SHADOW_LAYER_IDS = [
  'global-building-shadow',
  'global-building-contact-shadow',
];
const LAYER_STORAGE_KEY = 'tampere-map-layer-options';
const STALE_BACKGROUND_MS = 5 * 60_000;

function closeRangeCameraOffset(): [number, number] {
  if (window.innerWidth > 760) return [0, 0];
  return [0, -Math.min(140, window.innerHeight * 0.18)];
}

function followCameraCenter(map: Map, coordinates: [number, number]): [number, number] {
  const mapRect = map.getContainer().getBoundingClientRect();
  let left = 0;
  let right = mapRect.width;
  let top = 0;
  let bottom = mapRect.height;
  document.querySelectorAll<HTMLElement>('.route-panel, .transit-departures-panel, .location-info-panel').forEach((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const overlaps = panelRect.right > mapRect.left
      && panelRect.left < mapRect.right
      && panelRect.bottom > mapRect.top
      && panelRect.top < mapRect.bottom;
    if (!overlaps) return;
    const relative = {
      left: panelRect.left - mapRect.left,
      right: panelRect.right - mapRect.left,
      top: panelRect.top - mapRect.top,
      bottom: panelRect.bottom - mapRect.top,
    };
    if (relative.bottom >= mapRect.height - 2) bottom = Math.min(bottom, relative.top);
    else if (relative.top <= 2) top = Math.max(top, relative.bottom);
    else if (relative.left <= mapRect.width / 2) left = Math.max(left, relative.right);
    else right = Math.min(right, relative.left);
  });
  if (right <= left || bottom <= top) return coordinates;
  const currentCenter = map.getCenter();
  const vehicleCoordinateAtTarget = map.unproject([(left + right) / 2, (top + bottom) / 2]);
  // Shift the map center by the geographic difference between where the
  // vehicle is and the coordinate currently under the desired screen point.
  return [
    currentCenter.lng + coordinates[0] - vehicleCoordinateAtTarget.lng,
    currentCenter.lat + coordinates[1] - vehicleCoordinateAtTarget.lat,
  ];
}

function panelViewportPadding(map: Map, base = 0, gap = 0) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const panelRects = [...document.querySelectorAll<HTMLElement>('.route-panel, .transit-departures-panel, .location-info-panel')]
    .map((panel) => panel.getBoundingClientRect());
  return panelPaddingForRects(mapRect, panelRects, base, gap);
}

function searchViewportPadding(map: Map) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const obscuringRects = [...document.querySelectorAll<HTMLElement>(
    '.location-search-form, .route-panel, .transit-departures-panel, .location-info-panel',
  )].map((element) => element.getBoundingClientRect());
  // Leave room for marker labels and for mobile browser safe areas. The
  // search box is included even though it closes as the camera animation
  // starts, so results never finish underneath its persistent input.
  return panelPaddingForRects(mapRect, obscuringRects, window.innerWidth <= 760 ? 28 : 44, 16);
}

function routeCoordinates(result: RouteResult): [number, number][] {
  const geometries = [
    result.geometry,
    ...(result.transitLegs?.flatMap((leg) => leg.geometry ? [leg.geometry] : []) ?? []),
  ];
  return geometries.flatMap((geometry) => removeIsolatedCoordinateOutliers(
    geometry.coordinates.filter(isValidCoordinate),
  ));
}

function isValidCoordinate(coordinate: unknown): coordinate is [number, number] {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

type PhotonFeature = {
  geometry: {
    coordinates: [number, number];
  };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    transitStopId?: string;
    transitMode?: string;
    transitProvider?: TransitProviderId;
    favoriteId?: string;
    [key: string]: unknown;
  };
};

type LocationSelection = {
  name: string;
  category: string;
  address?: string;
  coordinates: [number, number];
  source: 'search' | 'map';
  transitStopId?: string;
  transitStopProvider?: TransitProviderId;
  transitMode?: string;
  openingHours?: string;
  phone?: string;
  email?: string;
  website?: string;
  osmType?: string;
  osmId?: string | number;
  iconId?: string;
  favoriteId?: string;
};

function photonResultLabel(feature: PhotonFeature) {
  const { name, housenumber, street, city, state, country } = feature.properties;
  if (feature.properties.transitStopId) {
    return {
      primary: name || 'Transit stop',
      secondary: `Transit stop${feature.properties.transitMode ? ` · ${feature.properties.transitMode}` : ''}`,
    };
  }
  const address = [housenumber, street].filter(Boolean).join(' ');
  const primary = name || address || city || state || country || 'Unnamed place';
  const secondary = [
    name && address,
    city,
    state,
    country,
  ].filter(Boolean).join(', ');
  return { primary, secondary };
}

function locationCategory(properties: Record<string, unknown>) {
  const value = String(properties.class ?? properties.osm_value ?? properties.subclass ?? 'place').replaceAll('_', ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function transitModeLabel(mode: string) {
  if (mode === 'WALK' || mode === 'FOOT') return 'Walk';
  if (mode === 'TRAM') return 'Tram';
  if (mode === 'BUS') return 'Bus';
  if (mode === 'SUBWAY' || mode === 'SUBURBAN') return 'Metro';
  if (mode === 'RAIL' || mode === 'REGIONAL_RAIL' || mode === 'LONG_DISTANCE') return 'Train';
  return mode.replaceAll('_', ' ');
}

function transitTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function locationIconId(properties: Record<string, unknown>) {
  return String(properties.class ?? properties.osm_value ?? properties.subclass ?? 'shop');
}

function locationName(properties: Record<string, unknown>) {
  return String(properties.name ?? properties['name:en'] ?? 'Interesting place');
}

function locationAddress(properties: Record<string, unknown>) {
  return [properties.housenumber, properties.street, properties.city]
    .filter(Boolean)
    .join(' ')
    .trim() || undefined;
}

function locationProperty(properties: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function locationDetails(properties: Record<string, unknown>) {
  const extra = properties.extra && typeof properties.extra === 'object'
    ? properties.extra as Record<string, unknown>
    : properties.extratags && typeof properties.extratags === 'object'
      ? properties.extratags as Record<string, unknown>
      : {};
  const detailProperties = { ...properties, ...extra };
  const website = locationProperty(detailProperties, 'website', 'contact:website', 'contact_website');
  return {
    openingHours: locationProperty(detailProperties, 'opening_hours', 'openingHours'),
    phone: locationProperty(detailProperties, 'phone', 'contact:phone', 'contact_phone'),
    email: locationProperty(detailProperties, 'email', 'contact:email', 'contact_email'),
    website: website && (/^https?:\/\//i.test(website) ? website : `https://${website}`),
  };
}

function locationSelectionFromFeature(feature: MapGeoJSONFeature): LocationSelection {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return {
    name: locationName(properties),
    category: locationCategory(properties),
    address: locationAddress(properties),
    coordinates: feature.geometry.type === 'Point'
      ? feature.geometry.coordinates as [number, number]
      : [0, 0],
    source: 'map',
    ...locationDetails(properties),
    iconId: locationIconId(properties),
    favoriteId: typeof properties.favoriteId === 'string' ? properties.favoriteId : undefined,
    osmId: typeof properties.osm_id === 'string' || typeof properties.osm_id === 'number'
      ? properties.osm_id
      : (typeof feature.id === 'string' || typeof feature.id === 'number' ? feature.id : undefined),
    osmType: typeof properties.osm_type === 'string' ? properties.osm_type : undefined,
  };
}

const BUILDING_3D_LAYER_IDS = [...GLOBAL_BUILDING_3D_LAYER_IDS];

const LOCATION_POI_CLASSES = [
  'restaurant', 'cafe', 'bar', 'fast_food', 'pub', 'food_court',
  'bakery', 'shop', 'supermarket', 'marketplace', 'museum', 'gallery',
  'theatre', 'cinema', 'artwork', 'attraction', 'tourism', 'hotel',
  'hospital', 'clinic', 'pharmacy', 'school', 'university', 'library',
  'place_of_worship', 'park', 'stadium', 'community_centre', 'food', 'catering',
  'sustenance', 'commercial', 'historic', 'entertainment', 'healthcare',
  'education', 'religion', 'leisure',
];

const LOCATION_ICON_DEFINITIONS: Array<[string, LucideIcon]> = [
  ['restaurant', Utensils], ['cafe', Coffee], ['bar', Beer], ['fast_food', Utensils],
  ['pub', Beer], ['food_court', Utensils], ['bakery', Store],
  ['shop', ShoppingBag], ['supermarket', ShoppingBag], ['marketplace', Store],
  ['museum', Landmark], ['gallery', Palette], ['theatre', Ticket], ['cinema', Ticket],
  ['artwork', Palette], ['attraction', Landmark], ['tourism', Landmark], ['hotel', Hotel],
  ['hospital', Hospital], ['clinic', Hospital], ['pharmacy', Hospital],
  ['school', GraduationCap], ['university', GraduationCap], ['library', BookOpen],
  ['place_of_worship', Church], ['park', TreePine], ['stadium', Ticket],
  ['community_centre', Landmark],
];

const LOCATION_ICON_COLORS: Record<string, string> = {
  restaurant: '#d46d62', cafe: '#b98655', bar: '#ab6d9d', fast_food: '#d48b55', pub: '#ab6d9d',
  food_court: '#d48b55', bakery: '#b98655', shop: '#5f8ec4', supermarket: '#5f8ec4', marketplace: '#5f8ec4',
  museum: '#806bb0', gallery: '#806bb0', theatre: '#806bb0', cinema: '#806bb0', artwork: '#806bb0',
  attraction: '#806bb0', tourism: '#806bb0', hotel: '#806bb0', hospital: '#b45f72', clinic: '#b45f72',
  pharmacy: '#b45f72', school: '#6d8d68', university: '#6d8d68', library: '#6d8d68',
  place_of_worship: '#a18159', park: '#6d9a71', stadium: '#6d9a71', community_centre: '#64748b',
};

const LOCATION_ICON_ALIASES: Array<[string, string]> = [
  ['food', 'restaurant'], ['catering', 'restaurant'], ['sustenance', 'restaurant'],
  ['commercial', 'shop'], ['historic', 'museum'], ['entertainment', 'ticket'],
  ['healthcare', 'hospital'], ['education', 'school'], ['religion', 'place_of_worship'],
  ['leisure', 'park'],
];

const FAVORITE_ICON_DEFINITIONS: Array<[string, LucideIcon]> = [
  ['favorite-home-icon', House],
  ['favorite-work-icon', BriefcaseBusiness],
  ['favorite-star-icon', Star],
];

const LOCATION_PRIORITY: Array<[string, number]> = [
  ['restaurant', 1], ['cafe', 2], ['bar', 3], ['pub', 3], ['fast_food', 4],
  ['museum', 5], ['gallery', 5], ['theatre', 5], ['cinema', 5], ['attraction', 5],
  ['hospital', 6], ['clinic', 6], ['pharmacy', 6], ['school', 7], ['university', 7],
  ['library', 7], ['place_of_worship', 8], ['hotel', 8], ['park', 9], ['stadium', 9],
  ['shop', 15], ['supermarket', 16], ['marketplace', 16], ['bakery', 10],
];

function locationPriorityExpression() {
  const pairs = LOCATION_PRIORITY.flatMap(([className, priority]) => [className, priority]);
  return [
    'match', ['get', 'class'], ...pairs,
    ['match', ['get', 'subclass'], ...pairs, 20],
  ] as unknown as ExpressionSpecification;
}

async function addLocationIcons(map: Map) {
  await Promise.all(LOCATION_ICON_DEFINITIONS.map(async ([id, Icon]) => {
    const imageId = `location-${id}-icon`;
    if (map.hasImage(imageId)) return;
    const svg = renderToStaticMarkup(createElement(Icon, {
      color: '#ffffff', size: 22, strokeWidth: 2.4,
    })).replace(
      /(<svg[^>]*>)/,
      `$1<circle cx="12" cy="12" r="11" fill="${LOCATION_ICON_COLORS[id] ?? '#64748b'}"/>`,
    );
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Unable to load ${imageId}`));
    });
    if (!map.hasImage(imageId)) map.addImage(imageId, image, { pixelRatio: 2 });
  }));

  await Promise.all(FAVORITE_ICON_DEFINITIONS.map(async ([imageId, Icon]) => {
    if (map.hasImage(imageId)) return;
    const svg = renderToStaticMarkup(createElement(Icon, {
      color: '#ffffff', size: 22, strokeWidth: 2.4,
    })).replace(
      /(<svg[^>]*>)/,
      '$1<circle cx="12" cy="12" r="11" fill="#e6a817"/>',
    );
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Unable to load ${imageId}`));
    });
    if (!map.hasImage(imageId)) map.addImage(imageId, image, { pixelRatio: 2 });
  }));
}

function locationPoiFilter() {
  return [
    'all',
    ['has', 'name'],
    ['any',
      ['in', ['get', 'class'], ['literal', LOCATION_POI_CLASSES]],
      ['in', ['get', 'subclass'], ['literal', LOCATION_POI_CLASSES]],
    ],
    ['!', ['in', ['get', 'class'], ['literal', ['bus', 'railway']]]],
  ] as unknown as FilterSpecification;
}

function locationPoiLayers() {
  const source = OPENFREEMAP_SOURCE_ID;
  const sourceLayer = 'poi';
  const before = 'global-road-labels';
  const iconPairs = [
    ...LOCATION_ICON_DEFINITIONS.flatMap(([id]) => [id, `location-${id}-icon`]),
    ...LOCATION_ICON_ALIASES.flatMap(([alias, id]) => [alias, `location-${id === 'ticket' ? 'theatre' : id}-icon`]),
  ];
  const iconImage = [
    'match', ['get', 'class'],
    ...iconPairs,
    ['match', ['get', 'subclass'], ...iconPairs, 'location-shop-icon'],
  ];
  return {
    before,
    layers: [
      {
        id: 'location-poi-icons', type: 'symbol' as const, source, 'source-layer': sourceLayer,
        minzoom: 13.5, maxzoom: 15.5, filter: locationPoiFilter(),
        layout: {
          'icon-image': iconImage as unknown as ExpressionSpecification,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13.5, 1.2, 17, 1.5] as ExpressionSpecification,
          'icon-padding': 7,
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
          'symbol-sort-key': locationPriorityExpression(),
        },
      },
      {
        id: 'location-poi-labels', type: 'symbol' as const, source, 'source-layer': sourceLayer,
        minzoom: 15.5, filter: locationPoiFilter(),
        layout: {
          'icon-image': iconImage as unknown as ExpressionSpecification,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 15.5, 1.2, 18, 1.5] as ExpressionSpecification,
          'icon-padding': 5,
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
          'text-field': ['get', 'name'] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 10, 18, 13] as ExpressionSpecification,
          'text-offset': [0, 1.35] as [number, number],
          'text-anchor': 'top' as const,
          'text-padding': 7,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          // Icons remain useful when a label cannot fit; priority places the
          // most useful destinations before ordinary retail points.
          'text-optional': true,
          'symbol-sort-key': locationPriorityExpression(),
        },
        paint: {
          'text-color': MAP_COLORS.label,
          'text-halo-color': MAP_COLORS.labelHalo,
          'text-halo-width': 1.3,
        },
      },
    ],
  };
}

function searchResultIconExpression() {
  const icons = [
    ...LOCATION_ICON_DEFINITIONS.flatMap(([id]) => [id, `location-${id}-icon`]),
    ...LOCATION_ICON_ALIASES.flatMap(([alias, id]) => [alias, `location-${id === 'ticket' ? 'theatre' : id}-icon`]),
  ];
  return ['match', ['get', 'iconId'], ...icons, 'location-shop-icon'] as unknown as ExpressionSpecification;
}

function createWaterPattern(size: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  const shadow = [92, 171, 194];
  const highlight = [157, 216, 227];
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
        0, 0,
        5, 0,
        7, 0.025,
        10, 0.08,
        14, 0.12,
        18, 0.17,
      ],
    },
  };
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const treeRefreshRef = useRef<(() => void) | null>(null);
  const treeLayerRef = useRef<TreeModelLayer | null>(null);
  const transitStopsLayerRef = useRef<TransitStopsLayer | null>(null);
  const plannedVehicleTripRef = useRef<string | null>(null);
  const terrainSourceRef = useRef('terrain');
  const terrainEnabledRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [orientationChanged, setOrientationChanged] = useState(false);
  const [selectedTransitStop, setSelectedTransitStop] = useState<(TransitStopSelection & { favoriteId?: string }) | null>(null);
  const [transitDepartureDetailOpen, setTransitDepartureDetailOpen] = useState(false);
  const [transitNavigationBackSignal, setTransitNavigationBackSignal] = useState(0);
  const vehicleFollowEnabledRef = useRef(false);
  const latestVehiclePoseRef = useRef<TransitVehiclePose | null>(null);
  const [vehicleFollowing, setVehicleFollowing] = useState(false);
  const [vehicleFollowAvailable, setVehicleFollowAvailable] = useState(false);
  const userLocationRef = useRef<[number, number] | null>(null);
  const userLocationWatchRef = useRef<number | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapToolNotice, setMapToolNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PhotonFeature[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [staleRefreshSignal, setStaleRefreshSignal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResultsQuery, setSearchResultsQuery] = useState('');
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);
  const favoritesRef = useRef(favorites);
  const [pendingFavorite, setPendingFavorite] = useState<{
    selection: LocationSelection;
    provider?: string;
    providerId?: string;
  } | null>(null);
  const [highlightedSearchResults, setHighlightedSearchResults] = useState<PhotonFeature[]>([]);
  const pendingSearchSubmitRef = useRef<string | null>(null);
  const lastSearchFitRef = useRef('');
  const selectedSearchQueryRef = useRef<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationSelection | null>(null);
  const [locationDetailsLoading, setLocationDetailsLoading] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>('pedestrian');
  const [routeOpen, setRouteOpen] = useState(false);
  const [routePicking, setRoutePicking] = useState<'origin' | 'destination' | null>(null);
  const [routeSearchTarget, setRouteSearchTarget] = useState<'origin' | 'destination' | null>(null);
  const [routeContextMenu, setRouteContextMenu] = useState<{ x: number; y: number; coordinates: [number, number] } | null>(null);
  const [contextMenuMarker, setContextMenuMarker] = useState<[number, number] | null>(null);
  const [positionInformation, setPositionInformation] = useState<{ coordinates: [number, number]; elevation: ElevationState; favoriteId?: string } | null>(null);
  const elevationRequestRef = useRef(0);
  const measurementControllerRef = useRef<DistanceMeasurementController | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [routeOriginSelection, setRouteOriginSelection] = useState<LocationSelection | null>(null);
  const [routeDestinationSelection, setRouteDestinationSelection] = useState<LocationSelection | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [transitRouteOptions, setTransitRouteOptions] = useState<TransitRouteResult[]>([]);
  const [selectedTransitRouteIndex, setSelectedTransitRouteIndex] = useState(0);
  const [transitDetailsOpen, setTransitDetailsOpen] = useState(false);
  const [transitTimeMode, setTransitTimeMode] = useState<'depart' | 'arrive'>('depart');
  const [transitDateTime, setTransitDateTime] = useState(() => localDateTimeValue());
  const [transitTimeControlsOpen, setTransitTimeControlsOpen] = useState(false);
  const routeSheet = useMobileBottomSheet('half');
  const locationSheet = useMobileBottomSheet('half');
  const routeSheetCollapsed = routeSheet.snap === 'collapsed';
  const setRouteSheetCollapsed = (collapsed: boolean | ((current: boolean) => boolean)) => {
    const next = typeof collapsed === 'function' ? collapsed(routeSheet.snap === 'collapsed') : collapsed;
    routeSheet.setSnap(next ? 'collapsed' : 'half');
  };
  const pendingSearchCameraRef = useRef<[number, number] | null>(null);
  const routeCameraRequestRef = useRef(0);
  const routeOriginRef = useRef<[number, number] | null>(null);
  const routeDestinationRef = useRef<[number, number] | null>(null);
  const routePickingRef = useRef<'origin' | 'destination' | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const locationDetailsAbortRef = useRef<AbortController | null>(null);
  const nominatimCacheRef = useRef(new globalThis.Map<string, Partial<LocationSelection>>());
  const transitSearchCacheRef = useRef(new globalThis.Map<string, PhotonFeature[]>());
  const nominatimLastRequestRef = useRef(0);
  const [layerToggles, setLayerToggles] = useState<MapLayerState>(() => {
    const mobileDefault2d = typeof window !== 'undefined' && window.innerWidth <= 760;
    const defaults: MapLayerState = {
      globe: true,
      trees: !mobileDefault2d,
      buildings: !mobileDefault2d,
      terrain: !mobileDefault2d,
      transit: true,
      transitModels: !mobileDefault2d,
    };
    try {
      const saved = JSON.parse(window.localStorage.getItem(LAYER_STORAGE_KEY) ?? 'null') as Partial<MapLayerState> | null;
      return saved ? { ...defaults, ...saved } : defaults;
    } catch { return defaults; }
  });
  const is3dMode = layerToggles.terrain
    && layerToggles.buildings
    && layerToggles.trees
    && layerToggles.transitModels;

  useEffect(() => {
    favoritesRef.current = favorites;
    try { saveFavorites(favorites); } catch { /* local storage can be disabled */ }
  }, [favorites]);

  useEffect(() => {
    if (!positionInformation) return;
    if (!is3dMode) {
      setPositionInformation((current) => current && current.elevation.status !== 'unavailable'
        ? { ...current, elevation: { status: 'unavailable' } }
        : current);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const request = ++elevationRequestRef.current;
    const controller = new AbortController();
    const coordinates = positionInformation.coordinates;
    void queryTerrainElevation(
      map,
      coordinates,
      terrainSourceRef.current,
      () => terrainEnabledRef.current,
      controller.signal,
    ).then((value) => {
      if (request !== elevationRequestRef.current) return;
      setPositionInformation((current) => current && current.coordinates === coordinates
        ? { ...current, elevation: elevationResult(value) }
        : current);
    }).catch((error: unknown) => {
      if ((error as Error).name !== 'AbortError' && request === elevationRequestRef.current) {
        setPositionInformation((current) => current && current.coordinates === coordinates
          ? { ...current, elevation: { status: 'unavailable' } }
          : current);
      }
    });
    return () => {
      elevationRequestRef.current += 1;
      controller.abort();
    };
  }, [positionInformation?.coordinates, is3dMode]);

  const favoriteFeatures = orderedFavorites(favorites, favoritesOpen ? '' : searchQuery).map((favorite): PhotonFeature => ({
    geometry: { coordinates: favorite.coordinates },
    properties: {
      name: favorite.name,
      city: favorite.address,
      class: favorite.category,
      favoriteId: favorite.id,
      transitStopId: favorite.transitStopId ?? (favorite.provider === 'transit' ? favorite.providerId?.split(':').slice(1).join(':') : undefined),
      transitProvider: (favorite.transitProvider ?? (favorite.provider === 'transit'
        ? favorite.providerId?.split(':')[0]
        : undefined)) as TransitProviderId | undefined,
      transitMode: favorite.transitMode,
      favoriteEntityType: favorite.entityType,
    },
  }));
  const displayedSearchResults = [
    ...favoriteFeatures,
    ...(!favoritesOpen && searchQuery.trim().length >= 2 ? searchResults : []),
  ].filter((feature, index, all) => all.findIndex((candidate) => (
    candidate.geometry.coordinates.join(',') === feature.geometry.coordinates.join(',')
  )) === index).slice(0, 8);

  const saveSelection = (selection: LocationSelection, provider?: string, providerId?: string) => {
    setPendingFavorite({ selection, provider, providerId });
  };

  const confirmFavoriteKind = (kind: FavoriteKind) => {
    if (!pendingFavorite) return;
    const { selection, provider, providerId } = pendingFavorite;
    const suggested = selection.name === 'Map point'
      ? `${selection.coordinates[1].toFixed(5)}, ${selection.coordinates[0].toFixed(5)}`
      : selection.name;
    const name = kind === 'favorite'
      ? window.prompt('Name this favourite', suggested)?.trim()
      : kind === 'home' ? 'Home' : 'Work';
    if (!name) return;
    setFavorites((current) => upsertFavorite(current, {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      name,
      coordinates: selection.coordinates,
      category: selection.category,
      address: selection.address,
      provider,
      providerId,
      iconId: selection.iconId,
      entityType: selection.transitStopId ? 'transit-stop' : selection.osmId ? 'place' : 'position',
      transitStopId: selection.transitStopId,
      transitProvider: selection.transitStopProvider,
      transitMode: selection.transitMode,
      osmType: selection.osmType,
      osmId: selection.osmId,
      openingHours: selection.openingHours,
      phone: selection.phone,
      email: selection.email,
      website: selection.website,
      kind,
      createdAt: Date.now(),
    }));
    setPendingFavorite(null);
    setContextMenuMarker(null);
  };

  const editFavorite = (favorite: Favorite) => {
    const name = window.prompt('Rename favourite', favorite.name)?.trim();
    if (name) setFavorites((current) => current.map((item) => item.id === favorite.id ? { ...item, name } : item));
  };

  const navigationView = measurement ? 'measurement'
    : transitDepartureDetailOpen ? 'transit-trip'
    : selectedTransitStop ? 'departures'
      : transitDetailsOpen ? 'route-steps'
        : routeSearchTarget ? 'route-search'
          : routeResult && routeOpen ? 'route-result'
            : routeOpen ? 'route'
              : selectedLocation ? 'place'
                : layersOpen ? 'layers'
                  : searchOpen ? 'search' : null;

  useInAppNavigation(navigationView, (parentView) => {
    if (measurement) { stopMeasurement(); return; }
    if (transitDepartureDetailOpen) {
      setTransitNavigationBackSignal((value) => value + 1);
      return;
    }
    if (selectedTransitStop) {
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
      setVehicleFollowAvailable(false);
      transitStopsLayerRef.current?.clearSelection();
      setSelectedTransitStop(null);
      if (parentView === 'search') setSearchOpen(true);
      return;
    }
    if (transitDetailsOpen) { setTransitDetailsOpen(false); return; }
    if (routeSearchTarget) { setRouteSearchTarget(null); return; }
    if (routeResult && routeOpen) {
      setRouteResult(null);
      setRouteGeometry(null);
      return;
    }
    if (routeOpen) { cancelRoute(); return; }
    if (selectedLocation) {
      setSelectedLocation(null);
      if (parentView === 'search') setSearchOpen(true);
      (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [],
      });
      return;
    }
    if (layersOpen) { setLayersOpen(false); return; }
    if (searchOpen) { setSearchOpen(false); }
  });

  const setRouteGeometry = (result: RouteResult | null) => {
    const source = mapRef.current?.getSource('selected-route') as { setData: (data: unknown) => void } | undefined;
    if (!result) {
      source?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const legFeatures = result.transitLegs?.filter((leg) => leg.geometry && leg.geometry.coordinates.length > 1).map((leg) => ({
      type: 'Feature',
      geometry: leg.geometry,
      properties: { mode: leg.mode },
    })) ?? [];
    source?.setData(legFeatures.length
      ? { type: 'FeatureCollection', features: legFeatures }
      : { type: 'Feature', geometry: result.geometry, properties: {} });
  };

  const setRoutePoints = () => {
    const source = mapRef.current?.getSource('route-endpoints') as { setData: (data: unknown) => void } | undefined;
    const features = [
      routeOriginRef.current && routeOriginSelection
        ? { type: 'Feature', geometry: { type: 'Point', coordinates: routeOriginRef.current }, properties: { kind: 'origin', label: routeOriginSelection.name } }
        : null,
      routeDestinationRef.current && routeDestinationSelection
        ? { type: 'Feature', geometry: { type: 'Point', coordinates: routeDestinationRef.current }, properties: { kind: 'destination', label: routeDestinationSelection.name } }
        : null,
    ].filter(Boolean);
    source?.setData({ type: 'FeatureCollection', features });
  };

  const fitRouteInView = (result: RouteResult) => {
    const map = mapRef.current;
    const coordinates = [
      ...routeCoordinates(result),
      routeOriginRef.current,
      routeDestinationRef.current,
    ].filter(isValidCoordinate);
    if (!map || coordinates.length < 2 || map.getContainer().clientWidth === 0 || map.getContainer().clientHeight === 0) return;
    const bounds = coordinateBounds(coordinates);
    if (!bounds) return;
    const padding = panelViewportPadding(map, 48, 24);
    const mapRect = map.getContainer().getBoundingClientRect();
    const panelRect = document.querySelector<HTMLElement>('.route-panel')?.getBoundingClientRect();
    const camera = map.cameraForBounds(
      [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
      { padding, maxZoom: 15, pitch: map.getPitch(), bearing: map.getBearing() },
    );
    console.debug('[route-camera]', { coordinateCount: coordinates.length, bounds, mapRect, panelRect, padding, camera });
    if (!camera) return;
    map.stop();
    map.easeTo({ ...camera, duration: 900 });
  };

  const scheduleRouteFit = (result: RouteResult) => {
    const request = ++routeCameraRequestRef.current;
    // The route panel may be entering, expanding, or collapsing. Wait for its
    // actual CSS animations and two layout frames rather than starting several
    // fits whose map.stop() calls interrupt each other.
    const panels = [...document.querySelectorAll<HTMLElement>('.route-panel')];
    const animations = panels.flatMap((panel) => panel.getAnimations({ subtree: true }));
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (routeCameraRequestRef.current !== request) return;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (routeCameraRequestRef.current !== request) return;
        mapRef.current?.resize();
        fitRouteInView(result);
      }));
    });
  };

  const fitRouteNow = (result: RouteResult) => {
    if (window.innerWidth <= 760) setRouteSheetCollapsed(true);
    scheduleRouteFit(result);
  };

  const showTransitLegVehicle = (result: RouteResult) => {
    if (routeMode !== 'transit') return;
    const now = Date.now();
    const vehicleLegs = result.transitLegs?.filter((candidate) => (
      candidate.tripId && !['WALK', 'FOOT'].includes(candidate.mode)
    )) ?? [];
    const leg = vehicleLegs.find((candidate) => {
      const start = candidate.startTime ? Date.parse(candidate.startTime) : NaN;
      const end = candidate.endTime ? Date.parse(candidate.endTime) : NaN;
      return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end;
    }) ?? vehicleLegs.find((candidate) => {
      const start = candidate.startTime ? Date.parse(candidate.startTime) : NaN;
      return Number.isFinite(start) && now < start;
    });
    const nextTripKey = leg?.tripId
      ? `${leg.provider}:${leg.tripId}:${leg.serviceDate ?? ''}:${leg.startTime ?? ''}`
      : null;
    if (plannedVehicleTripRef.current === nextTripKey) return;
    plannedVehicleTripRef.current = nextTripKey;
    vehicleFollowEnabledRef.current = false;
    setVehicleFollowing(false);
    setVehicleFollowAvailable(false);
    if (leg?.tripId) {
      void transitStopsLayerRef.current?.selectTrip(
        leg.tripId,
        leg.mode,
        MAP_COLORS.transitBlue,
        false,
        leg.provider ?? 'transitous',
        leg.serviceDate,
        leg.startTime && leg.geometry?.coordinates[0] ? {
          stopId: `route-origin:${leg.tripId}`,
          coordinates: leg.geometry.coordinates[0] as [number, number],
          departure: leg.startTime,
        } : undefined,
      );
    } else {
      transitStopsLayerRef.current?.clearTrip();
    }
  };

  useEffect(() => {
    if (!routeResult || routeMode !== 'transit') return;
    const timer = window.setInterval(() => showTransitLegVehicle(routeResult), 30_000);
    return () => window.clearInterval(timer);
  }, [routeMode, routeResult]);

  const requestRoute = async (origin: [number, number], destination: [number, number]) => {
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setRouteLoading(true);
    setRouteError(null);
    setTransitRouteOptions([]);
    setSelectedTransitRouteIndex(0);
    setTransitDetailsOpen(false);
    setRouteSheetCollapsed(false);
    try {
      let result: RouteResult;
      if (routeMode === 'transit') {
        const options = await fetchTransitRoutes(origin, destination, {
          originStopId: routeOriginSelection?.transitStopId,
          originStopProvider: routeOriginSelection?.transitStopProvider,
          destinationStopId: routeDestinationSelection?.transitStopId,
          destinationStopProvider: routeDestinationSelection?.transitStopProvider,
          time: transitDateTime ? new Date(transitDateTime).toISOString() : undefined,
          arriveBy: transitTimeMode === 'arrive',
          signal: controller.signal,
        });
        if (!options[0]) throw new Error('No transit route options were returned');
        setTransitRouteOptions(options);
        result = options[0];
      } else {
        result = await fetchValhallaRoute(origin, destination, routeMode, controller.signal);
      }
      if (controller.signal.aborted) return;
      setRouteResult(result);
      showTransitLegVehicle(result);
      setRouteGeometry(result);
      scheduleRouteFit(result);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setRouteResult(null);
        setRouteGeometry(null);
        setRouteError((error as Error).message || 'Could not calculate a route');
      }
    } finally {
      if (!controller.signal.aborted) setRouteLoading(false);
    }
  };

  const selectTransitRoute = (index: number) => {
    const option = transitRouteOptions[index];
    if (!option) return;
    setSelectedTransitRouteIndex(index);
    setRouteResult(option);
    showTransitLegVehicle(option);
    setRouteGeometry(option);
    scheduleRouteFit(option);
  };

  const openRoute = () => {
    stopMeasurement();
    const isMobile = window.innerWidth <= 760;
    routeSheet.setSnap('half');
    setRouteContextMenu(null);
    setRouteOpen(true);
    setLayersOpen(false);
    setRouteError(null);
    setSearchOpen(false);
    setSearchQuery('');
    setHighlightedSearchResults([]);
    if (isMobile) {
      transitStopsLayerRef.current?.clearSelection();
      setSelectedTransitStop(null);
    }
    vehicleFollowEnabledRef.current = false;
    setVehicleFollowing(false);
    setVehicleFollowAvailable(false);
    const availableGps = availableGpsEndpoint(userLocationRef.current);
    if (!routeOriginSelection && availableGps) {
      routeOriginRef.current = availableGps.coordinates;
      setRouteOriginSelection(availableGps);
    }
    if (isMobile) {
      setSelectedLocation(null);
      locationDetailsAbortRef.current?.abort();
      (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [],
      });
    }
  };

  const selectYourLocation = (kind: 'origin' | 'destination') => {
    setRouteError(null);
    const applyLocation = (coordinates: [number, number]) => {
      userLocationRef.current = coordinates;
      (mapRef.current?.getSource('user-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { kind: 'gps' } }],
      });
      setRouteEndpoint(kind, { name: 'Your location', category: 'Current location', coordinates, source: 'map' });
    };
    if (userLocationRef.current) {
      applyLocation(userLocationRef.current);
      return;
    }
    if (!navigator.geolocation) {
      setRouteError('Your location is not available in this browser. Choose another point.');
      return;
    }
    setRouteLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setRouteLoading(false);
        applyLocation([coords.longitude, coords.latitude]);
        if (userLocationWatchRef.current === null) {
          userLocationWatchRef.current = navigator.geolocation.watchPosition(
            ({ coords: update }) => {
              const coordinates: [number, number] = [update.longitude, update.latitude];
              userLocationRef.current = coordinates;
              (mapRef.current?.getSource('user-location') as { setData: (data: unknown) => void } | undefined)?.setData({
                type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { kind: 'gps' } }],
              });
            },
            () => undefined,
            { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
          );
        }
      },
      () => {
        setRouteLoading(false);
        setRouteError('We could not access your location. Choose another point or try again.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const setRouteEndpoint = (kind: 'origin' | 'destination', selection: LocationSelection) => {
    if (kind === 'origin') {
      routeOriginRef.current = selection.coordinates;
      setRouteOriginSelection(selection);
    } else {
      routeDestinationRef.current = selection.coordinates;
      setRouteDestinationSelection(selection);
    }
    setRouteOpen(true);
    routeSheet.setSnap('half');
    setRoutePicking(null);
    setRouteSearchTarget(null);
    routePickingRef.current = null;
    setRouteResult(null);
    setRouteError(null);
    setRouteGeometry(null);
    setRoutePoints();
  };

  const pickRouteEndpoint = (kind: 'origin' | 'destination') => {
    routeAbortRef.current?.abort();
    setRouteOpen(true);
    routeSheet.setSnap('half');
    setRoutePicking(kind);
    setRouteSearchTarget(null);
    routePickingRef.current = kind;
    setRouteResult(null);
    setRouteError(null);
    setRouteGeometry(null);
    setRoutePoints();
  };

  const calculateRoute = () => {
    const destination = routeDestinationRef.current;
    if (!destination) return;
    if (!routeOriginRef.current && routeOriginSelection?.name === 'Your location') {
      if (!navigator.geolocation) {
        setRouteError('Your location is not available in this browser.');
        return;
      }
      if (userLocationWatchRef.current === null) {
        userLocationWatchRef.current = navigator.geolocation.watchPosition(({ coords }) => {
          const coordinates: [number, number] = [coords.longitude, coords.latitude];
          userLocationRef.current = coordinates;
          (mapRef.current?.getSource('user-location') as { setData: (data: unknown) => void } | undefined)?.setData({
            type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} }],
          });
        }, () => undefined, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
      }
      setRouteLoading(true);
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const origin: [number, number] = [coords.longitude, coords.latitude];
          routeOriginRef.current = origin;
          setRoutePoints();
          void requestRoute(origin, destination);
        },
        () => {
          setRouteLoading(false);
          setRouteError('We could not access your location. Choose a starting point instead.');
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }
    const origin = routeOriginRef.current;
    if (origin && destination) void requestRoute(origin, destination);
  };

  const beginRouteSearch = (kind: 'origin' | 'destination') => {
    routePickingRef.current = kind;
    setRoutePicking(null);
    setRouteSearchTarget(kind);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    setSearchOpen(false);
  };

  const cancelRoute = () => {
    routeAbortRef.current?.abort();
    vehicleFollowEnabledRef.current = false;
    setVehicleFollowing(false);
    transitStopsLayerRef.current?.clearTrip();
    routeOriginRef.current = null;
    routeDestinationRef.current = null;
    setRouteOriginSelection(null);
    setRouteDestinationSelection(null);
    routePickingRef.current = null;
    setRouteOpen(false);
    setRouteMode('pedestrian');
    setTransitTimeMode('depart');
    setTransitDateTime(localDateTimeValue());
    setTransitTimeControlsOpen(false);
    setTransitRouteOptions([]);
    setSelectedTransitRouteIndex(0);
    setTransitDetailsOpen(false);
    setRouteSheetCollapsed(false);
    setRoutePicking(null);
    setRouteSearchTarget(null);
    setRouteLoading(false);
    setRouteResult(null);
    setRouteError(null);
    setRouteGeometry(null);
    selectedSearchQueryRef.current = null;
    setSearchQuery('');
    setSearchResults([]);
    setSearchOpen(false);
    setRouteContextMenu(null);
  };

  function stopMeasurement() {
    measurementControllerRef.current?.dispose();
    measurementControllerRef.current = null;
    setMeasurement(null);
  }

  function startMeasurement(start: [number, number]) {
    const map = mapRef.current;
    if (!map) return;
    cancelRoute();
    stopMeasurement();
    setPositionInformation(null);
    setSelectedLocation(null);
    setSelectedTransitStop(null);
    setRouteContextMenu(null);
    setContextMenuMarker(null);
    measurementControllerRef.current = new DistanceMeasurementController(map, start, setMeasurement);
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const savedView = loadPersistedMapView();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: GLOBAL_MAP_STYLE,
      center: savedView?.center ?? TAMPERE,
      zoom: savedView?.zoom ?? 2.2,
      pitch: savedView?.pitch ?? 0,
      bearing: savedView?.bearing ?? 0,
      // MapLibre line layers are screen-space strokes. At extreme pitch the
      // perspective projection makes foreground roads look disproportionately
      // wide; keep the line-based mode readable until polygon roads return.
      maxPitch: 55,
      // Keep the default view focused on an area a few hundred metres across;
      // closer views make screen-space MapLibre roads dominate the scene.
      maxZoom: 18,
      attributionControl: {
        compact: true,
        customAttribution: '<a href="https://digitransit.fi/" target="_blank" rel="noreferrer">Finnish transit data by Digitransit</a> · <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transit data by Transitous</a>',
      },
    });

    const treeLayer = new TreeModelLayer({
      sourceId: OPENFREEMAP_SOURCE_ID,
      waterLayers: ['water'],
      vegetationLayers: ['landcover', 'landuse', 'park'],
    });
    treeLayerRef.current = treeLayer;
    const transitVehicleLayer = new TransitVehicleModelLayer();
    const transitStopsLayer = new TransitStopsLayer((pose) => {
      latestVehiclePoseRef.current = pose;
      // Keep the custom model layer synchronized with the same estimated pose
      // used by the map marker and follow camera. Layer visibility decides
      // whether the model is rendered; clearing the pose here prevents the
      // 3D vehicles toggle from ever having anything to display.
      transitVehicleLayer.setPose(pose);
      setVehicleFollowAvailable(Boolean(pose));
      if (!pose || !vehicleFollowEnabledRef.current) return;
      const vehicle = pose.parts[Math.floor(pose.parts.length / 2)];
      // Keep camera tracking independent of style loading/animation state.
      // The vehicle pose is updated on every timer tick, so setCenter avoids
      // a queue of interrupted easeTo animations and follows the tram exactly.
      map.setCenter(followCameraCenter(map, vehicle.coordinates));
      if (map.getZoom() < 14.6) map.setZoom(14.6);
    });
    transitStopsLayerRef.current = transitStopsLayer;
    let treeUpdateTimer: number | undefined;
    let transitStopsTimer: number | undefined;
    let initialLoadComplete = false;
    let roadWidthLatitude: number | undefined;
    let globalLabelDensitySignature: string | undefined;
    let previousOrientationChanged = false;
    let modelDataRevision = 0;
    let lastModelUpdateSignature: string | undefined;
    const modelVectorSourceId = OPENFREEMAP_SOURCE_ID;

    const updateGlobalRoadWidths = () => {
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
      if (!map.isStyleLoaded()) return;
      const pitch = map.getPitch();
      const zoom = map.getZoom();
      const pitchBucket = pitch >= 40 ? 2 : pitch >= 25 ? 1 : 0;
      const zoomBucket = zoom >= 16 ? 2 : zoom >= 14 ? 1 : 0;
      const nextBucket = Math.max(pitchBucket, zoomBucket);
      const regionalLabelFade = Math.min(1, Math.max(0, (zoom - 6) / 1.25));
      const nextSignature = `${nextBucket}:${Math.round(regionalLabelFade * 10)}`;
      if (globalLabelDensitySignature === nextSignature) return;
      globalLabelDensitySignature = nextSignature;

      const opacityByLayer: Array<[string, [number, number, number]]> = [
        ['global-transit-line-labels', [1, 1, 1]],
        ['global-cycleway-labels', [1, 1, 1]],
        ['global-road-labels', [regionalLabelFade, 0.78 * regionalLabelFade, 0.5 * regionalLabelFade]],
        ['global-water-labels', [regionalLabelFade, regionalLabelFade, regionalLabelFade]],
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
      treeLayer.updateTrees();
      lastModelUpdateSignature = nextSignature;
    };
    const scheduleTreeUpdate = () => {
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      treeUpdateTimer = window.setTimeout(updateTreeModels, 120);
    };
    const updateTransitStops = () => {
      transitStopsTimer = undefined;
      if (!map.isStyleLoaded()) return;
      if (map.getZoom() < 9) {
        transitStopsLayer.clear();
        return;
      }
      void transitStopsLayer.update(map.getBounds(), map.getZoom());
    };
    const scheduleTransitStopsUpdate = () => {
      if (transitStopsTimer !== undefined) window.clearTimeout(transitStopsTimer);
      transitStopsTimer = window.setTimeout(updateTransitStops, 220);
    };
    const invalidateAndScheduleModels = () => {
      modelDataRevision += 1;
      scheduleTreeUpdate();
    };
    const handleModelSourceData = (event: MapSourceDataEvent) => {
      if (event.sourceId !== modelVectorSourceId || event.sourceDataType !== 'content') return;
      modelDataRevision += 1;
    };
    treeRefreshRef.current = invalidateAndScheduleModels;
    const handleLocationClick = (event: { point: Point }) => {
      setRouteContextMenu(null);
      if (!positionInformation && !pendingFavorite) setContextMenuMarker(null);
      const locationLayers = ['favorite-icons', 'search-result-icons', 'location-poi-icons', 'location-poi-labels', 'selected-location-icon'];
      const feature = map.queryRenderedFeatures(event.point, { layers: locationLayers })[0];
      if (routePickingRef.current) {
        const kind = routePickingRef.current;
        const destination = feature && feature.layer.id !== 'selected-location-icon'
          ? locationSelectionFromFeature(feature).coordinates
          : [map.unproject(event.point).lng, map.unproject(event.point).lat] as [number, number];
        const selection: LocationSelection = feature && feature.layer.id !== 'selected-location-icon'
          ? locationSelectionFromFeature(feature)
          : { name: 'Map point', category: 'Pinned location', coordinates: destination, source: 'map' };
        setRouteEndpoint(kind, selection);
        return;
      }
      if (!feature || feature.layer.id === 'selected-location-icon') return;
      const favoriteId = typeof feature.properties?.favoriteId === 'string' ? feature.properties.favoriteId : undefined;
      const favorite = favoriteId ? favoritesRef.current.find((item) => item.id === favoriteId) : undefined;
      const favoriteEntityType = favorite ? resolvedFavoriteEntityType(favorite) : undefined;
      if (favorite && favoriteEntityType === 'position') {
        setPositionInformation({ coordinates: favorite.coordinates, elevation: { status: 'loading' }, favoriteId: favorite.id });
        return;
      }
      const selection = locationSelectionFromFeature(feature);
      if (favorite) Object.assign(selection, {
        name: favorite.name, category: favorite.category, address: favorite.address,
        iconId: favorite.iconId, favoriteId: favorite.id, osmType: favorite.osmType, osmId: favorite.osmId,
        openingHours: favorite.openingHours, phone: favorite.phone, email: favorite.email, website: favorite.website,
        transitStopId: favorite.transitStopId ?? (favorite.provider === 'transit' ? favorite.providerId?.split(':').slice(1).join(':') : undefined),
        transitStopProvider: (favorite.transitProvider ?? (favorite.provider === 'transit' ? favorite.providerId?.split(':')[0] : undefined)) as TransitProviderId | undefined,
      });
      if (selection.coordinates[0] === 0 && selection.coordinates[1] === 0) return;
      if (selection.transitStopId) {
        const stop: TransitStopSelection & { favoriteId?: string } = {
          stopId: selection.transitStopId,
          name: selection.name,
          mode: selection.transitStopProvider ? String(feature.properties.transitMode ?? 'TRANSIT').split(',')[0] : 'TRANSIT',
          coordinates: selection.coordinates,
          provider: selection.transitStopProvider ?? 'transitous',
          favoriteId: favorite?.id,
        };
        transitStopsLayerRef.current?.selectSearchStop(stop);
        setSelectedTransitStop(stop);
        setSelectedLocation(null);
        return;
      }
      transitStopsLayerRef.current?.clearSelection();
      setSelectedTransitStop(null);
      setSelectedLocation(selection);
      void enrichLocationDetails(selection);
      const selectedSource = map.getSource('selected-location') as { setData: (data: unknown) => void } | undefined;
      selectedSource?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: selection.coordinates }, properties: {} }],
      });
    };
    let longPressTimer: number | undefined;
    let longPressStart: { x: number; y: number } | undefined;
    const activeLongPressPointers = new Set<number>();
    let multiPointerGestureActive = false;
    let lastTouchOrPenInteractionAt = 0;
    const supportsLongPress = (event: PointerEvent) => (
      event.pointerType === 'touch' || event.pointerType === 'pen'
    );
    const cancelLongPressTimer = () => {
      if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
      longPressStart = undefined;
    };
    const showRouteContextMenu = (point: Point, coordinates: [number, number]) => {
      const container = map.getContainer();
      setContextMenuMarker(coordinates);
      setRouteContextMenu({
        x: Math.min(Math.max(point.x, 12), container.clientWidth - 220),
        y: Math.min(Math.max(point.y, 12), container.clientHeight - 130),
        coordinates,
      });
    };
    const handleMapContextMenu = (event: MapMouseEvent) => {
      event.originalEvent.preventDefault();
      // Touch and pen long-presses are handled explicitly below. MapLibre/browser
      // contextmenu events can also arrive during a pinch, so never turn a
      // pointer-generated contextmenu event into a second route menu.
      if (('pointerType' in event.originalEvent
          && (event.originalEvent.pointerType === 'touch' || event.originalEvent.pointerType === 'pen'))
        || Date.now() - lastTouchOrPenInteractionAt < 1000) return;
      showRouteContextMenu(event.point, [event.lngLat.lng, event.lngLat.lat]);
    };
    const handlePointerDown = (event: PointerEvent) => {
      // Let manual map gestures take ownership from vehicle following.
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
      if (!supportsLongPress(event)) return;
      lastTouchOrPenInteractionAt = Date.now();
      activeLongPressPointers.add(event.pointerId);
      if (activeLongPressPointers.size > 1) {
        // A second contact means this is a pinch/rotate gesture, never a
        // long-press. This also covers the common case where the second
        // pointer does not move far enough to trip the movement threshold.
        multiPointerGestureActive = true;
        cancelLongPressTimer();
        return;
      }
      multiPointerGestureActive = false;
      longPressStart = { x: event.clientX, y: event.clientY };
      longPressTimer = window.setTimeout(() => {
        if (multiPointerGestureActive || activeLongPressPointers.size !== 1) {
          cancelLongPressTimer();
          return;
        }
        const rect = map.getCanvas().getBoundingClientRect();
        const point = new maplibregl.Point(event.clientX - rect.left, event.clientY - rect.top);
        const lngLat = map.unproject(point);
        showRouteContextMenu(point, [lngLat.lng, lngLat.lat]);
        longPressTimer = undefined;
      }, 600);
    };
    const handleWheel = () => {
      cancelLongPressTimer();
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
    };
    const cancelLongPress = (event: PointerEvent) => {
      if (supportsLongPress(event) && event.type === 'pointermove' && activeLongPressPointers.size > 1) {
        multiPointerGestureActive = true;
        cancelLongPressTimer();
      } else if (longPressStart && Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 12) {
        cancelLongPressTimer();
      }
      if (event.type !== 'pointermove') {
        if (supportsLongPress(event)) activeLongPressPointers.delete(event.pointerId);
        if (activeLongPressPointers.size === 0) {
          multiPointerGestureActive = false;
          cancelLongPressTimer();
        }
      }
    };
    const handleMapGestureStart = () => cancelLongPressTimer();
    map.once('load', async () => {
      // MapLibre uses image pixelRatio when determining pattern spacing. A
      // 512px image at 0.5 therefore repeats every 1024 logical pixels,
      // providing broad variation at every zoom without a custom shader.
      map.addImage(WATER_PATTERN_ID, createWaterPattern(512), { pixelRatio: 0.5 });
      map.addLayer(globalWaterPatternLayer(), 'global-pedestrian-areas');
      map.addLayer(treeLayer, 'global-road-labels');
      map.addLayer(transitVehicleLayer, 'global-road-labels');
      try {
        await addLocationIcons(map);
      } catch (error) {
        console.warn('Location icons could not be loaded; hiding POI icons.', error);
      }
      const poiLayers = locationPoiLayers();
      map.addSource('selected-location', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('search-results', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('favorites', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('user-location', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('context-menu-location', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('selected-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('route-endpoints', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'selected-route-casing',
        type: 'line',
        source: 'selected-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'selected-route',
        type: 'line',
        source: 'selected-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match', ['get', 'mode'],
            'WALK', '#64748b', 'FOOT', '#64748b',
            'TRAM', '#8b5cf6', 'BUS', '#1769e8',
            'SUBWAY', '#f97316', 'RAIL', '#16a34a',
            'REGIONAL_RAIL', '#16a34a', '#0ea5e9',
          ] as unknown as ExpressionSpecification,
          'line-width': 5,
          'line-opacity': 0.98,
          'line-dasharray': ['match', ['get', 'mode'], 'WALK', ['literal', [1.2, 1.2]], 'FOOT', ['literal', [1.2, 1.2]], ['literal', [1, 0]]] as unknown as ExpressionSpecification,
        },
      });
      map.addLayer({
        id: 'route-endpoint-halo',
        type: 'circle',
        source: 'route-endpoints',
        paint: {
          'circle-radius': 12,
          'circle-color': '#ffffff',
          'circle-opacity': 0.98,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'route-endpoints',
        type: 'circle',
        source: 'route-endpoints',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'kind'], 'origin', '#1c9b61', '#e15858'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'context-menu-location-halo', type: 'circle', source: 'context-menu-location',
        paint: {
          'circle-radius': 13, 'circle-color': '#ffffff', 'circle-opacity': 0.98,
          'circle-stroke-color': '#64748b', 'circle-stroke-width': 2,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'context-menu-location-dot', type: 'circle', source: 'context-menu-location',
        paint: {
          'circle-radius': 7, 'circle-color': '#64748b',
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'favorite-icons',
        type: 'symbol',
        source: 'favorites',
        layout: {
          'icon-image': [
            'match', ['get', 'favoriteKind'],
            'home', 'favorite-home-icon',
            'work', 'favorite-work-icon',
            'favorite-star-icon',
          ],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 1.15, 14, 1.4, 18, 1.6],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.45],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': MAP_COLORS.label, 'text-halo-color': MAP_COLORS.labelHalo, 'text-halo-width': 1.3 },
      }, poiLayers.before);
      map.addLayer({
        id: 'search-result-halo',
        type: 'circle',
        source: 'search-results',
        paint: {
          'circle-radius': 17,
          'circle-color': '#ffffff',
          'circle-opacity': 0.96,
          'circle-stroke-color': MAP_COLORS.transitBlue,
          'circle-stroke-width': 3,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'search-result-icons',
        type: 'symbol',
        source: 'search-results',
        layout: {
          'icon-image': searchResultIconExpression(),
          'icon-size': 1.4,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.35],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': MAP_COLORS.label, 'text-halo-color': MAP_COLORS.labelHalo, 'text-halo-width': 1.3 },
      }, poiLayers.before);
      map.addLayer({
        id: 'selected-location-halo', type: 'circle', source: 'selected-location',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 18, 15],
          'circle-color': '#ffffff', 'circle-opacity': 0.95,
          'circle-stroke-color': MAP_COLORS.transitBlue, 'circle-stroke-width': 2,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'selected-location-icon', type: 'circle', source: 'selected-location',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 18, 9],
          'circle-color': MAP_COLORS.transitBlue, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'user-location-halo', type: 'circle', source: 'user-location',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 9, 14, 14, 18, 18],
          'circle-color': '#ffffff',
          'circle-opacity': 0.95,
          'circle-stroke-color': '#1769e8',
          'circle-stroke-width': 2,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'user-location-dot', type: 'circle', source: 'user-location',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 14, 6, 18, 8],
          'circle-color': '#1769e8',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      }, poiLayers.before);
      poiLayers.layers.forEach((layer) => map.addLayer(layer, poiLayers.before));
      map.on('click', handleLocationClick);
      map.on('contextmenu', handleMapContextMenu);
      const canvas = map.getCanvas();
      canvas.addEventListener('pointerdown', handlePointerDown);
      canvas.addEventListener('wheel', handleWheel, { passive: true });
      canvas.addEventListener('pointermove', cancelLongPress);
      canvas.addEventListener('pointerup', cancelLongPress);
      canvas.addEventListener('pointercancel', cancelLongPress);
      map.on('mouseenter', 'location-poi-icons', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'location-poi-icons', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'location-poi-labels', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'location-poi-labels', () => { map.getCanvas().style.cursor = ''; });
      void transitStopsLayer.install(map, (stop) => {
        setVehicleFollowAvailable(false);
        locationDetailsAbortRef.current?.abort();
        setLocationDetailsLoading(false);
        setSelectedLocation(null);
        setSelectedTransitStop(stop);
      map.easeTo({
        center: stop.coordinates,
        zoom: Math.max(map.getZoom(), 14.6),
        offset: closeRangeCameraOffset(),
        duration: 900,
        });
      }).then(() => {
        if (transitStopsLayerRef.current !== transitStopsLayer || !map.isStyleLoaded()) return;
        map.moveLayer(transitVehicleLayer.id, 'transit-estimated-vehicle-label');
        updateTransitStops();
      });
      ['global-bus-stops', 'global-railway-stations', 'global-railway-station-labels', 'global-poi-labels', 'poi-labels'].forEach((layerId) => {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
      });
      updateGlobalRoadWidths();
      updateGlobalLabelDensity();
      scheduleTreeUpdate();
      scheduleTransitStopsUpdate();
      initialLoadComplete = true;
      setMapLoaded(true);
    });
    const handleMoveEnd = () => {
      try {
        const center = map.getCenter();
        savePersistedMapView({
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
      } catch { /* local storage can be disabled */ }
      updateGlobalRoadWidths();
      scheduleTreeUpdate();
      scheduleTransitStopsUpdate();
    };
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_BACKGROUND_MS) {
        transitSearchCacheRef.current.clear();
        scheduleTransitStopsUpdate();
        setStaleRefreshSignal((value) => value + 1);
        map.triggerRepaint();
      }
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const handleCameraMove = () => {
      updateGlobalLabelDensity();
      const nextOrientationChanged = Math.abs(map.getBearing()) > 1 || map.getPitch() > 1;
      if (nextOrientationChanged !== previousOrientationChanged) {
        previousOrientationChanged = nextOrientationChanged;
        setOrientationChanged(nextOrientationChanged);
      }
    };
      map.on('move', handleCameraMove);
      map.on('moveend', handleMoveEnd);
    map.on('zoomstart', handleMapGestureStart);
    map.on('dragstart', handleMapGestureStart);
    map.on('sourcedata', handleModelSourceData);
    // Waiting for idle avoids rebuilding all custom meshes once per tile while
    // a pan/zoom is still filling the viewport. moveend handles interaction;
    // idle handles the final set of newly loaded tiles.
    map.on('idle', scheduleTreeUpdate);
    map.on('error', (event: maplibregl.ErrorEvent) => {
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
      measurementControllerRef.current?.dispose();
      measurementControllerRef.current = null;
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      if (transitStopsTimer !== undefined) window.clearTimeout(transitStopsTimer);
      map.off('move', handleCameraMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      map.off('moveend', handleMoveEnd);
      map.off('zoomstart', handleMapGestureStart);
      map.off('dragstart', handleMapGestureStart);
      map.off('sourcedata', handleModelSourceData);
      map.off('click', handleLocationClick);
      map.off('contextmenu', handleMapContextMenu);
      const canvas = map.getCanvas();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointermove', cancelLongPress);
      canvas.removeEventListener('pointerup', cancelLongPress);
      canvas.removeEventListener('pointercancel', cancelLongPress);
      if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
      map.off('mouseenter', 'location-poi-icons', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.off('mouseleave', 'location-poi-icons', () => { map.getCanvas().style.cursor = ''; });
      map.off('idle', scheduleTreeUpdate);
      transitStopsLayer.dispose();
      map.remove();
      mapRef.current = null;
      treeRefreshRef.current = null;
      treeLayerRef.current = null;
      transitStopsLayerRef.current = null;
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

    setVisibility(['tree-models-3d', 'tree-points'], layerToggles.trees);
    setVisibility(
      (map.getStyle().layers ?? [])
        .map((layer) => layer.id)
        .filter((layerId) => layerId.startsWith('transit-') && layerId !== 'transit-vehicle-model-3d'),
      layerToggles.transit,
    );
    setVisibility(['transit-vehicle-model-3d'], layerToggles.transitModels);
    setVisibility(BUILDING_3D_LAYER_IDS, layerToggles.buildings);
    setVisibility(
      [GLOBAL_BUILDING_TRANSITION_FOOTPRINT_LAYER_ID],
      layerToggles.buildings,
    );
    setVisibility([GLOBAL_BUILDING_2D_LAYER_ID], !layerToggles.buildings);
    setVisibility(
      BUILDING_SHADOW_LAYER_IDS,
      layerToggles.buildings,
    );
    treeLayerRef.current?.setShadowsEnabled(layerToggles.trees);
    setVisibility(WATER_EFFECT_LAYER_IDS, true);
    map.setProjection({ type: layerToggles.globe ? 'globe' : 'mercator' });
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
    treeRefreshRef.current?.();
    if (!layerToggles.transit) {
      transitStopsLayerRef.current?.clearSelection();
      setSelectedTransitStop(null);
    }
  }, [layerToggles, mapLoaded]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query && selectedSearchQueryRef.current === query) {
      selectedSearchQueryRef.current = null;
      return;
    }
    if (query.length < 2) {
      setSearchResults([]);
      setSearchResultsQuery('');
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({
          q: query,
          limit: '6',
          location_bias_scale: '0.2',
        });
        const map = mapRef.current;
        if (map) {
          const center = map.getCenter();
          params.set('lon', center.lng.toFixed(6));
          params.set('lat', center.lat.toFixed(6));
          params.set('zoom', String(Math.round(map.getZoom())));
        }
        const cacheKey = map
          ? `${query.toLocaleLowerCase()}|${map.getCenter().lng.toFixed(1)},${map.getCenter().lat.toFixed(1)}|${Math.floor(map.getZoom())}`
          : query.toLocaleLowerCase();
        const cachedResults = transitSearchCacheRef.current.get(cacheKey);
        if (cachedResults) {
          setSearchResults(cachedResults);
          setSearchResultsQuery(query);
          return;
        }
        const response = await fetch(
          `https://photon.komoot.io/api/?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error('Search service unavailable');
        const data = await response.json() as { features?: PhotonFeature[] };
        const photonResults = data.features ?? [];
        const transitResults: PhotonFeature[] = [];
        // Search the provider selected by the map center over an adaptive area
        // instead of downloading a country's complete stop set.
        if (map && layerToggles.transit) {
          const center = map.getCenter();
          const zoom = map.getZoom();
          const radiusDegrees = zoom >= 12 ? 0.35 : zoom >= 9 ? 0.75 : 1.5;
          try {
            const stops = await searchTransitStops(query, {
              south: Math.max(-85, center.lat - radiusDegrees),
              west: center.lng - radiusDegrees,
              north: Math.min(85, center.lat + radiusDegrees),
              east: center.lng + radiusDegrees,
            }, controller.signal);
            stops.forEach((stop) => {
              transitResults.push({
                geometry: { coordinates: stop.coordinates },
                properties: {
                  name: stop.name,
                  transitStopId: stop.stopId,
                  transitMode: stop.mode,
                  transitProvider: stop.provider,
                },
              });
            });
          } catch (transitError) {
            if ((transitError as Error).name === 'AbortError') throw transitError;
            console.warn('Transit stop search unavailable.', transitError);
          }
        }
        // Keep the list and map representation in lockstep. Photon can return
        // malformed points and transit results are prepended, so validate and
        // cap only after combining both providers.
        const results = [...transitResults, ...photonResults]
          .filter((feature) => isValidCoordinate(feature.geometry.coordinates))
          .slice(0, 6);
        transitSearchCacheRef.current.set(cacheKey, results);
        setSearchResults(results);
        setSearchResultsQuery(query);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setSearchResults([]);
          setSearchResultsQuery(query);
          setSearchError('Could not search right now');
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, layerToggles.transit]);

  useEffect(() => {
    const source = mapRef.current?.getSource('search-results') as { setData: (data: unknown) => void } | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: highlightedSearchResults.map((feature) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: feature.geometry.coordinates },
        properties: {
          ...feature.properties,
          name: photonResultLabel(feature).primary,
          iconId: locationIconId(feature.properties),
        },
      })),
    });
  }, [highlightedSearchResults, mapLoaded]);

  useEffect(() => {
    const source = mapRef.current?.getSource('favorites') as { setData: (data: unknown) => void } | undefined;
    if (!source) return;
    source.setData({ type: 'FeatureCollection', features: favoriteMapFeatures(favorites) });
  }, [favorites, mapLoaded]);

  useEffect(() => {
    const source = mapRef.current?.getSource('context-menu-location') as { setData: (data: unknown) => void } | undefined;
    source?.setData(markerFeatureCollection(contextMenuMarker, 'temporary'));
  }, [contextMenuMarker, mapLoaded]);

  const enrichLocationDetails = async (selection: LocationSelection) => {
    const lookupKey = selection.osmType && selection.osmId
      ? `lookup:${selection.osmType}${selection.osmId}`
      : `reverse:${selection.coordinates[0].toFixed(6)},${selection.coordinates[1].toFixed(6)}`;
    const cached = nominatimCacheRef.current.get(lookupKey);
    if (cached) {
      setLocationDetailsLoading(false);
      setSelectedLocation((current) => current?.coordinates.join(',') === selection.coordinates.join(',')
        ? { ...current, ...cached }
        : current);
      return;
    }

    locationDetailsAbortRef.current?.abort();
    const controller = new AbortController();
    locationDetailsAbortRef.current = controller;
    setLocationDetailsLoading(true);
    const wait = Math.max(0, 1100 - (Date.now() - nominatimLastRequestRef.current));
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, wait));
      if (controller.signal.aborted) return;
      nominatimLastRequestRef.current = Date.now();
      const params = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
      });
      const endpoint = selection.osmType && selection.osmId
        ? `https://nominatim.openstreetmap.org/lookup?osm_ids=${encodeURIComponent(`${selection.osmType}${selection.osmId}`)}&${params}`
        : `https://nominatim.openstreetmap.org/reverse?lat=${selection.coordinates[1]}&lon=${selection.coordinates[0]}&zoom=18&${params}`;
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) throw new Error('Nominatim lookup failed');
      const payload = await response.json() as Record<string, unknown> | Array<Record<string, unknown>>;
      const result = Array.isArray(payload) ? payload[0] : payload;
      if (!result) return;
      const address = result.address as Record<string, unknown> | undefined;
      const extra = result.extratags as Record<string, unknown> | undefined;
      const details = {
        address: selection.address ?? (
          [address?.house_number, address?.road, address?.city ?? address?.town]
            .filter(Boolean).join(' ') || undefined
        ),
        ...locationDetails({ ...result, ...(extra ?? {}) }),
      };
      nominatimCacheRef.current.set(lookupKey, details);
      setSelectedLocation((current) => current?.coordinates.join(',') === selection.coordinates.join(',')
        ? { ...current, ...details }
        : current);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') console.warn('Location details lookup failed.', error);
    } finally {
      if (!controller.signal.aborted) setLocationDetailsLoading(false);
    }
  };

  const selectedIconKey = selectedLocation?.iconId && (
    LOCATION_ICON_DEFINITIONS.some(([id]) => id === selectedLocation.iconId)
      ? selectedLocation.iconId
      : LOCATION_ICON_ALIASES.find(([alias]) => alias === selectedLocation.iconId)?.[1]
  ) || 'shop';
  const SelectedLocationIcon = LOCATION_ICON_DEFINITIONS.find(([id]) => id === selectedIconKey)?.[1] ?? Store;
  useEffect(() => {
    setRoutePoints();
  }, [routeOriginSelection, routeDestinationSelection, mapLoaded]);

  useEffect(() => {
    if (!routeOpen || routePicking || routeSearchTarget || !routeOriginSelection || !routeDestinationSelection) return;
    setRouteGeometry(null);
    calculateRoute();
  // Endpoint selection and travel mode are the route inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOpen, routePicking, routeSearchTarget, routeOriginSelection, routeDestinationSelection, routeMode, transitTimeMode, transitDateTime]);

  const displaySearchResults = (query: string, results: PhotonFeature[]) => {
    const map = mapRef.current;
    if (!map || !query.trim()) return;
    const validResults = results
      .filter((feature) => isValidCoordinate(feature.geometry.coordinates))
      .slice(0, 6);
    const retainedCoordinates = removeIsolatedCoordinateOutliers(
      validResults.map((feature) => feature.geometry.coordinates),
      5,
    );
    const retainedKeys = new Set(retainedCoordinates.map((coordinate) => coordinate.join(',')));
    const displayed = validResults.filter((feature) => retainedKeys.has(feature.geometry.coordinates.join(',')));
    if (!displayed.length) {
      setHighlightedSearchResults([]);
      return;
    }

    setHighlightedSearchResults(displayed);
    setSearchOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
    const coordinates = displayed.map((feature) => feature.geometry.coordinates);
    const signature = coordinates.map((coordinate) => coordinate.join(',')).join('|');
    if (signature === lastSearchFitRef.current && map.isMoving()) return;
    lastSearchFitRef.current = signature;
    map.stop();
    if (coordinates.length === 1) {
      map.easeTo({ center: coordinates[0], zoom: Math.min(15, Math.max(map.getZoom(), 14)), duration: 700 });
      return;
    }
    const bounds = coordinateBounds(coordinates);
    if (!bounds) return;
    map.fitBounds(
      [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
      { padding: searchViewportPadding(map), maxZoom: 15, duration: 700 },
    );
  };

  useEffect(() => {
    const pendingQuery = pendingSearchSubmitRef.current;
    if (!pendingQuery || searchLoading || searchResultsQuery !== pendingQuery) return;
    pendingSearchSubmitRef.current = null;
    displaySearchResults(pendingQuery, searchResults);
  // displaySearchResults deliberately uses the current map instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLoading, searchResults, searchResultsQuery]);

  const selectSearchResult = (feature: PhotonFeature) => {
    const map = mapRef.current;
    if (!map) return;
    (document.activeElement as HTMLElement | null)?.blur();
    const favorite = feature.properties.favoriteId
      ? favorites.find((item) => item.id === feature.properties.favoriteId)
      : undefined;
    const favoriteEntityType = favorite ? resolvedFavoriteEntityType(favorite) : undefined;
    if (favorite && favoriteEntityType === 'position') {
      setPositionInformation({ coordinates: favorite.coordinates, elevation: { status: 'loading' }, favoriteId: favorite.id });
      setSearchOpen(false);
      setHighlightedSearchResults([]);
      return;
    }
    if (feature.properties.transitStopId) {
      const coordinates = feature.geometry.coordinates;
      const stop: TransitStopSelection & { favoriteId?: string } = {
        stopId: feature.properties.transitStopId,
        name: feature.properties.name ?? 'Transit stop',
        mode: feature.properties.transitMode?.split(',')[0] || 'TRANSIT',
        coordinates,
        provider: feature.properties.transitProvider ?? 'transitous',
        favoriteId: favorite?.id,
      };
      const routeTarget = routePickingRef.current;
      if (routeTarget) {
        setRouteEndpoint(routeTarget, {
          name: stop.name,
          category: 'Transit stop',
          coordinates,
          source: 'search',
          transitStopId: stop.stopId,
          transitStopProvider: stop.provider,
        });
        setSearchQuery('');
        setSearchResults([]);
        return;
      }
      pendingSearchCameraRef.current = coordinates;
      transitStopsLayerRef.current?.selectSearchStop(stop);
      setSelectedTransitStop(stop);
      setSelectedLocation(null);
      setSearchOpen(false);
      return;
    }
    transitStopsLayerRef.current?.clearSelection();
    setSelectedTransitStop(null);
    const { primary } = photonResultLabel(feature);
    const properties = feature.properties as Record<string, unknown>;
    const address = [properties.housenumber, properties.street, properties.city]
      .filter(Boolean).join(' ') || undefined;
    const selection: LocationSelection = {
      name: primary,
      category: locationCategory(properties),
      address,
      coordinates: feature.geometry.coordinates,
      source: 'search',
      ...locationDetails(properties),
      iconId: locationIconId(properties),
      favoriteId: typeof properties.favoriteId === 'string' ? properties.favoriteId : undefined,
      osmType: typeof properties.osm_type === 'string' ? properties.osm_type : undefined,
      osmId: properties.osm_id as string | number | undefined,
    };
    if (favorite) Object.assign(selection, {
      name: favorite.name,
      category: favorite.category,
      address: favorite.address,
      iconId: favorite.iconId,
      osmType: favorite.osmType,
      osmId: favorite.osmId,
      openingHours: favorite.openingHours,
      phone: favorite.phone,
      email: favorite.email,
      website: favorite.website,
    });
    const routeTarget = routePickingRef.current;
    if (routeTarget) {
      locationDetailsAbortRef.current?.abort();
      setLocationDetailsLoading(false);
      setSelectedLocation(null);
      (map.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [],
      });
      setRouteEndpoint(routeTarget, selection);
    } else {
      pendingSearchCameraRef.current = selection.coordinates;
      setSelectedLocation(selection);
      void enrichLocationDetails(selection);
      const selectedSource = map.getSource('selected-location') as { setData: (data: unknown) => void } | undefined;
      selectedSource?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: selection.coordinates }, properties: {} }],
      });
    }
    setRouteSearchTarget(null);
    selectedSearchQueryRef.current = primary;
    setSearchQuery(primary);
    setSearchResults([]);
    setSearchOpen(false);
    setHighlightedSearchResults([]);
  };

  useEffect(() => {
    const coordinates = pendingSearchCameraRef.current;
    if (!coordinates) return;
    let cancelled = false;
    let frame: number | undefined;
    const panels = [...document.querySelectorAll<HTMLElement>('.transit-departures-panel, .location-info-panel')];
    const panelAnimations = panels.flatMap((panel) => panel.getAnimations({ subtree: true }));
    void Promise.allSettled(panelAnimations.map((animation) => animation.finished)).then(() => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(() => {
        const map = mapRef.current;
        if (!map || pendingSearchCameraRef.current !== coordinates) return;
        pendingSearchCameraRef.current = null;
        // Measure after the mobile sheet's entrance animation. Its transform
        // changes getBoundingClientRect without triggering ResizeObserver.
        map.easeTo({
          center: followCameraCenter(map, coordinates),
          zoom: Math.max(map.getZoom(), selectedTransitStop ? 14.6 : 14),
          duration: 900,
        });
      });
    });
    return () => {
      cancelled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [selectedLocation, selectedTransitStop]);

  const locateUser = () => {
    if (!navigator.geolocation) {
      setMapToolNotice('Location is not available in this browser.');
      return;
    }
    setMapToolNotice('Finding your location…');
    const updateUserLocation = (coords: GeolocationCoordinates) => {
      const map = mapRef.current;
      const coordinates: [number, number] = [coords.longitude, coords.latitude];
      userLocationRef.current = coordinates;
      (map?.getSource('user-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} }],
      });
      return { map, coordinates };
    };
    if (userLocationWatchRef.current === null) {
      userLocationWatchRef.current = navigator.geolocation.watchPosition(
        ({ coords }) => { updateUserLocation(coords); },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
      );
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { map, coordinates } = updateUserLocation(coords);
        if (!map) return;
        map.flyTo({
          center: coordinates,
          zoom: Math.max(map.getZoom(), 14),
          duration: 1000,
        });
        setMapToolNotice('Location found');
        window.setTimeout(() => setMapToolNotice(null), 1800);
      },
      () => setMapToolNotice('Unable to access your location.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  useEffect(() => () => {
    if (userLocationWatchRef.current !== null) navigator.geolocation.clearWatch(userLocationWatchRef.current);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(layerToggles)); } catch { /* storage can be disabled */ }
  }, [layerToggles]);

  useEffect(() => {
    if (!routeOpen || !routeResult) return;
    scheduleRouteFit(routeResult);
  }, [mapLoaded, routeOpen, routeResult]);

  useEffect(() => () => {
    routeCameraRequestRef.current += 1;
  }, []);

  const resetMapOrientation = () => {
    vehicleFollowEnabledRef.current = false;
    setVehicleFollowing(false);
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 600 });
  };

  const pauseVehicleFollow = () => {
    vehicleFollowEnabledRef.current = false;
    setVehicleFollowing(false);
  };
  const resumeVehicleFollow = () => {
    const map = mapRef.current;
    const pose = latestVehiclePoseRef.current;
    if (!map || !pose) return;
    vehicleFollowEnabledRef.current = true;
    setVehicleFollowing(true);
    const vehicle = pose.parts[Math.floor(pose.parts.length / 2)];
    map.setCenter(followCameraCenter(map, vehicle.coordinates));
    if (map.getZoom() < 14.6) map.setZoom(14.6);
  };
  const zoomIn = () => { pauseVehicleFollow(); mapRef.current?.zoomIn({ duration: 250 }); };
  const zoomOut = () => { pauseVehicleFollow(); mapRef.current?.zoomOut({ duration: 250 }); };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    let frame: number | undefined;
    let recenterTimer: number | undefined;
    let previousRouteLayout: string | undefined;
    const updatePadding = () => {
      frame = undefined;
      if (routeOpen && routeResult) {
        const padding = panelViewportPadding(map, 48, 24);
        const layout = [
          map.getContainer().clientWidth,
          map.getContainer().clientHeight,
          padding.top, padding.right, padding.bottom, padding.left,
        ].join(':');
        // ResizeObserver can emit repeatedly for a single React/layout pass.
        // Only request another fit when the measured usable viewport changed.
        const mobileSheetExpanded = window.innerWidth <= 760 && !routeSheetCollapsed;
        if (!mobileSheetExpanded && previousRouteLayout !== undefined && previousRouteLayout !== layout) {
          scheduleRouteFit(routeResult);
        }
        previousRouteLayout = layout;
      } else {
        const coordinates = selectedTransitStop?.coordinates ?? selectedLocation?.coordinates;
        if (coordinates) {
          if (recenterTimer !== undefined) window.clearTimeout(recenterTimer);
          recenterTimer = window.setTimeout(() => {
            map.easeTo({ center: followCameraCenter(map, coordinates), duration: 250 });
          }, 120);
        }
      }
    };
    const schedulePadding = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(updatePadding);
    };
    schedulePadding();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(schedulePadding)
      : undefined;
    document.querySelectorAll<HTMLElement>('.route-panel, .transit-departures-panel, .location-info-panel')
      .forEach((panel) => observer?.observe(panel));
    window.addEventListener('resize', schedulePadding);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (recenterTimer !== undefined) window.clearTimeout(recenterTimer);
      observer?.disconnect();
      window.removeEventListener('resize', schedulePadding);
    };
  }, [mapLoaded, routeOpen, routeResult, selectedTransitStop, selectedLocation, routeSheetCollapsed, transitDetailsOpen]);

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" />
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
          <MapControls
            query={searchQuery}
            searchOpen={searchOpen}
            searchLoading={searchLoading}
            searchError={searchError}
            searchResults={displayedSearchResults.map((feature, index) => {
              const { primary, secondary } = photonResultLabel(feature);
              return {
                id: `${feature.geometry.coordinates.join(':')}-${index}`,
                primary,
                secondary: feature.properties.favoriteId ? `★ Favourite${secondary ? ` · ${secondary}` : ''}` : secondary,
              };
            })}
            onQueryChange={(query) => {
              pendingSearchSubmitRef.current = null;
              setSearchQuery(query);
              setHighlightedSearchResults([]);
              setSearchOpen(true);
              setFavoritesOpen(false);
              setLayersOpen(false);
            }}
            onSearchClear={() => {
              pendingSearchSubmitRef.current = null;
              selectedSearchQueryRef.current = null;
              setSearchQuery('');
              setSearchResults([]);
              setSearchError(null);
              setSearchOpen(false);
              setHighlightedSearchResults([]);
            }}
            onSearchFocus={() => {
              setSearchOpen(true);
              setLayersOpen(false);
            }}
            onSearchClose={() => {
              setSearchOpen(false);
              setFavoritesOpen(false);
            }}
            favoritesOpen={favoritesOpen}
            onFavoritesToggle={() => {
              setFavoritesOpen((open) => {
                setSearchOpen(!open);
                return !open;
              });
              setLayersOpen(false);
            }}
            onSearchSubmit={() => {
              const query = searchQuery.trim();
              if (!query) {
                pendingSearchSubmitRef.current = null;
                setHighlightedSearchResults([]);
                return;
              }
              if (!searchLoading && searchResultsQuery === query) {
                displaySearchResults(query, searchResults);
              } else {
                // The debounced search effect will finish the current request
                // and the pending-submit effect will display that exact set.
                pendingSearchSubmitRef.current = query;
              }
            }}
            onSearchResultSelect={(index) => {
              if (displayedSearchResults[index]) selectSearchResult(displayedSearchResults[index]);
            }}
            layersOpen={layersOpen}
            onLayersOpenChange={(open) => {
              setLayersOpen(open);
              if (open) {
                setSearchOpen(false);
                setHighlightedSearchResults([]);
              }
            }}
            layers={layerToggles}
            onLayerChange={(key, enabled) => setLayerToggles((current) => ({
              ...current,
              [key]: enabled,
            }))}
            is3dMode={is3dMode}
            onToggle3dMode={() => setLayerToggles((current) => {
              const enabled = !(current.terrain && current.buildings && current.trees && current.transitModels);
              return {
                ...current,
                terrain: enabled,
                buildings: enabled,
                trees: enabled,
                transit: true,
                transitModels: enabled,
              };
            })}
            onLocate={locateUser}
            onResetOrientation={resetMapOrientation}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onRouteOpen={openRoute}
            routeOpen={routeOpen}
            contentPanelOpen={routeOpen || Boolean(selectedLocation) || Boolean(selectedTransitStop)}
            orientationChanged={orientationChanged}
            notice={mapToolNotice}
          />
          {routeContextMenu && (
            <div
              className="map-context-menu"
              role="menu"
              aria-label="Route options"
              style={{ left: routeContextMenu.x, top: routeContextMenu.y }}
            >
              <strong>Map point</strong>
              <button type="button" role="menuitem" onClick={() => {
                const coordinates: [number, number] = [...routeContextMenu.coordinates];
                setPositionInformation({ coordinates, elevation: { status: 'loading' } });
                setRouteContextMenu(null);
              }}>Position information</button>
              <button type="button" role="menuitem" onClick={() => startMeasurement([...routeContextMenu.coordinates])}>Measure distance</button>
              <button type="button" role="menuitem" onClick={() => {
                saveSelection({ name: 'Map point', category: 'Pinned location', coordinates: routeContextMenu.coordinates, source: 'map' });
                setRouteContextMenu(null);
              }}>Save as favourite</button>
              <button type="button" role="menuitem" onClick={() => {
                const selection: LocationSelection = {
                  name: 'Map point', category: 'Pinned location', coordinates: routeContextMenu.coordinates, source: 'map',
                };
                openRoute();
                setContextMenuMarker(null);
                setRouteEndpoint('destination', selection);
              }}>Route to here</button>
              <button type="button" role="menuitem" onClick={() => {
                const selection: LocationSelection = {
                  name: 'Map point', category: 'Pinned location', coordinates: routeContextMenu.coordinates, source: 'map',
                };
                openRoute();
                setContextMenuMarker(null);
                setRouteEndpoint('origin', selection);
              }}>Route from here</button>
            </div>
          )}
          {positionInformation && (
            <aside className="position-information" role="dialog" aria-modal="true" aria-labelledby="position-information-title">
              <button className="location-info-close" type="button" aria-label="Close position information" onClick={() => {
                setPositionInformation(null);
                setContextMenuMarker(null);
              }}>×</button>
              <div className="position-information-heading">
                <span className="location-info-icon" aria-hidden="true"><Mountain size={20} /></span>
                <div><span className="location-info-category">Map point</span><h2 id="position-information-title">Position information</h2></div>
              </div>
              <div className="position-information-field">
                <strong>Latitude, longitude</strong>
                <span>{formatCoordinates(positionInformation.coordinates)}</span>
              </div>
              <button className="position-copy" type="button" onClick={() => {
                void navigator.clipboard.writeText(formatCoordinates(positionInformation.coordinates)).then(
                  () => setMapToolNotice('Coordinates copied'),
                  () => setMapToolNotice('Could not copy coordinates'),
                );
              }}><Copy size={16} aria-hidden="true" /> Copy coordinates</button>
              {hasDisplayableElevation(positionInformation.elevation, is3dMode) && (
                <>
                  <div className="position-information-field">
                    <strong>Approximate terrain elevation</strong>
                    <span>{formatElevation(positionInformation.elevation.metres)}</span>
                  </div>
                  <small>Ground surface from the configured terrain DEM.</small>
                </>
              )}
              {positionInformation.favoriteId && (() => {
                const favorite = favorites.find((item) => item.id === positionInformation.favoriteId);
                return favorite ? <div className="favorite-actions">
                  <button type="button" onClick={() => editFavorite(favorite)}>Edit favourite</button>
                  <button type="button" onClick={() => {
                    setFavorites((items) => items.filter((item) => item.id !== favorite.id));
                    setPositionInformation(null);
                  }}>Remove favourite</button>
                </div> : null;
              })()}

            </aside>
          )}
          {measurement && (
            <>
              <div className="measurement-crosshair" aria-hidden="true"><span /><span /></div>
              <aside className="measurement-panel" aria-label="Distance measurement">
                <span>Distance</span>
                <strong aria-live="polite">{formatDistance(measurement.metres)}</strong>
                <div><button type="button" onClick={stopMeasurement}>Finish</button><button type="button" onClick={stopMeasurement}>Cancel</button></div>
              </aside>
            </>
          )}
          {pendingFavorite && (
            <div className="favorite-menu-backdrop" role="presentation" onMouseDown={(event) => {
              if (event.target === event.currentTarget) { setPendingFavorite(null); setContextMenuMarker(null); }
            }}>
              <section className="favorite-menu" role="dialog" aria-modal="true" aria-labelledby="favorite-menu-title">
                <button className="favorite-menu-close" type="button" aria-label="Close" onClick={() => { setPendingFavorite(null); setContextMenuMarker(null); }}>
                  <X size={18} aria-hidden="true" />
                </button>
                <span className="favorite-menu-eyebrow">Save place</span>
                <h2 id="favorite-menu-title">What kind of favourite is this?</h2>
                <p>Home and Work use their own map icons and are named automatically.</p>
                <div className="favorite-kind-options">
                  <button type="button" onClick={() => confirmFavoriteKind('home')}>
                    <House aria-hidden="true" /><span><strong>Home</strong><small>Save as Home</small></span>
                  </button>
                  <button type="button" onClick={() => confirmFavoriteKind('work')}>
                    <BriefcaseBusiness aria-hidden="true" /><span><strong>Work</strong><small>Save as Work</small></span>
                  </button>
                  <button type="button" onClick={() => confirmFavoriteKind('favorite')}>
                    <Star aria-hidden="true" /><span><strong>Favourite</strong><small>Choose a custom name</small></span>
                  </button>
                </div>
              </section>
            </div>
          )}
          {selectedTransitStop && (
            <TransitDeparturesPanel
              stop={selectedTransitStop}
              onDetailOpenChange={setTransitDepartureDetailOpen}
              staleRefreshSignal={staleRefreshSignal}
              navigationBackSignal={transitNavigationBackSignal}
              onDepartureSelect={({ tripId, mode, color, serviceDate, departure, scheduledDeparture }) => {
                vehicleFollowEnabledRef.current = true;
                setVehicleFollowing(true);
                setVehicleFollowAvailable(true);
                void transitStopsLayerRef.current?.selectTrip(
                  tripId,
                  mode,
                  color,
                  true,
                  selectedTransitStop.provider,
                  serviceDate,
                  {
                    stopId: selectedTransitStop.stopId,
                    coordinates: selectedTransitStop.coordinates,
                    departure,
                    scheduledDeparture,
                  },
                );
              }}
              onDepartureBack={() => {
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                setVehicleFollowAvailable(false);
                transitStopsLayerRef.current?.clearTrip();
              }}
              onFollowRequest={() => {
                vehicleFollowEnabledRef.current = true;
                setVehicleFollowing(true);
              }}
              onSetDestination={() => {
                const destination: LocationSelection = {
                  name: selectedTransitStop.name,
                  category: 'Transit stop',
                  coordinates: selectedTransitStop.coordinates,
                  source: 'map',
                  transitStopId: selectedTransitStop.stopId,
                  transitStopProvider: selectedTransitStop.provider,
                };
                openRoute();
                setRouteEndpoint('destination', destination);
              }}
              onSaveFavorite={() => saveSelection({
                name: selectedTransitStop.name,
                category: 'Transit stop',
                coordinates: selectedTransitStop.coordinates,
                source: 'map',
                transitStopId: selectedTransitStop.stopId,
                transitStopProvider: selectedTransitStop.provider,
                transitMode: selectedTransitStop.mode,
              }, 'transit', `${selectedTransitStop.provider}:${selectedTransitStop.stopId}`)}
              onEditFavorite={selectedTransitStop.favoriteId ? () => {
                const favorite = favorites.find((item) => item.id === selectedTransitStop.favoriteId);
                if (favorite) editFavorite(favorite);
              } : undefined}
              onRemoveFavorite={selectedTransitStop.favoriteId ? () => {
                setFavorites((items) => items.filter((item) => item.id !== selectedTransitStop.favoriteId));
                setSelectedTransitStop((stop) => stop ? { ...stop, favoriteId: undefined } : stop);
              } : undefined}
              onClose={() => {
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                setVehicleFollowAvailable(false);
                transitStopsLayerRef.current?.clearSelection();
                setSelectedTransitStop(null);
              }}
              isFollowing={vehicleFollowing}
            />
          )}
          {routeResult && routeOpen && (
            <div className="map-camera-actions" aria-label="Map camera controls">
              {routeMode === 'transit' && vehicleFollowAvailable && (
                <button
                  className="map-floating-action"
                  type="button"
                  aria-pressed={vehicleFollowing}
                  onClick={vehicleFollowing ? pauseVehicleFollow : resumeVehicleFollow}
                >
                  {vehicleFollowing ? 'Following vehicle' : 'Follow vehicle'}
                </button>
              )}
              <button className="map-floating-action" type="button" onClick={() => {
                pauseVehicleFollow();
                fitRouteNow(routeResult);
              }}>
                Fit route
              </button>
            </div>
          )}
          {selectedLocation && !selectedTransitStop && (
            <aside className={`location-info-panel mobile-bottom-sheet${locationSheet.dragging ? ' is-dragging' : ''}`} style={locationSheet.style} data-snap={locationSheet.snap} aria-label="Location information">
              <div className="mobile-sheet-drag-region" {...locationSheet.handleProps}><span aria-hidden="true" /></div>
              <div
                className="location-info-icon"
                aria-hidden="true"
                style={{ backgroundColor: LOCATION_ICON_COLORS[selectedIconKey] ?? '#64748b' }}
              >
                <SelectedLocationIcon size={20} strokeWidth={2.4} />
              </div>
              <div className="location-info-content">
                <span className="location-info-category">{selectedLocation.category}</span>
                <h2>{selectedLocation.name}</h2>
                {selectedLocation.address && <p>{selectedLocation.address}</p>}
                {locationDetailsLoading && <p className="location-info-loading">Loading OpenStreetMap details…</p>}
                {(selectedLocation.openingHours || selectedLocation.phone || selectedLocation.email || selectedLocation.website) && (
                  <div className="location-info-details">
                    {selectedLocation.openingHours && <div><strong>Hours</strong><span>{selectedLocation.openingHours}</span></div>}
                    {selectedLocation.phone && <div><strong>Phone</strong><a href={`tel:${selectedLocation.phone}`}>{selectedLocation.phone}</a></div>}
                    {selectedLocation.email && <div><strong>Email</strong><a href={`mailto:${selectedLocation.email}`}>{selectedLocation.email}</a></div>}
                    {selectedLocation.website && <div><strong>Web</strong><a href={selectedLocation.website} target="_blank" rel="noreferrer">Visit website</a></div>}
                  </div>
                )}
                {!locationDetailsLoading && !selectedLocation.openingHours && !selectedLocation.phone && !selectedLocation.email && !selectedLocation.website && (
                  <p className="location-info-empty">No opening hours or contact details are available in the current map data.</p>
                )}
                <span className="location-info-source">
                  {selectedLocation.source === 'search' ? 'Found with Photon · details from OpenStreetMap' : 'OpenStreetMap place'}
                </span>
                {(() => {
                  const favorite = favorites.find((item) => item.id === selectedLocation.favoriteId
                    || item.id === selectedLocation.osmId
                    || item.coordinates.join(',') === selectedLocation.coordinates.join(','));
                  return favorite ? (
                    <div className="favorite-actions">
                      <button type="button" onClick={() => editFavorite(favorite)}>Edit name</button>
                      <button type="button" onClick={() => setFavorites((items) => items.filter((item) => item.id !== favorite.id))}>Remove favourite</button>
                    </div>
                  ) : (
                    <button className="route-start-button route-secondary-button favorite-save-button" type="button" onClick={() => saveSelection(
                      selectedLocation,
                      selectedLocation.osmId ? 'osm' : undefined,
                      selectedLocation.osmId ? `${selectedLocation.osmType ?? ''}${selectedLocation.osmId}` : undefined,
                    )}><Star size={15} aria-hidden="true" /> Save favourite</button>
                  );
                })()}
                <button className="route-start-button" type="button" onClick={() => {
                  openRoute();
                  setRouteEndpoint('destination', selectedLocation);
                }}>Get directions</button>
                {routeOpen && <button className="route-start-button route-secondary-button" type="button" onClick={() => setRouteEndpoint('origin', selectedLocation)}>
                  Use as starting point
                </button>}
                <a
                  className="location-info-attribution"
                  href="https://nominatim.openstreetmap.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  © OpenStreetMap contributors · Nominatim
                </a>
              </div>
              <button
                className="location-info-close"
                type="button"
                aria-label="Close location information"
                onClick={() => {
                  locationDetailsAbortRef.current?.abort();
                  setLocationDetailsLoading(false);
                  setSelectedLocation(null);
                  (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
                    type: 'FeatureCollection', features: [],
                  });
                }}
              >
                ×
              </button>
            </aside>
          )}
          {routePicking && (
            <div className="route-selection-banner" role="status">
              <strong>Pick {routePicking === 'origin' ? 'a starting point' : 'a destination'}</strong>
              <span>Click anywhere on the map</span>
              <button type="button" onClick={() => { routePickingRef.current = null; setRoutePicking(null); }}>Cancel</button>
            </div>
          )}
          {routeOpen && !routePicking && (
            <aside className={`route-panel mobile-bottom-sheet${routeSheetCollapsed ? ' route-sheet-collapsed' : ''}${routeSheet.dragging ? ' is-dragging' : ''}`} style={routeSheet.style} data-snap={routeSheet.snap} aria-label="Route details">
              <button
                className="route-sheet-grabber"
                type="button"
                aria-label={routeSheetCollapsed ? 'Expand route panel' : 'Collapse route panel'}
                {...routeSheet.handleProps}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setRouteSheetCollapsed((collapsed) => !collapsed);
                  }
                }}
              ><span aria-hidden="true" /></button>
              <div className="route-panel-heading" {...routeSheet.handleProps}>
                <div><strong>Plan a route</strong><span>Search for a place or pick it on the map</span></div>
                <button type="button" aria-label="Clear route" onClick={cancelRoute}>×</button>
              </div>
              <div className="route-panel-body">
              <div className="route-endpoints">
                {(['origin', 'destination'] as const).map((kind) => {
                  const selection = kind === 'origin' ? routeOriginSelection : routeDestinationSelection;
                  const label = kind === 'origin' ? 'Starting point' : 'Destination';
                  return (
                    <div className="route-endpoint-group" key={kind}>
                      <div className={`route-search-field${routeSearchTarget === kind ? ' active' : ''}`}>
                        <MapPin aria-hidden="true" />
                        <input
                          aria-label={`Search ${label.toLowerCase()}`}
                          placeholder={`Search ${label.toLowerCase()}`}
                          value={routeSearchTarget === kind ? searchQuery : (selection?.name ?? '')}
                          onFocus={() => beginRouteSearch(kind)}
                          onChange={(event) => {
                            routePickingRef.current = kind;
                            setRouteSearchTarget(kind);
                            setSearchQuery(event.target.value);
                            setSearchOpen(false);
                          }}
                        />
                        {(routeSearchTarget === kind ? searchQuery : selection?.name) && (
                          <button
                            type="button"
                            className="route-field-clear"
                            aria-label={`Clear ${label.toLowerCase()}`}
                            title={`Clear ${label.toLowerCase()}`}
                            onClick={() => {
                              if (kind === 'origin') {
                                routeOriginRef.current = null;
                                setRouteOriginSelection(null);
                              } else {
                                routeDestinationRef.current = null;
                                setRouteDestinationSelection(null);
                              }
                              routeAbortRef.current?.abort();
                              setRouteLoading(false);
                              setRouteResult(null);
                              setTransitRouteOptions([]);
                              setRouteError(null);
                              setRouteGeometry(null);
                              setSearchQuery('');
                              setSearchResults([]);
                              setSearchError(null);
                              setRouteSearchTarget(kind);
                              routePickingRef.current = kind;
                            }}
                          >
                            <X aria-hidden="true" />
                          </button>
                        )}
                        <button type="button" className="route-map-button" onClick={() => pickRouteEndpoint(kind)}>
                          Map
                        </button>
                      </div>
                      {routeSearchTarget === kind && (
                        <div className="route-search-results" role="listbox" aria-label={`Search ${label.toLowerCase()} results`}>
                          <button
                            className="route-search-result route-search-current-location"
                            type="button"
                            onClick={() => selectYourLocation(kind)}
                          >
                            <strong>Your location</strong>
                            <span>{userLocationRef.current ? 'Use current GPS position' : 'Request location access'}</span>
                          </button>
                          {searchLoading && <div className="route-search-message">Searching…</div>}
                          {!searchLoading && searchError && <div className="route-search-message">{searchError}</div>}
                          {!searchLoading && !searchError && searchQuery.trim().length >= 2 && displayedSearchResults.length === 0 && <div className="route-search-message">No places found</div>}
                          {!searchLoading && (searchQuery.trim().length >= 2 || favoriteFeatures.length > 0) && displayedSearchResults.map((feature, index) => {
                            const { primary, secondary } = photonResultLabel(feature);
                            return (
                              <button
                                className="route-search-result"
                                key={`${feature.geometry.coordinates.join(':')}-${index}`}
                                type="button"
                                onClick={() => selectSearchResult(feature)}
                              >
                                <strong>{primary}</strong>
                                {secondary && <span>{secondary}</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="route-mode-row">
                <div className="route-mode-tabs" role="tablist" aria-label="Travel mode">
                  {([['pedestrian', 'Walk'], ['bicycle', 'Cycle'], ['transit', 'Transit'], ['auto', 'Drive']] as const).map(([mode, label]) => (
                  <button key={mode} role="tab" aria-selected={routeMode === mode} type="button" className={routeMode === mode ? 'active' : ''} onClick={() => setRouteMode(mode)}>{label}</button>
                  ))}
                </div>
                {routeMode === 'transit' && (
                  <button
                    className={`transit-time-toggle${transitTimeControlsOpen ? ' active' : ''}`}
                    type="button"
                    aria-label="Show transit time options"
                    aria-pressed={transitTimeControlsOpen}
                    onClick={() => setTransitTimeControlsOpen((open) => !open)}
                  >
                    <Clock3 aria-hidden="true" />
                  </button>
                )}
              </div>
              {routeMode === 'transit' && transitTimeControlsOpen && (
                <div className="transit-time-controls">
                  <div className="transit-time-tabs" role="tablist" aria-label="Transit time preference">
                    {([['depart', 'Depart at'], ['arrive', 'Arrive by']] as const).map(([mode, label]) => (
                      <button key={mode} role="tab" aria-selected={transitTimeMode === mode} type="button" className={transitTimeMode === mode ? 'active' : ''} onClick={() => setTransitTimeMode(mode)}>{label}</button>
                    ))}
                  </div>
                  <input
                    aria-label={transitTimeMode === 'depart' ? 'Depart at date and time' : 'Arrive by date and time'}
                    type="datetime-local"
                    value={transitDateTime}
                    onChange={(event) => setTransitDateTime(event.target.value)}
                  />
                </div>
              )}
              {routeLoading && <p className="route-panel-message">Calculating route…</p>}
              {routeError && <p className="route-panel-error">{routeError}</p>}
              {routeMode === 'transit' && !routeLoading && transitRouteOptions.length > 0 && (
                <div className="transit-route-options" aria-label="Transit route options">
                  <strong className="transit-route-options-heading">Choose a trip</strong>
                  {transitRouteOptions.slice(0, 3).map((option, index) => (
                    <button
                      className={`transit-route-option${selectedTransitRouteIndex === index ? ' active' : ''}`}
                      aria-pressed={selectedTransitRouteIndex === index}
                      key={`${option.departureTime}-${option.arrivalTime}-${index}`}
                      type="button"
                      onClick={() => selectTransitRoute(index)}
                    >
                      <strong>{transitTime(option.departureTime)}–{transitTime(option.arrivalTime)}</strong>
                      <span>{Math.round(option.durationSeconds / 60)} min · {option.transfers} {option.transfers === 1 ? 'transfer' : 'transfers'}</span>
                    </button>
                  ))}
                </div>
              )}
              {routeResult && !routeLoading && (
                <>
                  <div className="route-summary">
                    {routeMode !== 'transit' && <strong>{routeResult.distanceKm < 1 ? `${Math.round(routeResult.distanceKm * 1000)} m` : `${routeResult.distanceKm.toFixed(1)} km`}</strong>}
                    <span>{routeResult.durationSeconds < 3600 ? `${Math.round(routeResult.durationSeconds / 60)} min` : `${Math.floor(routeResult.durationSeconds / 3600)} h ${Math.round(routeResult.durationSeconds % 3600 / 60)} min`}</span>
                    {routeMode === 'transit' && routeResult.transitLegs && <span>{Math.max(0, routeResult.transitLegs.filter((leg) => !['WALK', 'FOOT'].includes(leg.mode)).length - 1)} transfers</span>}
                  </div>
                  {routeMode === 'transit' && routeResult.transitLegs && (
                    <button className="transit-route-details-toggle" type="button" onClick={() => setTransitDetailsOpen((open) => !open)}>
                      {transitDetailsOpen ? 'Hide stops and legs' : 'View stops and legs'}
                      <span aria-hidden="true">{transitDetailsOpen ? '−' : '+'}</span>
                    </button>
                  )}
                  {routeMode === 'transit' && transitDetailsOpen && routeResult.transitLegs && (
                    <div className="transit-route-legs" aria-label="Transit route legs">
                      {routeResult.transitLegs.map((leg, index) => {
                        const walking = ['WALK', 'FOOT'].includes(leg.mode);
                        const from = leg.from || (index === 0 ? 'Start' : 'Transfer point');
                        const to = leg.to || (index === routeResult.transitLegs!.length - 1 ? 'Destination' : 'Next stop');
                        const previousLeg = routeResult.transitLegs![index - 1];
                        const transfer = index > 0 && !walking && previousLeg && (
                          !['WALK', 'FOOT'].includes(previousLeg.mode)
                          || (index > 1 && ['WALK', 'FOOT'].includes(previousLeg.mode)
                            && !['WALK', 'FOOT'].includes(routeResult.transitLegs![index - 2].mode))
                        );
                        return (
                          <div key={`${leg.mode}-${leg.route}-${index}`}>
                            {transfer && (
                              <div className="transit-transfer-marker">
                                <ArrowDown aria-hidden="true" />
                                <span>Change at {from}</span>
                              </div>
                            )}
                            <div className={`transit-route-leg ${walking ? 'walking' : 'vehicle'}`}>
                              <div className="transit-route-leg-marker" aria-hidden="true">{walking ? '·' : index + 1}</div>
                              <div className="transit-route-leg-copy">
                                <div className="transit-route-leg-title">
                                  <strong>{walking ? 'Walk' : `${transitModeLabel(leg.mode)}${leg.route ? ` ${leg.route}` : ''}`}</strong>
                                  <time>{transitTime(leg.startTime)}{leg.endTime ? `–${transitTime(leg.endTime)}` : ''}</time>
                                </div>
                                {!walking && <span className="transit-route-leg-headsign">{leg.headsign || 'Towards destination'}{leg.cancelled ? ' · Cancelled' : leg.delaySeconds && leg.delaySeconds > 0 ? ` · +${Math.ceil(leg.delaySeconds / 60)} min` : leg.realTime ? ' · Realtime' : ''}</span>}
                                <div className="transit-route-stations">
                                  <div><small>{walking ? 'From' : 'Board at'}</small><strong>{from}</strong></div>
                                  <div className="transit-route-station-line" aria-hidden="true" />
                                  <div><small>{walking ? 'To' : 'Exit at'}</small><strong>{to}</strong></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {!routeLoading && !routeResult && !routeError && !routeOriginSelection && (
                <p className="route-panel-message">Choose a starting point to begin.</p>
              )}
              </div>
            </aside>
          )}
        </>
      )}
    </div>
  );
}
