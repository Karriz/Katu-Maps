import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ArrowRight,
  ArrowRightLeft,
  Beer,
  CircleDollarSign,
  BookOpen,
  Church,
  Coffee,
  GraduationCap,
  BriefcaseBusiness,
  Hospital,
  House,
  Hotel,
  Flame,
  Fuel,
  Landmark,
  Mail,
  Palette,
  MapPin,
  PawPrint,
  Pencil,
  Plane,
  Shield,
  Star,
  X,
  Clock3,
  Droplets,
  Mountain,
  Navigation,
  ShoppingBag,
  Share2,
  SquareParking,
  Store,
  Ticket,
  TentTree,
  Toilet,
  Trash2,
  TreePine,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { TreeModelLayer, treeViewportSignature } from './TreeModelLayer';
import { MapControls, type MapLayerState } from './MapControls';
import { MAP_COLORS } from './MapPalette';
import { TransitStopsLayer } from './TransitStopsLayer';
import type { TransitVehiclePose, TransitVehicleTripSelection } from './TransitStopsLayer';
import { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import { TransitRouteOverlay } from './TransitRouteOverlay';
const TransitDeparturesPanel = lazy(() => import('./TransitDeparturesPanel').then((module) => ({ default: module.TransitDeparturesPanel })));
import type { TransitStopSelection } from './TransitStopsLayer';
import { fetchValhallaRoute, type RouteMode, type RouteResult } from './ValhallaRouting';
import { fetchTransitRoutes, type TransitRouteResult } from './TransitRouting';
import {
  isWalkingTransitMode,
  TransitRouteOptions,
} from './TransitRouteOptions';
const TransitJourneyDetails = lazy(() => import('./TransitJourneyDetails').then((module) => ({ default: module.TransitJourneyDetails })));
const TransitJourneyHeader = lazy(() => import('./TransitJourneyDetails').then((module) => ({ default: module.TransitJourneyHeader })));
import { MapContextMenu } from './MapContextMenu';
import { InfoActionRow } from '../components/InfoActionRow';
import { localDateTimeValue, useRoutePlanning, type LocationSelection } from './useRoutePlanning';
import {
  fetchDigitransitRoute,
  journeyVehicleKey,
  resolveJourneyVehicleLegs,
  searchTransitStops,
  type TransitPositionStatus,
  type TransitProviderId,
} from './transit';
import { coordinateBounds, panelPaddingForRects, removeIsolatedCoordinateOutliers } from './RouteCamera';
import { defaultPositionName, elevationResult, formatCoordinates, formatElevation, formatNominatimAddress, hasDisplayableElevation, parseCoordinates, queryTerrainElevation, type AddressState, type ElevationState } from './PositionInformation';
import { DistanceMeasurementController, formatDistance, type Measurement } from './DistanceMeasurement';
import { availableGpsEndpoint, isMeaningfullyBetterLocation, locationZoomForAccuracy, markerFeatureCollection, normalizedLocationAccuracy } from './LocationMarkers';
import { installPersistedMapViewFlush, loadPersistedMapView, savePersistedMapView } from './PersistedMapView';
import { useInAppNavigation } from '../lib/useInAppNavigation';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { installForegroundRecovery } from '../lib/ForegroundRecovery';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { createMapDeepLink, parseMapDeepLink, shareMapDeepLink, type MapDeepLink } from '../lib/DeepLink';
import { useTheme } from '../theme';
import { favoriteMapFeatures, findTransitFavorite, loadFavorites, orderedFavorites, resolvedFavoriteEntityType, saveFavorites, upsertFavorite, type Favorite, type FavoriteKind } from '../lib/Favorites';
import {
  CARTOON_SUN_AZIMUTH_DEGREES,
} from './CartoonLighting';
import {
  GLOBAL_BUILDING_2D_LAYER_ID,
  GLOBAL_BUILDING_3D_LAYER_IDS,
  GLOBAL_BUILDING_TRANSITION_FOOTPRINT_LAYER_ID,
  GLOBAL_CYCLING_LAYER_IDS,
  GLOBAL_HIKING_LAYER_IDS,
  GLOBAL_MAP_STYLE,
  GLOBAL_ROAD_CASING_LAYER_IDS,
  GLOBAL_ROAD_LAYER_IDS,
  OPENFREEMAP_SOURCE_ID,
  aerowayWidthExpression,
  roadWidthExpression,
  applyMapTheme,
} from './GlobalMapStyle';

const TAMPERE: [number, number] = [23.7609, 61.4981];
const WATER_PATTERN_ID = 'water-surface-pattern';
const WATER_EFFECT_LAYER_IDS = ['global-water-pattern'];
const BUILDING_SHADOW_LAYER_IDS = [
  'global-building-shadow',
  'global-building-contact-shadow',
];
const LAYER_STORAGE_KEY = 'tampere-map-layer-options';
const CONTENT_PANEL_SELECTOR = '.route-panel, .transit-departures-panel, .location-info-panel, .position-information';

function closeRangeCameraOffset(): [number, number] {
  if (window.innerWidth > 760) return [0, 0];
  return [0, -Math.min(140, window.innerHeight * 0.18)];
}

function followCameraCenter(map: Map, coordinates: [number, number]): [number, number] {
  const [targetX, targetY] = visibleMapTargetPoint(map);
  const currentCenter = map.getCenter();
  const vehicleCoordinateAtTarget = map.unproject([targetX, targetY]);
  // Shift the map center by the geographic difference between where the
  // vehicle is and the coordinate currently under the desired screen point.
  return [
    currentCenter.lng + coordinates[0] - vehicleCoordinateAtTarget.lng,
    currentCenter.lat + coordinates[1] - vehicleCoordinateAtTarget.lat,
  ];
}

function visibleMapTargetPoint(map: Map): [number, number] {
  const mapRect = map.getContainer().getBoundingClientRect();
  let left = 0;
  let right = mapRect.width;
  let top = 0;
  let bottom = mapRect.height;
  document.querySelectorAll<HTMLElement>(CONTENT_PANEL_SELECTOR).forEach((panel) => {
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
  if (right <= left || bottom <= top) return [mapRect.width / 2, mapRect.height / 2];
  return [(left + right) / 2, (top + bottom) / 2];
}

function selectionCameraOffset(map: Map): [number, number] {
  const mapRect = map.getContainer().getBoundingClientRect();
  const [targetX, targetY] = visibleMapTargetPoint(map);
  return [targetX - mapRect.width / 2, targetY - mapRect.height / 2];
}

function panelViewportPadding(map: Map, base = 0, gap = 0) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const panelRects = [...document.querySelectorAll<HTMLElement>(CONTENT_PANEL_SELECTOR)]
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

/** Normalize provider route colors before passing them to a MapLibre paint expression. */
function mapRouteColor(value?: string) {
  if (!value) return undefined;
  const color = value.trim().replace(/^#/, '');
  return /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? `#${color}` : undefined;
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
    coordinateResult?: boolean;
    [key: string]: unknown;
  };
};

type PositionInformationState = {
  coordinates: [number, number];
  elevation: ElevationState;
  address: AddressState;
  favoriteId?: string;
};

type PendingFavorite = {
  editingFavoriteId?: string;
  selection: LocationSelection;
  provider?: string;
  providerId?: string;
  kind: FavoriteKind;
  name: string;
  nameWasEdited: boolean;
  addressLoading: boolean;
};

function positionInformationState(
  coordinates: [number, number],
  address?: string,
  favoriteId?: string,
): PositionInformationState {
  return {
    coordinates,
    elevation: { status: 'loading' },
    address: address ? { status: 'available', address } : { status: 'loading' },
    favoriteId,
  };
}

function suggestedFavoriteName(selection: LocationSelection) {
  if (selection.name !== 'Map point') return selection.name;
  return defaultPositionName(selection.coordinates, selection.address);
}

function photonResultLabel(feature: PhotonFeature) {
  if (feature.properties.coordinateResult) {
    return {
      primary: `Go to ${formatCoordinates(feature.geometry.coordinates)}`,
      secondary: 'Coordinates · Open position information',
    };
  }
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
  'education', 'religion', 'leisure', 'parking', 'parking_entrance',
  'bicycle_parking', 'motorcycle_parking',
  'fuel', 'charging_station', 'atm', 'bank', 'post', 'post_box', 'post_office',
  'parcel_locker', 'police', 'fire_station', 'toilets', 'campsite', 'camp_site',
  'caravan_site', 'zoo', 'wildlife_park', 'petting_zoo', 'aquarium', 'cemetery',
  'grave_yard', 'lodging', 'motel', 'bed_and_breakfast', 'guest_house', 'hostel',
  'chalet', 'alpine_hut', 'dormitory', 'shelter', 'wilderness_hut', 'viewpoint',
  'information', 'guidepost', 'picnic_site', 'drinking_water', 'airport', 'aerodrome', 'terminal',
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
  ['community_centre', Landmark], ['parking', SquareParking],
  ['fuel', Fuel], ['atm', CircleDollarSign], ['bank', Landmark], ['post', Mail],
  ['police', Shield], ['fire_station', Flame], ['toilets', Toilet], ['campsite', TentTree],
  ['zoo', PawPrint], ['cemetery', TreePine], ['lodging', Hotel],
  ['shelter', TentTree], ['viewpoint', Mountain], ['guidepost', MapPin],
  ['picnic_site', TreePine], ['drinking_water', Droplets],
  ['airport', Plane],
];

const LOCATION_ICON_COLORS: Record<string, string> = {
  restaurant: '#d46d62', cafe: '#b98655', bar: '#ab6d9d', fast_food: '#d48b55', pub: '#ab6d9d',
  food_court: '#d48b55', bakery: '#b98655', shop: '#5f8ec4', supermarket: '#5f8ec4', marketplace: '#5f8ec4',
  museum: '#806bb0', gallery: '#806bb0', theatre: '#806bb0', cinema: '#806bb0', artwork: '#806bb0',
  attraction: '#806bb0', tourism: '#806bb0', hotel: '#806bb0', hospital: '#b45f72', clinic: '#b45f72',
  pharmacy: '#b45f72', school: '#6d8d68', university: '#6d8d68', library: '#6d8d68',
  place_of_worship: '#a18159', park: '#6d9a71', stadium: '#6d9a71', community_centre: '#64748b',
  parking: '#587795',
  fuel: '#557f91', atm: '#568169', bank: '#568169', post: '#587eb1', police: '#496d9c',
  fire_station: '#ba625e', toilets: '#68798b', campsite: '#5f8a65', zoo: '#6b8e62',
  cemetery: '#778777', lodging: '#806bb0',
  shelter: '#8a704c', viewpoint: '#806bb0', guidepost: '#ad743b', picnic_site: '#5f8a65',
  drinking_water: '#4383ad',
  airport: '#557f91',
};

const LOCATION_ICON_ALIASES: Array<[string, string]> = [
  ['food', 'restaurant'], ['catering', 'restaurant'], ['sustenance', 'restaurant'],
  ['commercial', 'shop'], ['historic', 'museum'], ['entertainment', 'ticket'],
  ['healthcare', 'hospital'], ['education', 'school'], ['religion', 'place_of_worship'],
  ['leisure', 'park'], ['parking_entrance', 'parking'], ['bicycle_parking', 'parking'],
  ['motorcycle_parking', 'parking'],
  ['charging_station', 'fuel'], ['post_box', 'post'], ['post_office', 'post'],
  ['parcel_locker', 'post'], ['camp_site', 'campsite'], ['caravan_site', 'campsite'],
  ['wildlife_park', 'zoo'], ['petting_zoo', 'zoo'], ['aquarium', 'zoo'],
  ['grave_yard', 'cemetery'], ['motel', 'lodging'], ['bed_and_breakfast', 'lodging'],
  ['guest_house', 'lodging'], ['hostel', 'lodging'], ['chalet', 'lodging'],
  ['alpine_hut', 'lodging'], ['dormitory', 'lodging'],
  ['wilderness_hut', 'shelter'], ['information', 'guidepost'],
  ['aerodrome', 'airport'], ['terminal', 'airport'],
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
  ['parking', 10], ['parking_entrance', 10], ['bicycle_parking', 11], ['motorcycle_parking', 11],
  ['fuel', 9], ['charging_station', 9], ['atm', 11], ['bank', 11], ['post', 11],
  ['post_box', 12], ['post_office', 11], ['parcel_locker', 12], ['police', 6],
  ['fire_station', 6], ['toilets', 12], ['campsite', 8], ['camp_site', 8],
  ['caravan_site', 9], ['zoo', 8], ['wildlife_park', 8], ['petting_zoo', 9],
  ['aquarium', 8], ['cemetery', 12], ['grave_yard', 12], ['lodging', 8],
  ['motel', 8], ['bed_and_breakfast', 8], ['guest_house', 8], ['hostel', 8],
  ['chalet', 9], ['alpine_hut', 9], ['dormitory', 9],
  ['shelter', 8], ['wilderness_hut', 8], ['viewpoint', 7], ['information', 10],
  ['guidepost', 9], ['picnic_site', 9], ['drinking_water', 9],
  ['airport', 4], ['aerodrome', 4], ['terminal', 5],
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
    if (id === 'airport' && !map.hasImage('location-airport-icon-dark')) {
      const darkSvg = renderToStaticMarkup(createElement(Icon, {
        color: '#d7e9f5', size: 22, strokeWidth: 2.4,
      })).replace(
        /(<svg[^>]*>)/,
        '$1<circle cx="12" cy="12" r="11" fill="#31566d"/>',
      );
      const darkImage = new Image();
      darkImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(darkSvg)}`;
      await new Promise<void>((resolve, reject) => {
        darkImage.onload = () => resolve();
        darkImage.onerror = () => reject(new Error('Unable to load location-airport-icon-dark'));
      });
      if (!map.hasImage('location-airport-icon-dark')) map.addImage('location-airport-icon-dark', darkImage, { pixelRatio: 2 });
    }
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
  const { preference: themePreference, resolvedTheme, setPreference: setThemePreference } = useTheme();
  const initialDeepLinkRef = useRef<MapDeepLink | null>(parseMapDeepLink(window.location.search));
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const treeRefreshRef = useRef<(() => void) | null>(null);
  const treeLayerRef = useRef<TreeModelLayer | null>(null);
  const transitStopsLayerRef = useRef<TransitStopsLayer | null>(null);
  const transitVehicleLayerRef = useRef<TransitVehicleModelLayer | null>(null);
  const transitRouteOverlayRef = useRef<TransitRouteOverlay | null>(null);
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
  const vehicleFollowingRef = useRef(vehicleFollowing);
  vehicleFollowingRef.current = vehicleFollowing;
  const routeVehicleRestoreRef = useRef<{ result: RouteResult; following: boolean } | null>(null);
  const [vehiclePositionStatus, setVehiclePositionStatus] = useState<TransitPositionStatus>('unavailable');
  const userLocationRef = useRef<[number, number] | null>(null);
  const userLocationAccuracyRef = useRef(Number.POSITIVE_INFINITY);
  const userLocationTimestampRef = useRef(0);
  const userLocationWatchRef = useRef<number | null>(null);
  const locateFocusRef = useRef<((coords: GeolocationCoordinates) => void) | null>(null);
  const locateFocusTimerRef = useRef<number | undefined>(undefined);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapToolNotice, setMapToolNotice] = useState<string | null>(null);
  const mapToolNoticeTimerRef = useRef<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PhotonFeature[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResultsQuery, setSearchResultsQuery] = useState('');
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);
  const favoritesRef = useRef(favorites);
  const [pendingFavorite, setPendingFavorite] = useState<PendingFavorite | null>(null);
  const [highlightedSearchResults, setHighlightedSearchResults] = useState<PhotonFeature[]>([]);
  const pendingSearchSubmitRef = useRef<string | null>(null);
  const lastSearchFitRef = useRef('');
  const selectedSearchQueryRef = useRef<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationSelection | null>(null);
  const [locationDetailsLoading, setLocationDetailsLoading] = useState(false);
  const [contextMenuMarker, setContextMenuMarker] = useState<[number, number] | null>(null);
  const [positionInformation, setPositionInformation] = useState<PositionInformationState | null>(null);
  const elevationRequestRef = useRef(0);
  const positionAddressRequestRef = useRef(0);
  const favoriteAddressAbortRef = useRef<AbortController | null>(null);
  const routeAddressAbortRef = useRef<Record<'origin' | 'destination', AbortController | undefined>>({
    origin: undefined,
    destination: undefined,
  });
  const measurementControllerRef = useRef<DistanceMeasurementController | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const {
    routeMode, setRouteMode, routeOpen, setRouteOpen, routePicking, setRoutePicking,
    routeSearchTarget, setRouteSearchTarget, routeContextMenu, setRouteContextMenu,
    routeOriginSelection, setRouteOriginSelection, routeDestinationSelection, setRouteDestinationSelection,
    routeLoading, setRouteLoading, routeError, setRouteError, routeResult, setRouteResult,
    transitRouteOptions, setTransitRouteOptions, selectedTransitRouteIndex, setSelectedTransitRouteIndex,
    transitDetailsOpen, setTransitDetailsOpen, transitTimeMode, setTransitTimeMode,
    transitDateTime, setTransitDateTime, transitTimeControlsOpen, setTransitTimeControlsOpen,
    routeSheet, routeSheetCollapsed, routeSheetSnapBeforeDetailsRef, journeyBackButtonRef,
    journeyDetailsToggleRef, routeOriginRef, routeDestinationRef, routePickingRef, routeAbortRef,
    routeCameraRequestRef, setRouteSheetCollapsed, openTransitDetails, closeTransitDetails,
  } = useRoutePlanning();
  const routeVehicleViewRef = useRef(Boolean(routeOpen && routeResult));
  routeVehicleViewRef.current = Boolean(routeOpen && routeResult);
  const routeResultRef = useRef(routeResult);
  routeResultRef.current = routeResult;
  const locationSheet = useMobileBottomSheet('half');
  const positionSheet = useMobileBottomSheet('half');
  const pendingSearchCameraRef = useRef<[number, number] | null>(null);
  const selectionCameraActiveRef = useRef(false);
  const lastUserInteractionRef = useRef(0);
  const locationDetailsAbortRef = useRef<AbortController | null>(null);
  const nominatimCacheRef = useRef(new globalThis.Map<string, Partial<LocationSelection>>());
  const transitSearchCacheRef = useRef(new globalThis.Map<string, PhotonFeature[]>());
  const nominatimLastRequestRef = useRef(0);
  const routeSearchAnchorRefs = useRef<Record<'origin' | 'destination', HTMLDivElement | null>>({
    origin: null,
    destination: null,
  });
  const routeSearchResultsRef = useRef<HTMLDivElement | null>(null);
  const clearLocationSelection = useCallback(() => {
    locationDetailsAbortRef.current?.abort();
    setLocationDetailsLoading(false);
    setSelectedLocation(null);
    (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
      type: 'FeatureCollection', features: [],
    });
  }, []);
  const openPositionInformation = useCallback((information: PositionInformationState) => {
    prepareInfoPanelOpen();
    if (!routeVehicleViewRef.current) {
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
      setVehicleFollowAvailable(false);
    }
    if (routeVehicleViewRef.current) {
      transitStopsLayerRef.current?.clearStopSelection();
    } else {
      transitStopsLayerRef.current?.clearSelection();
    }
    setSelectedTransitStop(null);
    clearLocationSelection();
    setPositionInformation(information);
  }, [clearLocationSelection]);
  useEffect(() => {
    if (!routeSearchTarget) return;

    const updatePosition = () => {
      const anchor = routeSearchAnchorRefs.current[routeSearchTarget];
      const results = routeSearchResultsRef.current;
      if (!anchor || !results) return;

      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const margin = 12;
      const gap = 6;
      const spaceBelow = viewportBottom - rect.bottom - gap - margin;
      const spaceAbove = rect.top - viewportTop - gap - margin;
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(96, openAbove ? spaceAbove : spaceBelow);
      const maxHeight = Math.min(360, availableHeight);
      const left = Math.max(
        viewportLeft + margin,
        Math.min(rect.left, viewportLeft + viewportWidth - margin - rect.width),
      );

      results.style.left = `${left}px`;
      results.style.width = `${rect.width}px`;
      results.style.maxHeight = `${maxHeight}px`;
      results.style.top = openAbove
        ? `${Math.max(viewportTop + margin, rect.top - gap - results.getBoundingClientRect().height)}px`
        : `${rect.bottom + gap}px`;
      results.dataset.placement = openAbove ? 'top' : 'bottom';
    };

    const frame = window.requestAnimationFrame(updatePosition);
    const observer = new ResizeObserver(updatePosition);
    const anchor = routeSearchAnchorRefs.current[routeSearchTarget];
    if (anchor) observer.observe(anchor);
    if (routeSearchResultsRef.current) observer.observe(routeSearchResultsRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [routeSearchTarget, routeSheet.style]);
  const [layerToggles, setLayerToggles] = useState<MapLayerState>(() => {
    const mobileDefault2d = typeof window !== 'undefined' && window.innerWidth <= 760;
    const defaults: MapLayerState = {
      globe: true,
      trees: !mobileDefault2d,
      buildings: !mobileDefault2d,
      terrain: !mobileDefault2d,
      cycling: false,
      hiking: false,
      transit: true,
      transitLines: false,
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

  const shareSelection = (link: MapDeepLink, title: string) => {
    const url = createMapDeepLink(window.location.href, link);
    void shareMapDeepLink(url, title).then((result) => {
      if (result !== 'cancelled') showMapToolNotice(result === 'shared' ? 'Shared successfully' : 'Link copied');
    }).catch(() => showMapToolNotice('Could not share link'));
  };

  const showMapToolNotice = (message: string, duration: number | null = 2200) => {
    if (mapToolNoticeTimerRef.current !== undefined) window.clearTimeout(mapToolNoticeTimerRef.current);
    setMapToolNotice(message);
    mapToolNoticeTimerRef.current = duration === null
      ? undefined
      : window.setTimeout(() => {
        setMapToolNotice((current) => current === message ? null : current);
        mapToolNoticeTimerRef.current = undefined;
      }, duration);
  };

  useEffect(() => () => {
    if (mapToolNoticeTimerRef.current !== undefined) window.clearTimeout(mapToolNoticeTimerRef.current);
  }, []);

  const fetchPositionAddress = async (coordinates: [number, number], signal: AbortSignal) => {
    const lookupKey = `reverse:${coordinates[0].toFixed(6)},${coordinates[1].toFixed(6)}`;
    const cached = nominatimCacheRef.current.get(lookupKey);
    if (cached) return cached.address;

    const wait = Math.max(0, 1100 - (Date.now() - nominatimLastRequestRef.current));
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, wait);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    nominatimLastRequestRef.current = Date.now();
    const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1' });
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${coordinates[1]}&lon=${coordinates[0]}&zoom=18&${params}`,
      { signal },
    );
    if (!response.ok) throw new Error('Nominatim reverse lookup failed');
    const result = await response.json() as Record<string, unknown>;
    const address = formatNominatimAddress(result);
    nominatimCacheRef.current.set(lookupKey, { address });
    return address;
  };

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

  useEffect(() => {
    if (!positionInformation || positionInformation.address.status !== 'loading') return;
    const request = ++positionAddressRequestRef.current;
    const controller = new AbortController();
    const coordinates = positionInformation.coordinates;
    void fetchPositionAddress(coordinates, controller.signal).then((address) => {
      if (request !== positionAddressRequestRef.current) return;
      setPositionInformation((current) => current && current.coordinates === coordinates
        ? { ...current, address: address ? { status: 'available', address } : { status: 'unavailable' } }
        : current);
    }).catch((error: unknown) => {
      if ((error as Error).name !== 'AbortError' && request === positionAddressRequestRef.current) {
        setPositionInformation((current) => current && current.coordinates === coordinates
          ? { ...current, address: { status: 'unavailable' } }
          : current);
      }
    });
    return () => {
      positionAddressRequestRef.current += 1;
      controller.abort();
    };
  }, [positionInformation?.coordinates]);

  const coordinateSearchFeature = useMemo<PhotonFeature | undefined>(() => {
    const coordinates = parseCoordinates(searchQuery);
    return coordinates ? {
      geometry: { coordinates },
      properties: { coordinateResult: true },
    } : undefined;
  }, [searchQuery]);

  const favoriteFeatures = useMemo(() => orderedFavorites(favorites, favoritesOpen ? '' : searchQuery).map((favorite): PhotonFeature => ({
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
  })), [favorites, favoritesOpen, searchQuery]);
  const displayedSearchResults = useMemo(() => [
    ...favoriteFeatures,
    ...(!favoritesOpen && coordinateSearchFeature ? [coordinateSearchFeature] : []),
    ...(!favoritesOpen && searchQuery.trim().length >= 2 ? searchResults : []),
  ].filter((feature, index, all) => all.findIndex((candidate) => (
    candidate.geometry.coordinates.join(',') === feature.geometry.coordinates.join(',')
  )) === index).slice(0, 8), [coordinateSearchFeature, favoriteFeatures, favoritesOpen, searchQuery, searchResults]);

  const saveSelection = (selection: LocationSelection, provider?: string, providerId?: string) => {
    favoriteAddressAbortRef.current?.abort();
    const fallbackName = suggestedFavoriteName(selection);
    setPendingFavorite({
      selection,
      provider,
      providerId,
      kind: 'favorite',
      name: fallbackName,
      nameWasEdited: false,
      addressLoading: selection.name === 'Map point' && !selection.address,
    });
    if (selection.name !== 'Map point' || selection.address) return;
    const controller = new AbortController();
    favoriteAddressAbortRef.current = controller;
    void fetchPositionAddress(selection.coordinates, controller.signal).then((address) => {
      setPendingFavorite((current) => {
        if (!current || current.selection.coordinates !== selection.coordinates) return current;
        const enrichedSelection = address ? { ...current.selection, address } : current.selection;
        return {
          ...current,
          selection: enrichedSelection,
          addressLoading: false,
          name: address && !current.nameWasEdited && current.kind === 'favorite' ? address : current.name,
        };
      });
    }).catch((error: unknown) => {
      if ((error as Error).name !== 'AbortError') {
        setPendingFavorite((current) => current ? { ...current, addressLoading: false } : current);
      }
    });
  };

  const confirmFavorite = () => {
    if (!pendingFavorite) return;
    const { selection, provider, providerId, kind } = pendingFavorite;
    const name = pendingFavorite.name.trim();
    if (!name) return;
    const updatedFavorite: Favorite = {
      id: pendingFavorite.editingFavoriteId ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
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
    };
    setFavorites((current) => pendingFavorite.editingFavoriteId
      ? current.map((item) => item.id === pendingFavorite.editingFavoriteId ? { ...item, name } : item)
      : upsertFavorite(current, updatedFavorite));
    favoriteAddressAbortRef.current?.abort();
    setPendingFavorite(null);
    setContextMenuMarker(null);
  };

  const editFavorite = (favorite: Favorite) => {
    setPendingFavorite({
      editingFavoriteId: favorite.id,
      selection: {
        name: favorite.name,
        category: favorite.category,
        address: favorite.address,
        coordinates: favorite.coordinates,
        source: 'map',
        transitStopId: favorite.transitStopId,
        transitStopProvider: favorite.transitProvider === 'digitransit' || favorite.transitProvider === 'transitous'
          ? favorite.transitProvider
          : undefined,
        transitMode: favorite.transitMode,
        osmType: favorite.osmType,
        osmId: favorite.osmId,
        iconId: favorite.iconId,
      },
      provider: favorite.provider,
      providerId: favorite.providerId,
      kind: favorite.kind,
      name: favorite.name,
      nameWasEdited: true,
      addressLoading: false,
    });
  };

  const selectedTransitFavorite = selectedTransitStop
    ? findTransitFavorite(favorites, selectedTransitStop.stopId, selectedTransitStop.provider)
    : undefined;

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
    if (transitDetailsOpen) { closeTransitDetails(); return; }
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
      properties: {
        mode: leg.mode,
        // Keep this on each feature so mixed-mode journeys can use the
        // operator's line color without affecting walking or other legs.
        routeColor: !isWalkingTransitMode(leg.mode) ? mapRouteColor(leg.routeColor) : undefined,
      },
    })) ?? [];
    const directMode = routeMode === 'pedestrian' ? 'WALK'
      : routeMode === 'bicycle' ? 'BICYCLE'
        : routeMode === 'auto' ? 'CAR' : undefined;
    source?.setData(legFeatures.length
      ? { type: 'FeatureCollection', features: legFeatures }
      : { type: 'Feature', geometry: result.geometry, properties: { mode: directMode } });
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
    if (routeMode !== 'transit') {
      // The selected-trip route is rendered by TransitStopsLayer in a
      // separate source from the planner route. Clear it when switching to a
      // direct walking, cycling, or driving route so its old color cannot
      // remain visible over the new route.
      plannedVehicleTripRef.current = null;
      transitStopsLayerRef.current?.clearTrip();
      return;
    }
    const { current, next } = resolveJourneyVehicleLegs(result.transitLegs ?? [], Date.now());
    const nextTripKey = `${journeyVehicleKey(current) ?? ''}|${journeyVehicleKey(next) ?? ''}`;
    if (plannedVehicleTripRef.current === nextTripKey) return;
    const currentVehicleChanged = (plannedVehicleTripRef.current?.split('|')[0] ?? '')
      !== (journeyVehicleKey(current) ?? '');
    plannedVehicleTripRef.current = nextTripKey;
    if (currentVehicleChanged) {
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
      setVehicleFollowAvailable(false);
    }
    const selection = (leg: typeof current): TransitVehicleTripSelection | undefined => {
      if (!leg?.tripId) return undefined;
      const originCoordinates = leg.from?.coordinates
        ?? (leg.geometry?.coordinates[0] as [number, number] | undefined);
      const scheduledDeparture = leg.scheduledStartTime ?? leg.startTime;
      return {
        tripId: leg.tripId,
        mode: leg.mode,
        color: mapRouteColor(leg.routeColor) ?? MAP_COLORS.transitBlue,
        showRoute: false,
        provider: leg.provider ?? 'transitous',
        serviceDate: leg.serviceDate,
        boardingStop: scheduledDeparture && leg.startTime && originCoordinates && leg.from?.stopId ? {
          stopId: leg.from.stopId,
          coordinates: originCoordinates,
          departureTime: Date.parse(leg.startTime),
          scheduledDeparture,
        } : undefined,
      };
    };
    const currentSelection = selection(current);
    const nextSelection = selection(next);
    if (currentSelection || nextSelection) {
      transitStopsLayerRef.current?.selectJourneyTrips(currentSelection, nextSelection);
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
    routeSheetSnapBeforeDetailsRef.current = null;
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
        // Digitransit provides Finland-wide OpenTripPlanner routing for the
        // direct WALK/BICYCLE/CAR modes and supports browser requests with the
        // same subscription key already used for transit planning. Keep the
        // road-router fallback for areas or deployments where it is unavailable.
        try {
          result = {
            ...(await fetchDigitransitRoute(origin, destination, routeMode, controller.signal)),
            provider: 'digitransit',
          };
        } catch (digitransitError) {
          if (controller.signal.aborted) throw digitransitError;
          try {
            result = await fetchValhallaRoute(origin, destination, routeMode, controller.signal);
          } catch (fallbackError) {
            if (controller.signal.aborted) throw fallbackError;
            const primary = digitransitError instanceof Error ? digitransitError.message : 'service unavailable';
            const fallback = fallbackError instanceof Error ? fallbackError.message : 'service unavailable';
            throw new Error(`Routing unavailable. Digitransit: ${primary}. Valhalla: ${fallback}`);
          }
        }
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
        const message = error instanceof Error ? error.message : '';
        setRouteError(message === 'Failed to fetch'
          ? 'Routing services are temporarily unavailable. Check your connection and try again.'
          : message || 'Could not calculate a route');
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

  const swapRouteEndpoints = () => {
    const previousOriginSelection = routeOriginSelection;
    const previousDestinationSelection = routeDestinationSelection;
    const previousOriginCoordinates = routeOriginRef.current;
    const previousDestinationCoordinates = routeDestinationRef.current;

    routeOriginRef.current = previousDestinationCoordinates;
    routeDestinationRef.current = previousOriginCoordinates;
    setRouteOriginSelection(previousDestinationSelection);
    setRouteDestinationSelection(previousOriginSelection);

    setRouteOpen(true);
    setRouteResult(null);
    setRouteError(null);
    setRouteGeometry(null);
    setRouteSearchTarget(null);
    routePickingRef.current = null;
    setRoutePicking(null);
    setTransitRouteOptions([]);
    setSelectedTransitRouteIndex(0);
    setTransitDetailsOpen(false);
    setRoutePoints();
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
    routeAddressAbortRef.current[kind]?.abort();
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

    if (selection.source !== 'map' || selection.name !== 'Map point') return;
    const controller = new AbortController();
    routeAddressAbortRef.current[kind] = controller;
    void fetchPositionAddress(selection.coordinates, controller.signal).then((address) => {
      if (!address || controller.signal.aborted) return;
      const endpointIsCurrent = kind === 'origin'
        ? routeOriginRef.current === selection.coordinates
        : routeDestinationRef.current === selection.coordinates;
      if (!endpointIsCurrent) return;
      const enrichedSelection = { ...selection, name: address, address };
      if (kind === 'origin') setRouteOriginSelection(enrichedSelection);
      else setRouteDestinationSelection(enrichedSelection);
    }).catch((error: unknown) => {
      if ((error as Error).name !== 'AbortError') console.warn('Route endpoint address lookup failed.', error);
    });
  };

  const pickRouteEndpoint = (kind: 'origin' | 'destination') => {
    routeAbortRef.current?.abort();
    routeAddressAbortRef.current[kind]?.abort();
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
    setRoutePicking(null);
    setRouteSearchTarget(kind);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    setSearchOpen(false);
  };

  useEffect(() => {
    const closeAutocomplete = () => {
      setRouteSearchTarget(null);
      setSearchQuery('');
      setSearchResults([]);
      routePickingRef.current = null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (routeSearchTarget) closeAutocomplete();
      if (searchOpen) setSearchOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (routeSearchTarget && !target?.closest('.route-search-field, .route-search-results-floating')) {
        closeAutocomplete();
      }
      if (searchOpen && !target?.closest('.location-search-form, .location-search-results')) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [routeSearchTarget, searchOpen]);

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
    routeSheetSnapBeforeDetailsRef.current = null;
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

  function prepareInfoPanelOpen() {
    setPositionInformation(null);
    setContextMenuMarker(null);
    if (window.innerWidth <= 760) cancelRoute();
  }

  function preserveRouteVehicleForInfoPanel() {
    return window.innerWidth > 760 && routeVehicleViewRef.current;
  }

  function selectTransitStopForInfoPanel(stop: TransitStopSelection) {
    setPositionInformation(null);
    setContextMenuMarker(null);
    if (preserveRouteVehicleForInfoPanel()) {
      if (routeResultRef.current) {
        routeVehicleRestoreRef.current = {
          result: routeResultRef.current,
          following: vehicleFollowingRef.current,
        };
      }
      transitStopsLayerRef.current?.selectSearchStopPreservingTrip(stop);
    } else {
      transitStopsLayerRef.current?.selectSearchStop(stop);
    }
  }

  function clearTransitInfoSelection() {
    if (preserveRouteVehicleForInfoPanel()) {
      transitStopsLayerRef.current?.clearStopSelection();
    } else {
      transitStopsLayerRef.current?.clearSelection();
    }
  }

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

    const deepLink = initialDeepLinkRef.current;
    const savedView = deepLink ? null : loadPersistedMapView();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: GLOBAL_MAP_STYLE,
      center: deepLink?.coordinates ?? savedView?.center ?? TAMPERE,
      zoom: deepLink?.zoom ?? savedView?.zoom ?? 2.2,
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
    transitVehicleLayerRef.current = transitVehicleLayer;
    const transitStopsLayer = new TransitStopsLayer((pose) => {
      latestVehiclePoseRef.current = pose;
      // Keep the custom model layer synchronized with the same estimated pose
      // used by the map marker and follow camera. Layer visibility decides
      // whether the model is rendered; clearing the pose here prevents the
      // 3D vehicles toggle from ever having anything to display.
      transitVehicleLayer.setPose(pose);
      setVehicleFollowAvailable(Boolean(pose));
      setVehiclePositionStatus(pose?.status ?? 'unavailable');
      if (!pose || !vehicleFollowEnabledRef.current) return;
      if (Date.now() - lastUserInteractionRef.current < 400) return;
      const vehicle = pose.parts[Math.floor(pose.parts.length / 2)];
      // Keep camera tracking independent of style loading/animation state.
      // The vehicle pose is updated on every timer tick, so setCenter avoids
      // a queue of interrupted easeTo animations and follows the tram exactly.
      map.setCenter(followCameraCenter(map, vehicle.coordinates));
      if (map.getZoom() < 14.6) map.setZoom(14.6);
    });
    transitStopsLayerRef.current = transitStopsLayer;
    const transitRouteOverlay = new TransitRouteOverlay();
    transitRouteOverlayRef.current = transitRouteOverlay;
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
      if (map.getLayer('global-aeroway-lines')) {
        map.setPaintProperty('global-aeroway-lines', 'line-width', aerowayWidthExpression(latitude));
      }
      if (map.getLayer('global-aeroway-runways')) {
        map.setPaintProperty('global-aeroway-runways', 'line-width', aerowayWidthExpression(latitude));
      }
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
      if (map.getLayer('global-housenumbers')) {
        map.setPaintProperty(
          'global-housenumbers',
          'text-opacity',
          nextBucket === 1 ? 0.35 : 0.82,
        );
      }
    };
    const modelUpdateSignature = () => {
      const bounds = map.getBounds();
      return treeViewportSignature(
        {
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        },
        map.getZoom(),
        map.getPitch(),
        terrainSourceRef.current,
        terrainEnabledRef.current,
        Math.floor(map.getZoom() + 1e-6),
      );
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
    const updateTransitRouteOverlay = () => {
      transitRouteOverlay.update(map.getBounds(), map.getZoom());
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
      if (measurementControllerRef.current) return;
      setRouteContextMenu(null);
      if (!positionInformation && !pendingFavorite) setContextMenuMarker(null);
      const locationLayers = ['favorite-icons', 'search-result-icons', 'global-hiking-pois', 'location-poi-icons', 'location-poi-labels', 'selected-location-icon'];
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
        openPositionInformation(positionInformationState(favorite.coordinates, favorite.address, favorite.id));
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
        prepareInfoPanelOpen();
        selectTransitStopForInfoPanel(stop);
        setSelectedTransitStop(stop);
        clearLocationSelection();
        return;
      }
      prepareInfoPanelOpen();
      clearTransitInfoSelection();
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
        x: Math.min(Math.max(point.x, 12), container.clientWidth - 12),
        y: Math.min(Math.max(point.y, 12), container.clientHeight - 12),
        coordinates,
      });
    };
    const handleMapContextMenu = (event: MapMouseEvent) => {
      event.originalEvent.preventDefault();
      if (measurementControllerRef.current) return;
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
      lastUserInteractionRef.current = Date.now();
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
      if (measurementControllerRef.current) return;
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
      lastUserInteractionRef.current = Date.now();
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
    const handleMapGestureStart = () => {
      cancelLongPressTimer();
      lastUserInteractionRef.current = Date.now();
    };
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
            'match', ['upcase', ['to-string', ['get', 'mode']]],
            'WALK', '#64748b', 'FOOT', '#64748b', 'PEDESTRIAN', '#64748b',
            'BICYCLE', '#16834b', 'BIKE', '#16834b', 'CYCLING', '#16834b',
            'CAR', '#2563eb', 'DRIVING', '#2563eb',
            [
              'coalesce', ['get', 'routeColor'], [
                'match', ['upcase', ['to-string', ['get', 'mode']]],
                'TRAM', '#8b5cf6', 'BUS', '#1769e8',
                'SUBWAY', '#f97316', 'RAIL', '#16a34a',
                'REGIONAL_RAIL', '#16a34a', '#0ea5e9',
              ],
            ],
          ] as unknown as ExpressionSpecification,
          'line-width': 5,
          'line-opacity': 0.98,
          'line-dasharray': [
            'match', ['upcase', ['to-string', ['get', 'mode']]],
            'WALK', ['literal', [1.2, 1.2]],
            'FOOT', ['literal', [1.2, 1.2]],
            'PEDESTRIAN', ['literal', [1.2, 1.2]],
            ['literal', [1, 0]],
          ] as unknown as ExpressionSpecification,
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
      map.on('mouseenter', 'global-hiking-pois', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'global-hiking-pois', () => { map.getCanvas().style.cursor = ''; });
      void transitStopsLayer.install(map, (stop) => {
        if (!preserveRouteVehicleForInfoPanel()) setVehicleFollowAvailable(false);
        setPositionInformation(null);
        setContextMenuMarker(null);
        clearLocationSelection();
        if (preserveRouteVehicleForInfoPanel() && routeResultRef.current) {
          routeVehicleRestoreRef.current = {
            result: routeResultRef.current,
            following: vehicleFollowingRef.current,
          };
        }
        setSelectedTransitStop(stop);
      map.easeTo({
        center: stop.coordinates,
        zoom: Math.max(map.getZoom(), 14.6),
        offset: closeRangeCameraOffset(),
        duration: 900,
        });
      }, () => measurementControllerRef.current !== null, preserveRouteVehicleForInfoPanel).then(() => {
        if (transitStopsLayerRef.current !== transitStopsLayer || !map.isStyleLoaded()) return;
        map.moveLayer(transitVehicleLayer.id, 'transit-estimated-vehicle-label');
        updateTransitStops();
      });
      transitRouteOverlay.install(map);
      ['global-bus-stops', 'global-railway-stations', 'global-railway-station-labels', 'global-poi-labels', 'poi-labels'].forEach((layerId) => {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
      });
      updateGlobalRoadWidths();
      updateGlobalLabelDensity();
      scheduleTreeUpdate();
      scheduleTransitStopsUpdate();
      updateTransitRouteOverlay();
      initialLoadComplete = true;
      setMapLoaded(true);
      if (deepLink) {
        initialDeepLinkRef.current = null;
        const selectedSource = map.getSource('selected-location') as { setData: (data: unknown) => void } | undefined;
        const showPositionFallback = () => {
          openPositionInformation(positionInformationState(deepLink.coordinates));
          setContextMenuMarker(deepLink.coordinates);
        };
        if (deepLink.type === 'stop' && deepLink.id && (deepLink.provider === 'digitransit' || deepLink.provider === 'transitous')) {
          const stop: TransitStopSelection = {
            stopId: deepLink.id, provider: deepLink.provider, coordinates: deepLink.coordinates,
            name: deepLink.name ?? 'Shared transit stop', mode: 'TRANSIT',
          };
          transitStopsLayer.selectSearchStop(stop);
          setSelectedTransitStop(stop);
        } else if (deepLink.type === 'poi' && deepLink.id) {
          const osmMatch = /^(node|way|relation|[NWR])(\d+)$/i.exec(deepLink.id);
          const osmType = osmMatch?.[1].toLowerCase();
          const selection: LocationSelection = {
            name: deepLink.name ?? 'Shared place', category: 'Place', coordinates: deepLink.coordinates,
            source: 'map',
            osmType: osmType === 'node' ? 'N' : osmType === 'way' ? 'W' : osmType === 'relation' ? 'R' : osmType?.toUpperCase(),
            osmId: osmMatch?.[2],
          };
          setSelectedLocation(selection);
          selectedSource?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: deepLink.coordinates }, properties: {} }] });
          void enrichLocationDetails(selection);
        } else {
          showPositionFallback();
        }
      }
    });
    const persistCamera = () => {
      try {
        const center = map.getCenter();
        savePersistedMapView({
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
      } catch { /* local storage can be disabled */ }
    };
    const handleMoveEnd = () => {
      persistCamera();
      updateGlobalRoadWidths();
      scheduleTreeUpdate();
      // Vehicle follow recenters the map several times per second. Those
      // camera-only moves must not trigger a fresh stop query on every moveend.
      if (!vehicleFollowEnabledRef.current) scheduleTransitStopsUpdate();
      updateTransitRouteOverlay();
    };
    const removePersistedMapViewFlush = installPersistedMapViewFlush(document, window, persistCamera);
    const removeForegroundRecovery = installForegroundRecovery({
      document,
      window,
      canvas: map.getCanvas(),
      map,
      beforeReload: persistCamera,
      reload: () => window.location.reload(),
    });
    const handleCameraMove = () => {
      const zoom = map.getZoom();
      const pitch = map.getPitch();
      const nextLabelSignature = `${Math.round(zoom * 2) / 2}:${Math.round(pitch / 10) * 10}`;
      const nextOrientationChanged = Math.abs(map.getBearing()) > 1 || pitch > 1;
      if (nextOrientationChanged !== previousOrientationChanged) {
        previousOrientationChanged = nextOrientationChanged;
        setOrientationChanged(nextOrientationChanged);
      }
      if (nextLabelSignature !== globalLabelDensitySignature) {
        updateGlobalLabelDensity();
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
      removePersistedMapViewFlush();
      removeForegroundRecovery();
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
      map.off('mouseenter', 'global-hiking-pois', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.off('mouseleave', 'global-hiking-pois', () => { map.getCanvas().style.cursor = ''; });
      map.off('idle', scheduleTreeUpdate);
      transitStopsLayer.dispose();
      transitRouteOverlay.dispose();
      map.remove();
      mapRef.current = null;
      treeRefreshRef.current = null;
      treeLayerRef.current = null;
      transitStopsLayerRef.current = null;
      transitVehicleLayerRef.current = null;
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
    setVisibility(GLOBAL_CYCLING_LAYER_IDS, layerToggles.cycling);
    setVisibility(GLOBAL_HIKING_LAYER_IDS, layerToggles.hiking);
    transitRouteOverlayRef.current?.setVisibility(layerToggles.transitLines);
    if (layerToggles.transitLines) {
      void transitRouteOverlayRef.current?.update(map.getBounds(), map.getZoom());
    }
    setVisibility(WATER_EFFECT_LAYER_IDS, true);
    map.setProjection({ type: layerToggles.globe ? 'globe' : 'mercator' });
    terrainEnabledRef.current = layerToggles.terrain;
    map.setTerrain(layerToggles.terrain
      ? { source: terrainSourceRef.current, exaggeration: 1.0 }
      : null);
    map.triggerRepaint();
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
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    treeLayerRef.current?.setTheme(resolvedTheme === 'dark');
    transitVehicleLayerRef.current?.setTheme(resolvedTheme === 'dark');
    applyMapTheme(map, resolvedTheme);
    map.triggerRepaint();
  }, [resolvedTheme, mapLoaded]);

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
    if (feature.properties.coordinateResult) {
      const coordinates = feature.geometry.coordinates;
      const routeTarget = routeSearchTarget;
      if (routeTarget) {
        setRouteEndpoint(routeTarget, {
          name: formatCoordinates(coordinates),
          category: 'Coordinates',
          coordinates,
          source: 'search',
        });
        setSearchQuery('');
        setSearchResults([]);
        return;
      }
      pendingSearchCameraRef.current = coordinates;
      locationDetailsAbortRef.current?.abort();
      setLocationDetailsLoading(false);
      transitStopsLayerRef.current?.clearSelection();
      setSelectedTransitStop(null);
      setSelectedLocation(null);
      (map.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [],
      });
      openPositionInformation(positionInformationState(coordinates));
      setContextMenuMarker(coordinates);
      setSearchOpen(false);
      setHighlightedSearchResults([]);
      return;
    }
    const favorite = feature.properties.favoriteId
      ? favorites.find((item) => item.id === feature.properties.favoriteId)
      : undefined;
    const favoriteEntityType = favorite ? resolvedFavoriteEntityType(favorite) : undefined;
    if (favorite && favoriteEntityType === 'position') {
      const routeTarget = routeSearchTarget;
      if (routeTarget) {
        setRouteEndpoint(routeTarget, {
          name: favorite.name,
          category: favorite.category,
          address: favorite.address,
          coordinates: favorite.coordinates,
          source: 'search',
        });
        setSearchQuery('');
        setSearchResults([]);
        return;
      }
      pendingSearchCameraRef.current = favorite.coordinates;
      locationDetailsAbortRef.current?.abort();
      setLocationDetailsLoading(false);
      transitStopsLayerRef.current?.clearSelection();
      setSelectedTransitStop(null);
      setSelectedLocation(null);
      (map.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [],
      });
      openPositionInformation(positionInformationState(favorite.coordinates, favorite.address, favorite.id));
      setSearchOpen(false);
      setHighlightedSearchResults([]);
      return;
    }
    if (feature.properties.transitStopId) {
      const coordinates = favorite?.coordinates ?? feature.geometry.coordinates;
      const stop: TransitStopSelection & { favoriteId?: string } = {
        stopId: feature.properties.transitStopId,
        name: favorite?.name ?? feature.properties.name ?? 'Transit stop',
        mode: feature.properties.transitMode?.split(',')[0] || 'TRANSIT',
        coordinates,
        provider: feature.properties.transitProvider ?? 'transitous',
        favoriteId: favorite?.id,
      };
      const routeTarget = routeSearchTarget;
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
      prepareInfoPanelOpen();
      setPositionInformation(null);
      setContextMenuMarker(null);
      selectTransitStopForInfoPanel(stop);
      setSelectedTransitStop(stop);
      clearLocationSelection();
      setSearchOpen(false);
      return;
    }
    setPositionInformation(null);
    setContextMenuMarker(null);
      clearTransitInfoSelection();
    setSelectedTransitStop(null);
    const { primary } = photonResultLabel(feature);
    const properties = feature.properties as Record<string, unknown>;
    const address = [properties.housenumber, properties.street, properties.city]
      .filter(Boolean).join(' ') || undefined;
    const selection: LocationSelection = {
      name: primary,
      category: locationCategory(properties),
      address,
      coordinates: favorite?.coordinates ?? feature.geometry.coordinates,
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
    const routeTarget = routeSearchTarget;
    if (routeTarget) {
      if (window.innerWidth <= 760) {
        locationDetailsAbortRef.current?.abort();
        setLocationDetailsLoading(false);
        setSelectedLocation(null);
        (map.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
          type: 'FeatureCollection', features: [],
        });
      }
      setRouteEndpoint(routeTarget, selection);
    } else {
      pendingSearchCameraRef.current = selection.coordinates;
      prepareInfoPanelOpen();
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
    const panels = [...document.querySelectorAll<HTMLElement>(CONTENT_PANEL_SELECTOR)];
    const panelAnimations = panels.flatMap((panel) => panel.getAnimations({ subtree: true }));
    void Promise.allSettled(panelAnimations.map((animation) => animation.finished)).then(() => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(() => {
        const map = mapRef.current;
        if (!map || pendingSearchCameraRef.current !== coordinates) return;
        pendingSearchCameraRef.current = null;
        // Measure after the mobile sheet's entrance animation. Its transform
        // changes getBoundingClientRect without triggering ResizeObserver.
        // Keep the favourite coordinate as the camera target and express panel
        // composition in pixels. Calculating a geographic center offset before
        // zooming makes the displacement depend on the old zoom level.
        map.stop();
        selectionCameraActiveRef.current = true;
        map.once('moveend', () => { selectionCameraActiveRef.current = false; });
        map.easeTo({
          center: coordinates,
          zoom: Math.max(map.getZoom(), selectedTransitStop ? 14.6 : 14),
          offset: selectionCameraOffset(map),
          duration: 900,
        });
      });
    });
    return () => {
      cancelled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [positionInformation?.coordinates, selectedLocation, selectedTransitStop]);

  const locateUser = () => {
    if (!navigator.geolocation) {
      showMapToolNotice('Location is not available in this browser.');
      return;
    }
    showMapToolNotice('Finding your location...', null);
    const updateUserLocation = ({ coords, timestamp }: GeolocationPosition) => {
      if (timestamp < userLocationTimestampRef.current) return;
      const map = mapRef.current;
      const coordinates: [number, number] = [coords.longitude, coords.latitude];
      userLocationRef.current = coordinates;
      userLocationAccuracyRef.current = coords.accuracy;
      userLocationTimestampRef.current = timestamp;
      (map?.getSource('user-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} }],
      });
      locateFocusRef.current?.(coords);
    };

    const focusState = {
      centered: false,
      bestAccuracy: Number.POSITIVE_INFINITY,
    };
    const focusCoordinates = (coordinates: [number, number], accuracy: number) => {
      const map = mapRef.current;
      if (!map) return;
      const effectiveAccuracy = normalizedLocationAccuracy(accuracy);
      if (focusState.centered && !isMeaningfullyBetterLocation(focusState.bestAccuracy, effectiveAccuracy)) return;
      const refining = focusState.centered;
      focusState.centered = true;
      focusState.bestAccuracy = effectiveAccuracy;
      map.flyTo({
        center: coordinates,
        zoom: Math.max(map.getZoom(), locationZoomForAccuracy(effectiveAccuracy)),
        duration: refining ? 450 : 650,
      });
      showMapToolNotice(effectiveAccuracy <= 100 ? 'Location found' : 'Approximate location found');
      if (effectiveAccuracy <= 50) locateFocusRef.current = null;
    };
    const focusFromCoordinates = (coords: GeolocationCoordinates) => {
      focusCoordinates([coords.longitude, coords.latitude], coords.accuracy);
    };
    locateFocusRef.current = focusFromCoordinates;
    if (locateFocusTimerRef.current !== undefined) window.clearTimeout(locateFocusTimerRef.current);
    locateFocusTimerRef.current = window.setTimeout(() => {
      if (locateFocusRef.current === focusFromCoordinates) locateFocusRef.current = null;
      locateFocusTimerRef.current = undefined;
    }, 12_000);

    if (userLocationRef.current) {
      focusCoordinates(userLocationRef.current, userLocationAccuracyRef.current);
    }
    if (userLocationWatchRef.current === null) {
      userLocationWatchRef.current = navigator.geolocation.watchPosition(
        (position) => updateUserLocation(position),
        (error) => {
          if (error.code === error.PERMISSION_DENIED && locateFocusRef.current) {
            locateFocusRef.current = null;
            showMapToolNotice('Unable to access your location.');
          }
        },
        { enableHighAccuracy: true, maximumAge: 120_000, timeout: 15_000 },
      );
    }
    navigator.geolocation.getCurrentPosition(
      (position) => updateUserLocation(position),
      (fastError) => {
        if (fastError.code === fastError.PERMISSION_DENIED) {
          locateFocusRef.current = null;
          showMapToolNotice('Unable to access your location.');
          return;
        }
        if (focusState.centered) return;
        navigator.geolocation.getCurrentPosition(
          (position) => updateUserLocation(position),
          () => {
            if (!focusState.centered) {
              locateFocusRef.current = null;
              showMapToolNotice('Unable to access your location.');
            }
          },
          { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
        );
      },
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 1_500 },
    );
  };

  useEffect(() => () => {
    if (userLocationWatchRef.current !== null) navigator.geolocation.clearWatch(userLocationWatchRef.current);
    if (locateFocusTimerRef.current !== undefined) window.clearTimeout(locateFocusTimerRef.current);
  }, []);

  useEffect(() => () => {
    routeAddressAbortRef.current.origin?.abort();
    routeAddressAbortRef.current.destination?.abort();
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
        // The panel ResizeObserver fires during its entrance transition. Do
        // not let its delayed composition adjustment interrupt the street-level
        // zoom that opened this selection.
        if (pendingSearchCameraRef.current || selectionCameraActiveRef.current) return;
        const coordinates = selectedTransitStop?.coordinates
          ?? selectedLocation?.coordinates
          ?? positionInformation?.coordinates;
        if (coordinates) {
          if (recenterTimer !== undefined) window.clearTimeout(recenterTimer);
          recenterTimer = window.setTimeout(() => {
            if (pendingSearchCameraRef.current || selectionCameraActiveRef.current) return;
            map.easeTo({ center: coordinates, offset: selectionCameraOffset(map), duration: 250 });
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
    document.querySelectorAll<HTMLElement>(CONTENT_PANEL_SELECTOR)
      .forEach((panel) => observer?.observe(panel));
    window.addEventListener('resize', schedulePadding);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (recenterTimer !== undefined) window.clearTimeout(recenterTimer);
      observer?.disconnect();
      window.removeEventListener('resize', schedulePadding);
    };
  }, [mapLoaded, routeOpen, routeResult, selectedTransitStop, selectedLocation, positionInformation, routeSheetCollapsed, transitDetailsOpen]);

  const selectedTransitOption = useMemo(
    () => transitRouteOptions[selectedTransitRouteIndex],
    [transitRouteOptions, selectedTransitRouteIndex],
  );

  const setJourneyBackButton = useCallback((button: HTMLButtonElement | null) => {
    journeyBackButtonRef.current = button;
    button?.focus();
  }, []);

  const positionFavorite = positionInformation && favorites.find((favorite) => (
    favorite.id === positionInformation.favoriteId
    || (resolvedFavoriteEntityType(favorite) === 'position'
      && favorite.coordinates.join(',') === positionInformation.coordinates.join(','))
  ));

  const closeFavoriteDialog = () => {
    favoriteAddressAbortRef.current?.abort();
    setPendingFavorite(null);
    setContextMenuMarker(null);
  };

  const selectFavoriteKind = (kind: FavoriteKind) => {
    setPendingFavorite((current) => {
      if (!current) return current;
      const name = current.nameWasEdited
        ? current.name
        : kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : suggestedFavoriteName(current.selection);
      return { ...current, kind, name };
    });
  };

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
            searchPoweredByPhoton={!coordinateSearchFeature}
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
              if (coordinateSearchFeature) {
                pendingSearchSubmitRef.current = null;
                selectSearchResult(coordinateSearchFeature);
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
            themePreference={themePreference}
            onThemeChange={setThemePreference}
          />
          {routeContextMenu && (
            <MapContextMenu
              position={{ x: routeContextMenu.x, y: routeContextMenu.y }}
              onPositionInformation={() => {
                const coordinates: [number, number] = [...routeContextMenu.coordinates];
                openPositionInformation(positionInformationState(coordinates));
                setRouteContextMenu(null);
              }}
              onMeasureDistance={() => startMeasurement([...routeContextMenu.coordinates])}
              onSaveFavourite={() => {
                saveSelection({ name: 'Map point', category: 'Pinned location', coordinates: routeContextMenu.coordinates, source: 'map' });
                setRouteContextMenu(null);
              }}
              onRouteToHere={() => {
                const selection: LocationSelection = {
                  name: 'Map point', category: 'Pinned location', coordinates: routeContextMenu.coordinates, source: 'map',
                };
                openRoute();
                setContextMenuMarker(null);
                setRouteEndpoint('destination', selection);
              }}
              onRouteFromHere={() => {
                const selection: LocationSelection = {
                  name: 'Map point', category: 'Pinned location', coordinates: routeContextMenu.coordinates, source: 'map',
                };
                openRoute();
                setContextMenuMarker(null);
                setRouteEndpoint('origin', selection);
              }}
            />
          )}
          {positionInformation && (
            <aside className={`position-information mobile-bottom-sheet${positionSheet.dragging ? ' is-dragging' : ''}`} style={positionSheet.style} data-snap={positionSheet.snap} role="dialog" aria-modal="true" aria-labelledby="position-information-title">
              <MobileSheetHandle {...positionSheet} closeLabel="Close position information" onClose={() => {
                setPositionInformation(null);
                setContextMenuMarker(null);
              }} />
              <button className="location-info-close" type="button" aria-label="Close position information" onClick={() => {
                setPositionInformation(null);
                setContextMenuMarker(null);
              }}><X aria-hidden="true" /></button>
              <div className="position-information-heading">
                <span className="location-info-icon" aria-hidden="true"><Mountain size={20} /></span>
                <div><span className="location-info-category">Map point</span><h2 id="position-information-title">Position information</h2></div>
              </div>
              <InfoActionRow actions={[
                positionFavorite
                  ? { label: 'Edit favourite', icon: Pencil, iconOnly: true, onClick: () => editFavorite(positionFavorite) }
                  : { label: 'Save', icon: Star, disabled: positionInformation.address.status === 'loading', onClick: () => saveSelection({
                      name: 'Map point',
                      category: 'Pinned location',
                      coordinates: positionInformation.coordinates,
                      source: 'map',
                      address: positionInformation.address.status === 'available' ? positionInformation.address.address : undefined,
                    }) },
                ...(positionFavorite ? [{ label: 'Remove favourite', icon: Trash2, iconOnly: true, onClick: () => setFavorites((items) => items.filter((item) => item.id !== positionFavorite.id)) }] : []),
                { label: 'Share', icon: Share2, onClick: () => shareSelection({
                  type: 'position', coordinates: positionInformation.coordinates, zoom: Math.max(mapRef.current?.getZoom() ?? 16, 15),
                }, 'Map position') },
                { label: 'Directions', icon: Navigation, tone: 'primary', onClick: () => {
                  const selection: LocationSelection = {
                    name: defaultPositionName(
                      positionInformation.coordinates,
                      positionInformation.address.status === 'available' ? positionInformation.address.address : undefined,
                    ),
                    category: 'Pinned location',
                    coordinates: positionInformation.coordinates,
                    source: 'map',
                    address: positionInformation.address.status === 'available' ? positionInformation.address.address : undefined,
                  };
                  openRoute();
                  setRouteEndpoint('destination', selection);
                  setPositionInformation(null);
                  setContextMenuMarker(null);
                }},
              ]} />
              <div className="position-information-content">
                <div className="position-information-field">
                  <strong>Address</strong>
                  {positionInformation.address.status === 'loading' && <span className="position-information-muted" aria-live="polite">Finding street address...</span>}
                  {positionInformation.address.status === 'available' && <span>{positionInformation.address.address}</span>}
                  {positionInformation.address.status === 'unavailable' && <span className="position-information-muted">No street address found</span>}
                </div>
                <div className="position-information-field">
                  <strong>Latitude, longitude</strong>
                  <span>{formatCoordinates(positionInformation.coordinates)}</span>
                </div>
                {hasDisplayableElevation(positionInformation.elevation, is3dMode) && (<>
                  <div className="position-information-field">
                    <strong>Approximate terrain elevation</strong>
                    <span>{formatElevation(positionInformation.elevation.metres)}</span>
                  </div>
                  <small>Ground surface from the configured terrain DEM.</small>
                </>)}
              </div>
            </aside>
          )}
          {measurement && (
            <aside className="measurement-panel" aria-label="Distance measurement">
              <span>Distance · {measurement.points.length} {measurement.points.length === 1 ? 'point' : 'points'}</span>
              <strong aria-live="polite">{formatDistance(measurement.metres)}</strong>
              <small>Click the map to add points. Click a point to remove it.</small>
              <div>
                <button
                  className="measurement-undo"
                  type="button"
                  disabled={measurement.points.length <= 1}
                  onClick={() => measurementControllerRef.current?.undo()}
                >Undo</button>
                <button className="measurement-finish" type="button" onClick={stopMeasurement}>Finish</button>
                <button type="button" onClick={stopMeasurement}>Cancel</button>
              </div>
            </aside>
          )}
          {pendingFavorite && (
            <div className="favorite-menu-backdrop" role="presentation" onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeFavoriteDialog();
            }}>
              <form
                className="favorite-menu"
                role="dialog"
                aria-modal="true"
                aria-labelledby="favorite-menu-title"
                onKeyDown={(event) => { if (event.key === 'Escape') closeFavoriteDialog(); }}
                onSubmit={(event) => {
                  event.preventDefault();
                  confirmFavorite();
                }}
              >
                <button className="favorite-menu-close" type="button" aria-label="Close" onClick={closeFavoriteDialog}>
                  <X size={18} aria-hidden="true" />
                </button>
                <span className="favorite-menu-eyebrow">{pendingFavorite.editingFavoriteId ? 'Edit favourite' : 'Save place'}</span>
                <h2 id="favorite-menu-title">{pendingFavorite.editingFavoriteId ? 'Edit favourite' : 'Save as favourite'}</h2>
                <p>{pendingFavorite.editingFavoriteId ? 'Update the name of this saved place.' : 'Give this place a useful name and choose how it should appear on the map.'}</p>
                <label className="favorite-name-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    maxLength={120}
                    required
                    value={pendingFavorite.name}
                    onChange={(event) => setPendingFavorite((current) => current
                      ? { ...current, name: event.target.value, nameWasEdited: true }
                      : current)}
                  />
                  {pendingFavorite.addressLoading && <small aria-live="polite">Looking up the street address...</small>}
                </label>
                {!pendingFavorite.editingFavoriteId && <fieldset className="favorite-kind-group">
                  <legend className="favorite-kind-label">Type</legend>
                  <div className="favorite-kind-options">
                  <button className={pendingFavorite.kind === 'home' ? 'selected' : ''} type="button" aria-pressed={pendingFavorite.kind === 'home'} onClick={() => selectFavoriteKind('home')}>
                    <House aria-hidden="true" /><span><strong>Home</strong><small>Save as Home</small></span>
                  </button>
                  <button className={pendingFavorite.kind === 'work' ? 'selected' : ''} type="button" aria-pressed={pendingFavorite.kind === 'work'} onClick={() => selectFavoriteKind('work')}>
                    <BriefcaseBusiness aria-hidden="true" /><span><strong>Work</strong><small>Save as Work</small></span>
                  </button>
                  <button className={pendingFavorite.kind === 'favorite' ? 'selected' : ''} type="button" aria-pressed={pendingFavorite.kind === 'favorite'} onClick={() => selectFavoriteKind('favorite')}>
                    <Star aria-hidden="true" /><span><strong>Favourite</strong><small>Standard saved place</small></span>
                  </button>
                  </div>
                </fieldset>}
                <div className="favorite-menu-actions">
                  <button type="button" onClick={closeFavoriteDialog}>Cancel</button>
                  <button type="submit" disabled={!pendingFavorite.name.trim() || pendingFavorite.addressLoading}>
                    {pendingFavorite.addressLoading ? 'Finding address...' : pendingFavorite.editingFavoriteId ? 'Save changes' : 'Save favourite'}
                  </button>
                </div>
              </form>
            </div>
          )}
          {selectedTransitStop && (
            <Suspense fallback={null}><TransitDeparturesPanel
              stop={selectedTransitStop}
              onDetailOpenChange={setTransitDepartureDetailOpen}
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
              onShare={() => shareSelection({
                type: 'stop', coordinates: selectedTransitStop.coordinates,
                zoom: Math.max(mapRef.current?.getZoom() ?? 16, 15), provider: selectedTransitStop.provider,
                id: selectedTransitStop.stopId, name: selectedTransitStop.name,
              }, selectedTransitStop.name)}
              onSaveFavorite={() => saveSelection({
                name: selectedTransitStop.name,
                category: 'Transit stop',
                coordinates: selectedTransitStop.coordinates,
                source: 'map',
                transitStopId: selectedTransitStop.stopId,
                transitStopProvider: selectedTransitStop.provider,
                transitMode: selectedTransitStop.mode,
              }, 'transit', `${selectedTransitStop.provider}:${selectedTransitStop.stopId}`)}
              onEditFavorite={selectedTransitFavorite ? () => {
                editFavorite(selectedTransitFavorite);
              } : undefined}
              onRemoveFavorite={selectedTransitFavorite ? () => {
                setFavorites((items) => items.filter((item) => item.id !== selectedTransitFavorite.id));
                setSelectedTransitStop((stop) => stop ? { ...stop, favoriteId: undefined } : stop);
              } : undefined}
              onClose={() => {
                const routeVehicleRestore = routeVehicleRestoreRef.current;
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                setVehicleFollowAvailable(false);
                transitStopsLayerRef.current?.clearSelection();
                setSelectedTransitStop(null);
                routeVehicleRestoreRef.current = null;
                if (routeVehicleRestore && routeOpen && routeMode === 'transit' && routeResult === routeVehicleRestore.result) {
                  plannedVehicleTripRef.current = null;
                  showTransitLegVehicle(routeVehicleRestore.result);
                  vehicleFollowEnabledRef.current = routeVehicleRestore.following;
                  setVehicleFollowing(routeVehicleRestore.following);
                }
              }}
              isFollowing={vehicleFollowing}
              positionStatus={vehiclePositionStatus}
            /></Suspense>
          )}
          {routeResult && routeOpen && (
            <div className={`map-camera-actions${selectedLocation || selectedTransitStop || positionInformation ? ' info-panel-open' : ''}`} aria-label="Map camera controls">
              {routeMode === 'transit' && vehicleFollowAvailable && (
                <button
                  className="map-floating-action"
                  type="button"
                  aria-pressed={vehicleFollowing}
                  onClick={vehicleFollowing ? pauseVehicleFollow : resumeVehicleFollow}
                >
                  {vehicleFollowing
                    ? `Following ${vehiclePositionStatus === 'live' ? 'live' : 'estimated'} vehicle`
                    : `Follow ${vehiclePositionStatus === 'live' ? 'live' : 'estimated'} vehicle`}
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
              <MobileSheetHandle
                {...locationSheet}
                closeLabel="Close location information"
                onClose={() => {
                  locationDetailsAbortRef.current?.abort();
                  setLocationDetailsLoading(false);
                  setSelectedLocation(null);
                  (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
                    type: 'FeatureCollection', features: [],
                  });
                }}
              />
              <div className="location-info-header">
                <div
                  className="location-info-icon"
                  aria-hidden="true"
                  style={{ backgroundColor: LOCATION_ICON_COLORS[selectedIconKey] ?? '#64748b' }}
                >
                  <SelectedLocationIcon size={20} strokeWidth={2.4} />
                </div>
                <div>
                  <span className="location-info-category">{selectedLocation.category}</span>
                  <h2>{selectedLocation.name}</h2>
                  {selectedLocation.address && <p>{selectedLocation.address}</p>}
                </div>
              </div>
              <div className="location-info-content" tabIndex={0}>
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
                <InfoActionRow actions={[
                ...(() => {
                  const favorite = favorites.find((item) => item.id === selectedLocation.favoriteId
                    || item.id === selectedLocation.osmId
                    || item.coordinates.join(',') === selectedLocation.coordinates.join(','));
                  return favorite
                    ? [{ label: 'Edit favourite', icon: Pencil, onClick: () => editFavorite(favorite), iconOnly: true }, { label: 'Remove favourite', icon: Trash2, onClick: () => setFavorites((items) => items.filter((item) => item.id !== favorite.id)), iconOnly: true }]
                    : [{ label: 'Save', icon: Star, onClick: () => saveSelection(selectedLocation, selectedLocation.osmId ? 'osm' : undefined, selectedLocation.osmId ? `${selectedLocation.osmType ?? ''}${selectedLocation.osmId}` : undefined) }];
                })(), { label: 'Share', icon: Share2, onClick: () => shareSelection({
                  type: selectedLocation.osmId ? 'poi' : 'position', coordinates: selectedLocation.coordinates,
                  zoom: Math.max(mapRef.current?.getZoom() ?? 16, 15),
                  id: selectedLocation.osmId ? `${selectedLocation.osmType ?? ''}${selectedLocation.osmId}` : undefined,
                  provider: selectedLocation.osmId ? 'osm' : undefined, name: selectedLocation.name,
                }, selectedLocation.name) }, { label: 'Directions', icon: Navigation, tone: 'primary', onClick: () => {
                  openRoute();
                  setRouteEndpoint('destination', selectedLocation);
                }}
                ]} />
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
                <X aria-hidden="true" />
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
            <aside className={`route-panel mobile-bottom-sheet${routeSheetCollapsed ? ' route-sheet-collapsed' : ''}${routeSheet.dragging ? ' is-dragging' : ''}${transitDetailsOpen ? ' transit-journey-detail' : ''}`} style={routeSheet.style} data-snap={routeSheet.snap} aria-label={transitDetailsOpen ? 'Journey details' : 'Route details'}>
              <MobileSheetHandle {...routeSheet} closeLabel="Close route planner" onClose={cancelRoute} />
              {transitDetailsOpen && (
                <Suspense fallback={null}><TransitJourneyHeader
                  originName={routeOriginSelection?.name}
                  destinationName={routeDestinationSelection?.name}
                  selectedOption={selectedTransitOption}
                  backButtonRef={setJourneyBackButton}
                  onBack={closeTransitDetails}
                /></Suspense>
              )}
              <div className="route-panel-heading" {...routeSheet.handleProps}>
                <div><strong>Plan a route</strong><span>Search for a place or pick it on the map</span></div>
                <button className="route-panel-close" type="button" aria-label="Close route planner" onClick={cancelRoute}><X aria-hidden="true" /></button>
              </div>
              <div className="route-panel-body">
              <div className="route-planner-controls">
              <div className="route-endpoints">
                {(['origin', 'destination'] as const).map((kind) => {
                  const selection = kind === 'origin' ? routeOriginSelection : routeDestinationSelection;
                  const label = kind === 'origin' ? 'Starting point' : 'Destination';
                  return (
                    <div className="route-endpoint-group" key={kind}>
                      <div
                        className={`route-search-field${routeSearchTarget === kind ? ' active' : ''}`}
                        ref={(element) => { routeSearchAnchorRefs.current[kind] = element; }}
                      >
                        <MapPin aria-hidden="true" />
                        <input
                          aria-label={`Search ${label.toLowerCase()}`}
                          aria-controls={`route-${kind}-search-results`}
                          aria-expanded={routeSearchTarget === kind}
                          placeholder={`Search ${label.toLowerCase()}`}
                          value={routeSearchTarget === kind ? searchQuery : (selection?.name ?? '')}
                          onFocus={() => beginRouteSearch(kind)}
                          onChange={(event) => {
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
                            }}
                          >
                            <X aria-hidden="true" />
                          </button>
                        )}
                        <button type="button" className="route-map-button" onClick={() => pickRouteEndpoint(kind)}>
                          Map
                        </button>
                      </div>
                      {routeSearchTarget === kind && createPortal(
                        <div
                          className="route-search-results route-search-results-floating"
                          id={`route-${kind}-search-results`}
                          ref={routeSearchResultsRef}
                          role="listbox"
                          aria-label={`Search ${label.toLowerCase()} results`}
                        >
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
                        </div>,
                        document.body,
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="route-endpoint-swap"
                  aria-label="Swap starting point and destination"
                  title="Swap start and destination"
                  onClick={swapRouteEndpoints}
                  disabled={!routeOriginSelection && !routeDestinationSelection}
                >
                  <ArrowRightLeft aria-hidden="true" />
                </button>
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
                <TransitRouteOptions
                  options={transitRouteOptions}
                  selectedIndex={selectedTransitRouteIndex}
                  onSelect={selectTransitRoute}
                />
              )}
              </div>
              {routeResult && !routeLoading && (
                <>
                  {routeResult.provider && (
                    <div className="route-provider-status" role="status">
                      <span className="route-provider-status-dot" aria-hidden="true" />
                      {routeResult.provider === 'digitransit' ? 'Digitransit routing'
                        : routeResult.provider === 'transitous' ? 'Transitous routing'
                          : routeResult.provider === 'osrm' ? 'OSRM routing' : 'Valhalla routing'}
                    </div>
                  )}
                  {routeMode !== 'transit' && <div className="route-summary">
                    <strong>{routeResult.distanceKm < 1 ? `${Math.round(routeResult.distanceKm * 1000)} m` : `${routeResult.distanceKm.toFixed(1)} km`}</strong>
                    <span>{routeResult.durationSeconds < 3600 ? `${Math.round(routeResult.durationSeconds / 60)} min` : `${Math.floor(routeResult.durationSeconds / 3600)} h ${Math.round(routeResult.durationSeconds % 3600 / 60)} min`}</span>
                  </div>}
                  {routeMode === 'transit' && routeResult.transitLegs && (
                    <button
                      ref={journeyDetailsToggleRef}
                      className="transit-route-details-toggle"
                      type="button"
                      onClick={transitDetailsOpen ? closeTransitDetails : openTransitDetails}
                    >
                      {transitDetailsOpen ? 'Hide journey details' : 'View journey details'}
                      <ArrowRight aria-hidden="true" />
                    </button>
                  )}
                  {routeMode === 'transit' && transitDetailsOpen && routeResult.transitLegs && (
                    <Suspense fallback={null}><TransitJourneyDetails
                      routeResult={routeResult}
                      destinationName={routeDestinationSelection?.name}
                      selectedOption={selectedTransitOption}
                    /></Suspense>
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
