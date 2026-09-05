import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  Pencil,
  Plane,
  Shield,
  Star,
  X,
  Droplets,
  Dumbbell,
  Flag,
  Mountain,
  Navigation,
  PawPrint,
  Sailboat,
  ShoppingBag,
  Share2,
  Smile,
  Snowflake,
  SquareParking,
  Store,
  Ticket,
  TentTree,
  Toilet,
  Trash2,
  TreePine,
  Utensils,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TreeModelLayer, treeViewportSignature } from './TreeModelLayer';
import { MapControls, type MapLayerState } from './MapControls';
import { MAP_COLORS } from './MapPalette';
import { TransitStopsLayer } from './TransitStopsLayer';
import type { TransitVehicleTripSelection } from './TransitStopsLayer';
import { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import { TransitRouteOverlay } from './TransitRouteOverlay';
import { FlightControls } from './flight/FlightControls';
import { FlightTreeModelLayer } from './flight/FlightTreeModelLayer';
import { useFlightSimulator } from './flight/useFlightSimulator';
import { useFlightModePresentation } from './flight/useFlightModePresentation';
const TransitDeparturesPanel = lazy(() => import('./TransitDeparturesPanel').then((module) => ({ default: module.TransitDeparturesPanel })));
import type { TransitStopSelection } from './TransitStopsLayer';
import { fetchValhallaRoute, type RouteMode, type RouteResult } from './ValhallaRouting';
import { fetchTransitRoutes, type TransitRouteResult } from './TransitRouting';
import {
  isWalkingTransitMode,
} from './TransitRouteOptions';
const TransitJourneyDetails = lazy(() => import('./TransitJourneyDetails').then((module) => ({ default: module.TransitJourneyDetails })));
const TransitJourneyHeader = lazy(() => import('./TransitJourneyDetails').then((module) => ({ default: module.TransitJourneyHeader })));
import { MapContextMenu } from './MapContextMenu';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';
import { rankNearbyPlaces, type NearbyPlace } from './NearbyPlaces';
import {
  HIKING_POI_CLASSES,
  SPORT_FACILITY_POI_CLASSES,
  sportFacilityIconId,
} from './PoiClasses';
import { MapCameraActions } from './MapCameraActions';
import { RoutePlannerControls } from './RoutePlannerControls';
import { PositionInformationPanel } from './PositionInformationPanel';
import { LocationInformationPanel } from './LocationInformationPanel';
import { TrafficCameraPanel } from './TrafficCameraPanel';
import { TrafficCamerasLayer, trafficCameraFeatureAt } from './TrafficCamerasLayer';
import { RoadWeatherPanel } from './RoadWeatherPanel';
import { RoadWeatherLayer, roadWeatherFeatureAt } from './RoadWeatherLayer';
import { RoadTrafficPanel } from './RoadTrafficPanel';
import { RoadTrafficMessagePanel } from './RoadTrafficMessagePanel';
import { RoadTrafficLayer, roadTrafficFeatureAt } from './RoadTrafficLayer';
import { ChargingStationPanel } from './ChargingStationPanel';
import { ChargingStationsLayer, chargingStationFeatureAt } from './ChargingStationsLayer';
import { ChargingStationsConfigError } from './ChargingStations';
import { parseLocationMetadata, safeHttpUrl } from './LocationMedia';
import { InfoActionRow } from '../components/InfoActionRow';
import { localDateTimeValue, useRoutePlanning, type LocationSelection } from './useRoutePlanning';
import {
  fetchDigitransitRoute,
  journeyVehicleKey,
  resolveJourneyVehicleLegs,
  type TransitProviderId,
} from './transit';
import { coordinateBounds, panelPaddingForRects, removeIsolatedCoordinateOutliers } from './RouteCamera';
import { defaultPositionName, elevationResult, formatCoordinates, formatNominatimAddress, queryTerrainElevation } from './PositionInformation';
import { useInfoPanelState, type PositionInformationState } from './useInfoPanelState';
import { useTransitVehicleFollow } from './useTransitVehicleFollow';
import { useRouteVehicleRestore } from './useRouteVehicleRestore';
import { useMapSearch, type PhotonFeature } from './useMapSearch';
import { useRouteExecution } from './useRouteExecution';
import { useMapTools } from './useMapTools';
import { usePanelCoordinator } from './usePanelCoordinator';
import { useMapLayerVisibility } from './useMapLayerVisibility';
import { useViewedWeather } from './useViewedWeather';
import { WeatherChip } from './WeatherChip';
import { WeatherPanel } from './WeatherPanel';
import { WeatherTimeSlider, weatherSliderTimes } from './WeatherTimeSlider';
import { DistanceMeasurementController, formatDistance, type Measurement } from './DistanceMeasurement';
import { availableGpsEndpoint, isMeaningfullyBetterLocation, locationZoomForAccuracy, markerFeatureCollection, normalizedLocationAccuracy } from './LocationMarkers';
import { installPersistedMapViewFlush, loadPersistedMapView, savePersistedMapView } from './PersistedMapView';
import { useInAppNavigation } from '../lib/useInAppNavigation';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { installForegroundRecovery } from '../lib/ForegroundRecovery';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { createMapDeepLink, parseMapDeepLink, shareMapDeepLink, type MapDeepLink } from '../lib/DeepLink';
import { useTheme } from '../theme';
import { fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';
import { RequestRateGate } from './RequestRateGate';
import { favoriteMapFeatures, findTransitFavorite, loadFavorites, resolvedFavoriteEntityType, saveFavorites, upsertFavorite, type Favorite, type FavoriteKind } from '../lib/Favorites';
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
const CONTENT_PANEL_SELECTOR = '.route-panel, .transit-departures-panel, .location-info-panel, .position-information, .nearby-panel, .weather-time-slider';

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
    website: safeHttpUrl(website),
    ...parseLocationMetadata(detailProperties),
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
  ...SPORT_FACILITY_POI_CLASSES,
  ...HIKING_POI_CLASSES,
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
  ['playground', Smile], ['sports_centre', Dumbbell], ['golf', Flag],
  ['swimming', Waves], ['ice_rink', Snowflake], ['marina', Sailboat],
  ['dog_park', PawPrint], ['bbq', Flame], ['winter_sports', Snowflake],
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
  playground: '#d4a24c', sports_centre: '#5f8a65', golf: '#6d9a71',
  swimming: '#4383ad', ice_rink: '#5b7ea6', marina: '#557f91',
  dog_park: '#8a704c', bbq: '#ba625e', winter_sports: '#5b7ea6',
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
  ...SPORT_FACILITY_POI_CLASSES
    .map((className): [string, string] => [className, sportFacilityIconId(className)])
    .filter(([className, iconId]) => className !== iconId),
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
  ['sports_centre', 8], ['golf', 9], ['golf_course', 9], ['miniature_golf', 10],
  ['swimming', 9], ['swimming_area', 9], ['water_park', 9], ['marina', 9], ['harbor', 9],
  ['ice_rink', 9], ['playground', 10], ['swimming_pool', 11], ['pitch', 12],
  ['dog_park', 10], ['bbq', 11], ['winter_sports', 9],
  ['tennis', 12], ['basketball', 12], ['volleyball', 12], ['athletics', 12],
  ['skiing', 10], ['climbing', 11], ['skateboard', 12],
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
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13.5, 1.3, 15.5, 1.48, 18, 1.62] as ExpressionSpecification,
          'icon-padding': 8,
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

export function MapView({ onFlightModeChange }: { onFlightModeChange?: (active: boolean) => void }) {
  const { preference: themePreference, resolvedTheme, setPreference: setThemePreference } = useTheme();
  const initialDeepLinkRef = useRef<MapDeepLink | null>(parseMapDeepLink(window.location.search));
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const treeRefreshRef = useRef<(() => void) | null>(null);
  const treeLayerRef = useRef<TreeModelLayer | null>(null);
  const transitStopsLayerRef = useRef<TransitStopsLayer | null>(null);
  const trafficCamerasLayerRef = useRef<TrafficCamerasLayer | null>(null);
  const roadWeatherLayerRef = useRef<RoadWeatherLayer | null>(null);
  const roadTrafficLayerRef = useRef<RoadTrafficLayer | null>(null);
  const chargingStationsLayerRef = useRef<ChargingStationsLayer | null>(null);
  const transitVehicleLayerRef = useRef<TransitVehicleModelLayer | null>(null);
  const transitRouteOverlayRef = useRef<TransitRouteOverlay | null>(null);
  const flightTreeLayerRef = useRef<FlightTreeModelLayer | null>(null);
  const flightActiveRef = useRef(false);
  const flightWasActiveRef = useRef(false);
  const plannedVehicleTripRef = useRef<string | null>(null);
  const terrainSourceRef = useRef('terrain');
  const terrainEnabledRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [orientationChanged, setOrientationChanged] = useState(false);
  const routePlanning = useRoutePlanning();
  const {
    selectedTransitStop,
    setSelectedTransitStop,
    selectedLocation,
    setSelectedLocation,
    selectedTrafficCamera,
    setSelectedTrafficCamera,
    selectedChargingStation,
    setSelectedChargingStation,
    selectedRoadWeather,
    setSelectedRoadWeather,
    selectedRoadTraffic,
    setSelectedRoadTraffic,
    selectedRoadTrafficMessage,
    setSelectedRoadTrafficMessage,
    positionInformation,
    setPositionInformation,
    closePositionInformation,
    closeLocationInformation,
    closeTrafficCamera,
    closeChargingStation,
    closeRoadWeather,
    closeRoadTraffic,
    closeRoadTrafficMessage,
  } = useInfoPanelState();
  const [transitDepartureDetailOpen, setTransitDepartureDetailOpen] = useState(false);
  const [transitNavigationBackSignal, setTransitNavigationBackSignal] = useState(0);
  const {
    vehicleFollowEnabledRef,
    latestVehiclePoseRef,
    vehicleFollowing,
    setVehicleFollowing,
    vehicleFollowingRef,
    vehicleFollowAvailable,
    setVehicleFollowAvailable,
    vehiclePositionStatus,
    setVehiclePositionStatus,
  } = useTransitVehicleFollow();
  const { remember: rememberRouteVehicle, take: takeRouteVehicleRestore } = useRouteVehicleRestore();
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapToolNotice, setMapToolNotice] = useState<string | null>(null);
  const mapToolNoticeTimerRef = useRef<number | undefined>(undefined);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);
  const favoritesRef = useRef(favorites);
  const [pendingFavorite, setPendingFavorite] = useState<PendingFavorite | null>(null);
  const lastSearchFitRef = useRef('');
  const [locationDetailsLoading, setLocationDetailsLoading] = useState(false);
  const [contextMenuMarker, setContextMenuMarker] = useState<[number, number] | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[] | null>(null);
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
  } = routePlanning;
  const routeVehicleViewRef = useRef(Boolean(routeOpen && routeResult));
  routeVehicleViewRef.current = Boolean(routeOpen && routeResult);
  const routeResultRef = useRef(routeResult);
  routeResultRef.current = routeResult;
  const locationSheet = useMobileBottomSheet('half');
  const positionSheet = useMobileBottomSheet('half');
  const trafficCameraSheet = useMobileBottomSheet('half');
  const chargingStationSheet = useMobileBottomSheet('half');
  const roadWeatherSheet = useMobileBottomSheet('half');
  const roadTrafficSheet = useMobileBottomSheet('half');
  const roadTrafficMessageSheet = useMobileBottomSheet('half');
  const weatherSheet = useMobileBottomSheet('half');
  const pendingSearchCameraRef = useRef<[number, number] | null>(null);
  const selectionCameraActiveRef = useRef(false);
  const lastUserInteractionRef = useRef(0);
  const locationDetailsAbortRef = useRef<AbortController | null>(null);
  const nominatimCacheRef = useRef(new globalThis.Map<string, Partial<LocationSelection>>());
  const nominatimRequestGateRef = useRef(new RequestRateGate(1_100));
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
  const closeNearby = useCallback(() => {
    setNearbyPlaces(null);
    setContextMenuMarker(null);
  }, []);
  const routeSheetHeight = routeSheet.height;
  useLayoutEffect(() => {
    if (!routeSearchTarget) return;

    const updatePosition = () => {
      const anchor = routeSearchAnchorRefs.current[routeSearchTarget];
      const results = routeSearchResultsRef.current;
      if (!anchor || !results) return;

      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      // visualViewport can report the visual CSS viewport independently from
      // the layout viewport (notably in headless Chromium and while a mobile
      // keyboard is transitioning). Fixed portals are still measured against
      // the layout viewport, so never position outside the smaller one.
      const viewportWidth = Math.min(window.innerWidth, viewport?.width ?? window.innerWidth);
      const viewportHeight = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      const viewportBottom = Math.min(window.innerHeight, viewportTop + viewportHeight);
      const margin = 12;
      const gap = 6;
      const spaceBelow = viewportBottom - rect.bottom - gap - margin;
      const spaceAbove = rect.top - viewportTop - gap - margin;
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow);
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

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    const anchor = routeSearchAnchorRefs.current[routeSearchTarget];
    if (anchor) observer.observe(anchor);
    if (routeSearchResultsRef.current) observer.observe(routeSearchResultsRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [routeSearchTarget, routeSheetHeight]);
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
      trafficCameras: false,
      chargingStations: false,
      roadWeather: false,
      roadTraffic: false,
      weather: true,
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
  const handleTransitDisabled = useCallback(() => {
    transitStopsLayerRef.current?.clearSelection();
    setSelectedTransitStop(null);
  }, []);
  const handleTrafficCamerasDisabled = useCallback(() => {
    trafficCamerasLayerRef.current?.clearSelection();
    setSelectedTrafficCamera(null);
  }, []);
  const handleChargingStationsDisabled = useCallback(() => {
    chargingStationsLayerRef.current?.clearSelection();
    setSelectedChargingStation(null);
  }, []);
  const handleRoadWeatherDisabled = useCallback(() => {
    roadWeatherLayerRef.current?.clearSelection();
    setSelectedRoadWeather(null);
  }, []);
  const handleRoadTrafficDisabled = useCallback(() => {
    roadTrafficLayerRef.current?.clearSelection();
    setSelectedRoadTraffic(null);
    setSelectedRoadTrafficMessage(null);
  }, []);
  const trafficCamerasEnabledRef = useRef(layerToggles.trafficCameras);
  trafficCamerasEnabledRef.current = layerToggles.trafficCameras;
  const chargingStationsEnabledRef = useRef(layerToggles.chargingStations);
  chargingStationsEnabledRef.current = layerToggles.chargingStations;
  const roadWeatherEnabledRef = useRef(layerToggles.roadWeather);
  roadWeatherEnabledRef.current = layerToggles.roadWeather;
  const roadTrafficEnabledRef = useRef(layerToggles.roadTraffic);
  roadTrafficEnabledRef.current = layerToggles.roadTraffic;
  const flight = useFlightSimulator({
    mapRef,
    mapLoaded,
    activeRef: flightActiveRef,
    terrainSourceRef,
    terrainEnabledRef,
    resolvedTheme,
  });
  useMapLayerVisibility({
    mapRef,
    mapLoaded,
    layerToggles,
    resolvedTheme,
    treeLayerRef,
    transitRouteOverlayRef,
    transitVehicleLayerRef,
    treeRefreshRef,
    terrainSourceRef,
    terrainEnabledRef,
    flightActiveRef,
    flightActive: flight.active,
    building3dLayerIds: BUILDING_3D_LAYER_IDS,
    buildingShadowLayerIds: BUILDING_SHADOW_LAYER_IDS,
    buildingTransitionFootprintLayerId: GLOBAL_BUILDING_TRANSITION_FOOTPRINT_LAYER_ID,
    building2dLayerId: GLOBAL_BUILDING_2D_LAYER_ID,
    cyclingLayerIds: GLOBAL_CYCLING_LAYER_IDS,
    hikingLayerIds: GLOBAL_HIKING_LAYER_IDS,
    waterEffectLayerIds: WATER_EFFECT_LAYER_IDS,
    onTransitDisabled: handleTransitDisabled,
    onTrafficCamerasDisabled: handleTrafficCamerasDisabled,
    onChargingStationsDisabled: handleChargingStationsDisabled,
    onRoadWeatherDisabled: handleRoadWeatherDisabled,
    onRoadTrafficDisabled: handleRoadTrafficDisabled,
  });
  const viewedWeather = useViewedWeather({
    mapRef,
    mapLoaded,
    enabled: layerToggles.weather,
    flightActive: flight.active,
  });
  useFlightModePresentation({
    mapRef,
    mapLoaded,
    active: flight.active,
    transitRouteOverlayRef,
    transitLinesVisible: layerToggles.transitLines,
  });
  useEffect(() => {
    onFlightModeChange?.(flight.active);
    return () => onFlightModeChange?.(false);
  }, [flight.active, onFlightModeChange]);
  useEffect(() => {
    if (flight.active) {
      flightWasActiveRef.current = true;
      return;
    }
    if (!flightWasActiveRef.current) return;
    flightWasActiveRef.current = false;
    const frame = window.requestAnimationFrame(() => mapRef.current?.getCanvas().focus());
    return () => window.cancelAnimationFrame(frame);
  }, [flight.active]);
  useEffect(() => {
    const map = mapRef.current;
    if (!flight.active || !mapLoaded || !layerToggles.trees || !map) return;

    const flightTreeLayer = new FlightTreeModelLayer({
      sourceId: OPENFREEMAP_SOURCE_ID,
      waterLayers: ['water'],
      vegetationLayers: ['landcover', 'landuse', 'park'],
    });
    flightTreeLayer.setExtendedViewportRange(true);
    try {
      map.addLayer(
        flightTreeLayer,
        map.getLayer('global-road-labels') ? 'global-road-labels' : undefined,
      );
    } catch (error) {
      if (map.getLayer(flightTreeLayer.id)) map.removeLayer(flightTreeLayer.id);
      console.error('Flight mode stopped because flight trees could not be initialized.', error);
      flight.stop();
      return;
    }
    flightTreeLayerRef.current = flightTreeLayer;
    if (map.getLayer('tree-models-3d')) {
      map.setLayoutProperty('tree-models-3d', 'visibility', 'none');
    }
    flightTreeLayer.updateTrees();
    const intervalId = window.setInterval(() => flightTreeLayer.updateTrees(), 4000);

    return () => {
      window.clearInterval(intervalId);
      if (mapRef.current !== map) return;
      try {
        if (map.getLayer(flightTreeLayer.id)) map.removeLayer(flightTreeLayer.id);
      } catch (error) {
        console.error('Flight trees could not be removed.', error);
      }
      flightTreeLayerRef.current = null;
      if (map.getLayer('tree-models-3d')) {
        map.setLayoutProperty(
          'tree-models-3d',
          'visibility',
          layerToggles.trees ? 'visible' : 'none',
        );
      }
      if (layerToggles.trees) treeRefreshRef.current?.();
    };
  }, [flight.active, flight.stop, layerToggles.trees, mapLoaded]);
  useEffect(() => {
    if (!flight.active) return;
    flightTreeLayerRef.current?.setTheme(resolvedTheme === 'dark');
  }, [flight.active, resolvedTheme]);
  const {
    searchQuery, setSearchQuery, searchResults, setSearchResults, searchOpen, setSearchOpen,
    searchLoading, searchError, setSearchError, searchResultsQuery,
    highlightedSearchResults, setHighlightedSearchResults, coordinateSearchFeature, favoriteFeatures, displayedSearchResults,
    pendingSearchSubmitRef, selectedSearchQueryRef,
  } = useMapSearch(mapRef, favorites, favoritesOpen, layerToggles.transit);

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
  useEffect(() => {
    const layer = trafficCamerasLayerRef.current;
    if (!mapLoaded || !layer || !layerToggles.trafficCameras) return;
    void layer.update().catch(() => {
      showMapToolNotice('Traffic cameras could not be loaded.');
    });
  }, [mapLoaded, layerToggles.trafficCameras]);
  useEffect(() => {
    const layer = chargingStationsLayerRef.current;
    const map = mapRef.current;
    if (!mapLoaded || !map || !layer || !layerToggles.chargingStations) return;
    void layer.update(map.getBounds(), map.getZoom()).catch((error) => {
      showMapToolNotice(error instanceof ChargingStationsConfigError
        ? 'Add an Open Charge Map API key to show charging stations.'
        : 'Charging stations could not be loaded.');
    });
  }, [mapLoaded, layerToggles.chargingStations]);
  useEffect(() => {
    const layer = roadWeatherLayerRef.current;
    if (!mapLoaded || !layer || !layerToggles.roadWeather) return;
    const load = (bypassCache = false) => {
      void layer.update({ bypassCache }).catch(() => {
        showMapToolNotice('Road weather could not be loaded.');
      });
    };
    load();
    const interval = window.setInterval(() => {
      if (!document.hidden) load(true);
    }, 120_000);
    const onVisible = () => { if (!document.hidden) load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mapLoaded, layerToggles.roadWeather]);
  useEffect(() => {
    const layer = roadTrafficLayerRef.current;
    if (!mapLoaded || !layer || !layerToggles.roadTraffic) return;
    const load = (bypassCache = false) => {
      void layer.update({ bypassCache }).catch(() => {
        showMapToolNotice('Traffic data could not be loaded.');
      });
    };
    load();
    const interval = window.setInterval(() => {
      if (!document.hidden) load(true);
    }, 120_000);
    const onVisible = () => { if (!document.hidden) load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mapLoaded, layerToggles.roadTraffic]);

  const {
    userLocationRef, userLocationAccuracyRef, userLocationWatchRef, locateUser,
    resetMapOrientation, zoomIn, zoomOut,
  } = useMapTools({
    mapRef,
    showNotice: showMapToolNotice,
    pauseRouteVehicle: () => {
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
    },
    resumeRouteVehicle: (map, coordinates) => {
      vehicleFollowEnabledRef.current = true;
      setVehicleFollowing(true);
      map.setCenter(followCameraCenter(map, coordinates));
      if (map.getZoom() < 14.6) map.setZoom(14.6);
    },
  });
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

  useEffect(() => () => {
    if (mapToolNoticeTimerRef.current !== undefined) window.clearTimeout(mapToolNoticeTimerRef.current);
  }, []);

  const fetchPositionAddress = async (coordinates: [number, number], signal: AbortSignal) => {
    const lookupKey = `reverse:${coordinates[0].toFixed(6)},${coordinates[1].toFixed(6)}`;
    const cached = nominatimCacheRef.current.get(lookupKey);
    if (cached) return cached.address;

    await nominatimRequestGateRef.current.wait(signal);
    const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1' });
    const response = await fetchWithTimeout(
      `${serviceConfig.nominatimEndpoint}/reverse?lat=${coordinates[1]}&lon=${coordinates[0]}&zoom=18&${params}`,
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

  const navigationView = flight.active ? 'flight'
    : measurement ? 'measurement'
    : transitDepartureDetailOpen ? 'transit-trip'
    : selectedTransitStop ? 'departures'
      : selectedTrafficCamera ? 'traffic-camera'
        : selectedChargingStation ? 'charging-station'
        : selectedRoadWeather ? 'road-weather'
        : selectedRoadTrafficMessage ? 'road-traffic-message'
        : selectedRoadTraffic ? 'road-traffic'
        : transitDetailsOpen ? 'route-steps'
          : routeSearchTarget ? 'route-search'
            : routeResult && routeOpen ? 'route-result'
              : routeOpen ? 'route'
                : selectedLocation ? 'place'
                  : viewedWeather.overlayOpen ? 'weather-overlay'
                    : viewedWeather.panelOpen ? 'weather'
                      : layersOpen ? 'layers'
                        : searchOpen ? 'search' : null;

  useInAppNavigation(navigationView, (parentView) => {
    if (flight.active) { flight.stop(); return; }
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
    if (selectedTrafficCamera) {
      trafficCamerasLayerRef.current?.clearSelection();
      closeTrafficCamera();
      return;
    }
    if (selectedChargingStation) {
      chargingStationsLayerRef.current?.clearSelection();
      closeChargingStation();
      return;
    }
    if (selectedRoadWeather) {
      roadWeatherLayerRef.current?.clearSelection();
      closeRoadWeather();
      return;
    }
    if (selectedRoadTrafficMessage) {
      roadTrafficLayerRef.current?.clearSelection();
      closeRoadTrafficMessage();
      return;
    }
    if (selectedRoadTraffic) {
      roadTrafficLayerRef.current?.clearSelection();
      closeRoadTraffic();
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
      closeLocationInformation();
      if (parentView === 'search') setSearchOpen(true);
      (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection', features: [],
      });
      return;
    }
    if (viewedWeather.overlayOpen) { viewedWeather.closeOverlay(); return; }
    if (viewedWeather.panelOpen) { viewedWeather.closePanel(); return; }
    if (layersOpen) { setLayersOpen(false); return; }
    if (searchOpen) { setSearchOpen(false); }
  });

  const setRouteGeometry = (result: RouteResult | null) => {
    const source = mapRef.current?.getSource('selected-route') as { setData: (data: unknown) => void } | undefined;
    const transitionSource = mapRef.current?.getSource('route-transitions') as { setData: (data: unknown) => void } | undefined;
    if (!result) {
      source?.setData({ type: 'FeatureCollection', features: [] });
      transitionSource?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const legFeatures = result.transitLegs?.flatMap((leg) => {
      const geometry = leg.geometry;
      if (!geometry || geometry.coordinates.length <= 1) return [];
      return [{
        type: 'Feature',
        geometry,
        properties: {
          mode: leg.mode,
          // Keep this on each feature so mixed-mode journeys can use the
          // operator's line color without affecting walking or other legs.
          routeColor: !isWalkingTransitMode(leg.mode) ? mapRouteColor(leg.routeColor) : undefined,
        },
      }];
    }) ?? [];
    const directMode = routeMode === 'pedestrian' ? 'WALK'
      : routeMode === 'bicycle' ? 'BICYCLE'
        : routeMode === 'auto' ? 'CAR' : undefined;
    source?.setData(legFeatures.length
      ? { type: 'FeatureCollection', features: legFeatures }
      : { type: 'Feature', geometry: result.geometry, properties: { mode: directMode } });
    const transitions = legFeatures.slice(1).flatMap((leg) => {
      const coordinates = leg.geometry.coordinates[0];
      return coordinates ? [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: { mode: leg.properties.mode },
      }] : [];
    });
    transitionSource?.setData({ type: 'FeatureCollection', features: transitions });
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

  const { requestRoute, selectTransitRoute } = useRouteExecution({
    route: routePlanning,
    showTransitLegVehicle,
    setRouteGeometry,
    scheduleRouteFit,
  });

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
      viewedWeather.closePanel();
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
    (document.activeElement as HTMLElement | null)?.blur();
    setRouteError(null);
    const updateLocationMarker = (coordinates: [number, number]) => {
      userLocationRef.current = coordinates;
      (mapRef.current?.getSource('user-location') as { setData: (data: unknown) => void } | undefined)?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { kind: 'gps' } }],
      });
    };
    if (userLocationRef.current) {
      updateLocationMarker(userLocationRef.current);
      setRouteEndpoint(kind, { name: 'Your location', category: 'Current location', coordinates: userLocationRef.current, source: 'map' });
      return;
    }
    if (!navigator.geolocation) {
      setRouteError('Your location is not available in this browser. Choose another point.');
      return;
    }
    // Commit the selection immediately so the listbox closes and the input shows
    // "Your location". Coordinates will be resolved asynchronously; calculateRoute
    // already handles the case where routeOriginRef is null for a Your-location
    // selection and fetches geolocation at that point.
    setRouteEndpoint(kind, { name: 'Your location', category: 'Current location', coordinates: [0, 0], source: 'map' });
    if (kind === 'origin') routeOriginRef.current = null;
    else routeDestinationRef.current = null;
    setRouteLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setRouteLoading(false);
        const coordinates: [number, number] = [coords.longitude, coords.latitude];
        updateLocationMarker(coordinates);
        if (kind === 'origin') routeOriginRef.current = coordinates;
        else routeDestinationRef.current = coordinates;
        setRoutePoints();
        if (userLocationWatchRef.current === null) {
          userLocationWatchRef.current = navigator.geolocation.watchPosition(
            ({ coords: update }) => {
              updateLocationMarker([update.longitude, update.latitude]);
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
      if (routeContextMenu) { setRouteContextMenu(null); setContextMenuMarker(null); }
      else if (routeSearchTarget) closeAutocomplete();
      else if (viewedWeather.overlayOpen) viewedWeather.closeOverlay();
      else if (viewedWeather.panelOpen) viewedWeather.closePanel();
      else if (searchOpen) setSearchOpen(false);
      else if (layersOpen) setLayersOpen(false);
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
  }, [layersOpen, routeContextMenu, routeSearchTarget, searchOpen, viewedWeather.overlayOpen, viewedWeather.panelOpen, viewedWeather.closeOverlay, viewedWeather.closePanel]);

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

  const {
    prepareInfoPanelOpen,
    preserveRouteVehicleForInfoPanel,
    selectTransitStopForInfoPanel,
    clearTransitInfoSelection,
    openPositionInformation,
  } = usePanelCoordinator({
    routeVehicleViewRef,
    routeResultRef,
    vehicleFollowEnabledRef,
    vehicleFollowingRef,
    setVehicleFollowing,
    setVehicleFollowAvailable,
    transitStopsLayerRef,
    setContextMenuMarker,
    closePositionInformation,
    setPositionInformation,
    clearLocationSelection,
    setSelectedTransitStop,
    trafficCamerasLayerRef,
    setSelectedTrafficCamera,
    chargingStationsLayerRef,
    setSelectedChargingStation,
    roadWeatherLayerRef,
    setSelectedRoadWeather,
    roadTrafficLayerRef,
    setSelectedRoadTraffic,
    setSelectedRoadTrafficMessage,
    closeWeatherPanel: viewedWeather.closePanel,
    cancelRoute,
    rememberRouteVehicle,
  });

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
    setSelectedTrafficCamera(null);
    trafficCamerasLayerRef.current?.clearSelection();
    setSelectedChargingStation(null);
    chargingStationsLayerRef.current?.clearSelection();
    setSelectedRoadWeather(null);
    roadWeatherLayerRef.current?.clearSelection();
    setSelectedRoadTraffic(null);
    setSelectedRoadTrafficMessage(null);
    roadTrafficLayerRef.current?.clearSelection();
    viewedWeather.closePanel();
    setRouteContextMenu(null);
    setContextMenuMarker(null);
    measurementControllerRef.current = new DistanceMeasurementController(map, start, setMeasurement);
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const deepLink = initialDeepLinkRef.current;
    const savedView = deepLink ? null : loadPersistedMapView();
    let map: Map;
    try {
      map = new maplibregl.Map({
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
          customAttribution: '<a href="https://digitransit.fi/" target="_blank" rel="noreferrer">Finnish transit data by Digitransit</a> · <a href="https://www.digitraffic.fi/en/road-traffic/" target="_blank" rel="noreferrer">Road weather, traffic and cameras by Fintraffic / Digitraffic</a> · <a href="https://openchargemap.org/" target="_blank" rel="noreferrer">Charging locations by Open Charge Map</a> · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo</a> · <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transit data by Transitous</a>',
        },
      });
    } catch (error) {
      // MapLibre 6.7.0 throws GPUInitializationError from the constructor when
      // WebGL2 is unavailable, instead of firing an error event after return.
      setMapError(error instanceof Error ? error.message : 'The map could not be created.');
      return;
    }
    // Use the explicitly documented key bindings below rather than MapLibre's
    // broader defaults, so modifier keys and editable controls remain untouched.
    map.keyboard.disable();

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
      if (!pose || !vehicleFollowEnabledRef.current || flightActiveRef.current) return;
      if (Date.now() - lastUserInteractionRef.current < 400) return;
      const vehicle = pose.parts[Math.floor(pose.parts.length / 2)];
      // Keep camera tracking independent of style loading/animation state.
      // The vehicle pose is updated on every timer tick, so setCenter avoids
      // a queue of interrupted easeTo animations and follows the tram exactly.
      map.setCenter(followCameraCenter(map, vehicle.coordinates));
      if (map.getZoom() < 14.6) map.setZoom(14.6);
    });
    transitStopsLayerRef.current = transitStopsLayer;
    const trafficCamerasLayer = new TrafficCamerasLayer();
    trafficCamerasLayerRef.current = trafficCamerasLayer;
    const roadWeatherLayer = new RoadWeatherLayer();
    roadWeatherLayerRef.current = roadWeatherLayer;
    const roadTrafficLayer = new RoadTrafficLayer();
    roadTrafficLayerRef.current = roadTrafficLayer;
    const chargingStationsLayer = new ChargingStationsLayer();
    chargingStationsLayerRef.current = chargingStationsLayer;
    const transitRouteOverlay = new TransitRouteOverlay();
    transitRouteOverlayRef.current = transitRouteOverlay;
    let treeUpdateTimer: number | undefined;
    let transitStopsTimer: number | undefined;
    let chargingStationsTimer: number | undefined;
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
    const updateChargingStations = () => {
      chargingStationsTimer = undefined;
      if (!map.isStyleLoaded() || !chargingStationsEnabledRef.current) return;
      void chargingStationsLayer.update(map.getBounds(), map.getZoom()).catch((error) => {
        if ((error as Error).name === 'AbortError' || error instanceof ChargingStationsConfigError) return;
        console.warn('Charging station request failed.', error);
      });
    };
    const scheduleChargingStationsUpdate = () => {
      if (chargingStationsTimer !== undefined) window.clearTimeout(chargingStationsTimer);
      chargingStationsTimer = window.setTimeout(updateChargingStations, 280);
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
      if (flightActiveRef.current) return;
      if (measurementControllerRef.current) return;
      setNearbyPlaces(null);
      setRouteContextMenu(null);
      if (!positionInformation && !pendingFavorite) setContextMenuMarker(null);
      const locationLayers = ['favorite-icons', 'search-result-icons', 'nearby-result-icons', 'global-hiking-pois', 'location-poi-icons', 'location-poi-labels', 'selected-location-icon'];
      const cameraFeature = trafficCameraFeatureAt(map, event.point);
      const chargingFeature = chargingStationFeatureAt(map, event.point);
      const weatherFeature = roadWeatherFeatureAt(map, event.point);
      const trafficFeature = roadTrafficFeatureAt(map, event.point);
      const feature = map.queryRenderedFeatures(event.point, { layers: locationLayers })[0];
      if (routePickingRef.current) {
        const kind = routePickingRef.current;
        const overlayFeature = cameraFeature ?? chargingFeature ?? weatherFeature ?? trafficFeature;
        if (overlayFeature) {
          const overlayKind = typeof overlayFeature.properties?.kind === 'string' ? overlayFeature.properties.kind : undefined;
          const overlayName = typeof overlayFeature.properties?.name === 'string' && overlayFeature.properties.name
            ? overlayFeature.properties.name
            : cameraFeature ? 'Traffic camera'
              : chargingFeature ? 'Charging station'
                : weatherFeature ? 'Road weather station'
                  : overlayKind === 'roadwork' ? 'Roadworks'
                    : overlayKind === 'incident' ? 'Incident'
                      : 'Traffic station';
          const overlayCategory = cameraFeature ? 'Traffic camera'
            : chargingFeature ? 'Charging station'
              : weatherFeature ? 'Road weather station'
                : overlayKind === 'roadwork' ? 'Roadworks'
                  : overlayKind === 'incident' ? 'Incident'
                    : 'Traffic station';
          const overlayCoordinates = overlayFeature.geometry.type === 'Point'
            ? [Number(overlayFeature.geometry.coordinates[0]), Number(overlayFeature.geometry.coordinates[1])] as [number, number]
            : overlayFeature.geometry.type === 'LineString'
              ? [
                (Number(overlayFeature.geometry.coordinates[0][0]) + Number(overlayFeature.geometry.coordinates[1][0])) / 2,
                (Number(overlayFeature.geometry.coordinates[0][1]) + Number(overlayFeature.geometry.coordinates[1][1])) / 2,
              ] as [number, number]
              : [map.unproject(event.point).lng, map.unproject(event.point).lat] as [number, number];
          setRouteEndpoint(kind, {
            name: overlayName,
            category: overlayCategory,
            coordinates: overlayCoordinates,
            source: 'map',
          });
          return;
        }
        const destination = feature && feature.layer.id !== 'selected-location-icon'
          ? locationSelectionFromFeature(feature).coordinates
          : [map.unproject(event.point).lng, map.unproject(event.point).lat] as [number, number];
        const selection: LocationSelection = feature && feature.layer.id !== 'selected-location-icon'
          ? locationSelectionFromFeature(feature)
          : { name: 'Map point', category: 'Pinned location', coordinates: destination, source: 'map' };
        setRouteEndpoint(kind, selection);
        return;
      }
      if (cameraFeature) return;
      if (chargingFeature) return;
      if (weatherFeature) return;
      if (trafficFeature) return;
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
    const handleMapKeyDown = (event: KeyboardEvent) => {
      if (flightActiveRef.current) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.target !== map.getCanvas()) return;
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100],
      };
      if (pan[event.key]) {
        event.preventDefault();
        map.panBy(pan[event.key], { duration: 180 });
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault(); map.zoomIn({ duration: 180 });
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault(); map.zoomOut({ duration: 180 });
      } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const canvas = map.getCanvas();
        const point = new maplibregl.Point(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const center = map.getCenter();
        showRouteContextMenu(point, [center.lng, center.lat]);
      }
    };
    const handleMapContextMenu = (event: MapMouseEvent) => {
      event.originalEvent.preventDefault();
      if (flightActiveRef.current) return;
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
      if (flightActiveRef.current) return;
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
      if (flightActiveRef.current) return;
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
      if (flightActiveRef.current) return;
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
      map.addSource('nearby-results', {
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
      map.addSource('route-transitions', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'selected-route-casing',
        type: 'line',
        source: 'selected-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 12, 8, 18, 11],
          'line-opacity': 0.92,
        },
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 4.5, 18, 6],
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
        id: 'route-transition-halo',
        type: 'circle',
        source: 'route-transitions',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 18, 10],
          'circle-color': '#ffffff',
          'circle-opacity': 0.96,
          'circle-stroke-color': '#64748b',
          'circle-stroke-width': 1.5,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'route-transitions',
        type: 'symbol',
        source: 'route-transitions',
        layout: {
          'text-field': [
            'match', ['upcase', ['to-string', ['get', 'mode']]],
            'WALK', 'W', 'FOOT', 'W', 'PEDESTRIAN', 'W',
            'BICYCLE', 'B', 'BIKE', 'B', 'CYCLING', 'B',
            'TRAM', 'T', 'BUS', 'B', 'SUBWAY', 'M', 'RAIL', 'R', '•',
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 8, 18, 11],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#334155' },
      }, poiLayers.before);
      map.addLayer({
        id: 'route-endpoint-halo',
        type: 'circle',
        source: 'route-endpoints',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 10, 14, 12, 18, 14],
          'circle-color': '#ffffff',
          'circle-opacity': 0.98,
          'circle-stroke-color': ['match', ['get', 'kind'], 'origin', '#178052', '#c94747'],
          'circle-stroke-width': 2,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'route-endpoints',
        type: 'circle',
        source: 'route-endpoints',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 14, 7, 18, 8],
          'circle-color': ['match', ['get', 'kind'], 'origin', '#1c9b61', '#e15858'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'route-endpoint-labels',
        type: 'symbol',
        source: 'route-endpoints',
        layout: {
          'text-field': ['match', ['get', 'kind'], 'origin', 'A', 'B'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 18, 11],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
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
        id: 'nearby-result-halo', type: 'circle', source: 'nearby-results',
        paint: { 'circle-radius': 13, 'circle-color': '#fff', 'circle-opacity': 0.96, 'circle-stroke-color': '#7c3aed', 'circle-stroke-width': 3 },
      }, poiLayers.before);
      map.addLayer({
        id: 'nearby-result-icons', type: 'symbol', source: 'nearby-results',
        layout: {
          'icon-image': searchResultIconExpression(), 'icon-size': 1.25,
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11,
          'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true,
        },
        paint: { 'text-color': MAP_COLORS.label, 'text-halo-color': MAP_COLORS.labelHalo, 'text-halo-width': 1.3 },
      }, poiLayers.before);
      map.addLayer({
        id: 'selected-location-halo', type: 'circle', source: 'selected-location',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 18, 17],
          'circle-color': '#ffffff', 'circle-opacity': 0.98,
          'circle-stroke-color': MAP_COLORS.transitBlue, 'circle-stroke-width': 2.5,
        },
      }, poiLayers.before);
      map.addLayer({
        id: 'selected-location-icon', type: 'circle', source: 'selected-location',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 18, 10],
          'circle-color': MAP_COLORS.transitBlue, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
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
      canvas.setAttribute('aria-label', 'Interactive map. Use arrow keys to pan, plus or minus to zoom, and Shift+F10 for location actions.');
      canvas.addEventListener('keydown', handleMapKeyDown);
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
          rememberRouteVehicle(routeResultRef.current, vehicleFollowingRef.current);
        }
        setSelectedTransitStop(stop);
      map.easeTo({
        center: stop.coordinates,
        zoom: Math.max(map.getZoom(), 14.6),
        offset: closeRangeCameraOffset(),
        duration: 900,
        });
      }, () => measurementControllerRef.current !== null || Boolean(routePickingRef.current), preserveRouteVehicleForInfoPanel).then(() => {
        if (transitStopsLayerRef.current !== transitStopsLayer || !map.isStyleLoaded()) return;
        map.moveLayer(transitVehicleLayer.id, 'transit-estimated-vehicle-label');
        updateTransitStops();
      });
      void trafficCamerasLayer.install(map, (camera) => {
        prepareInfoPanelOpen();
        clearLocationSelection();
        if (preserveRouteVehicleForInfoPanel() && routeResultRef.current) {
          rememberRouteVehicle(routeResultRef.current, vehicleFollowingRef.current);
          transitStopsLayer.clearStopSelection();
        } else {
          transitStopsLayer.clearSelection();
        }
        setSelectedTransitStop(null);
        trafficCamerasLayer.selectCamera(camera);
        setSelectedTrafficCamera(camera);
        pendingSearchCameraRef.current = camera.coordinates;
        map.easeTo({
          center: camera.coordinates,
          zoom: Math.max(map.getZoom(), 12),
          offset: closeRangeCameraOffset(),
          duration: 900,
        });
      }, () => measurementControllerRef.current !== null || Boolean(routePickingRef.current)).then(() => {
        if (trafficCamerasLayerRef.current !== trafficCamerasLayer || !trafficCamerasEnabledRef.current) return;
        void trafficCamerasLayer.update().catch(() => {
          showMapToolNotice('Traffic cameras could not be loaded.');
        });
      });
      void chargingStationsLayer.install(map, (station) => {
        prepareInfoPanelOpen();
        clearLocationSelection();
        if (preserveRouteVehicleForInfoPanel() && routeResultRef.current) {
          rememberRouteVehicle(routeResultRef.current, vehicleFollowingRef.current);
          transitStopsLayer.clearStopSelection();
        } else {
          transitStopsLayer.clearSelection();
        }
        setSelectedTransitStop(null);
        chargingStationsLayer.selectStation(station);
        setSelectedChargingStation(station);
        pendingSearchCameraRef.current = station.coordinates;
        map.easeTo({
          center: station.coordinates,
          zoom: Math.max(map.getZoom(), 14),
          offset: closeRangeCameraOffset(),
          duration: 900,
        });
      }, () => measurementControllerRef.current !== null || Boolean(routePickingRef.current)).then(() => {
        if (chargingStationsLayerRef.current !== chargingStationsLayer || !chargingStationsEnabledRef.current) return;
        updateChargingStations();
      });
      void roadWeatherLayer.install(map, (station) => {
        prepareInfoPanelOpen();
        clearLocationSelection();
        if (preserveRouteVehicleForInfoPanel() && routeResultRef.current) {
          rememberRouteVehicle(routeResultRef.current, vehicleFollowingRef.current);
          transitStopsLayer.clearStopSelection();
        } else {
          transitStopsLayer.clearSelection();
        }
        setSelectedTransitStop(null);
        roadWeatherLayer.selectStation(station);
        setSelectedRoadWeather(station);
        pendingSearchCameraRef.current = station.coordinates;
        map.easeTo({
          center: station.coordinates,
          zoom: Math.max(map.getZoom(), 12),
          offset: closeRangeCameraOffset(),
          duration: 900,
        });
      }, () => measurementControllerRef.current !== null || Boolean(routePickingRef.current)).then(() => {
        if (roadWeatherLayerRef.current !== roadWeatherLayer || !roadWeatherEnabledRef.current) return;
        void roadWeatherLayer.update().catch(() => {
          showMapToolNotice('Road weather could not be loaded.');
        });
      });
      void roadTrafficLayer.install(map, (target) => {
        prepareInfoPanelOpen();
        clearLocationSelection();
        if (preserveRouteVehicleForInfoPanel() && routeResultRef.current) {
          rememberRouteVehicle(routeResultRef.current, vehicleFollowingRef.current);
          transitStopsLayer.clearStopSelection();
        } else {
          transitStopsLayer.clearSelection();
        }
        setSelectedTransitStop(null);
        if (target.type === 'message') {
          roadTrafficLayer.selectMessage(target.message);
          setSelectedRoadTrafficMessage(target.message);
          pendingSearchCameraRef.current = target.message.coordinates;
          map.easeTo({
            center: target.message.coordinates,
            zoom: Math.max(map.getZoom(), 12),
            offset: closeRangeCameraOffset(),
            duration: 900,
          });
          return;
        }
        roadTrafficLayer.selectStation(target.station);
        setSelectedRoadTraffic(target.station);
        pendingSearchCameraRef.current = target.station.coordinates;
        map.easeTo({
          center: target.station.coordinates,
          zoom: Math.max(map.getZoom(), 11),
          offset: closeRangeCameraOffset(),
          duration: 900,
        });
      }, () => measurementControllerRef.current !== null || Boolean(routePickingRef.current)).then(() => {
        if (roadTrafficLayerRef.current !== roadTrafficLayer || !roadTrafficEnabledRef.current) return;
        void roadTrafficLayer.update().catch(() => {
          showMapToolNotice('Traffic data could not be loaded.');
        });
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
      if (flightActiveRef.current) return;
      persistCamera();
      updateGlobalRoadWidths();
      scheduleTreeUpdate();
      // Vehicle follow recenters the map several times per second. Those
      // camera-only moves must not trigger a fresh stop query on every moveend.
      if (!vehicleFollowEnabledRef.current) scheduleTransitStopsUpdate();
      updateTransitRouteOverlay();
      if (chargingStationsEnabledRef.current) scheduleChargingStationsUpdate();
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
      if (flightActiveRef.current) return;
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
    // idle handles the final set of newly loaded tiles. Flight trees have a
    // dedicated refresh interval, so avoid updating the hidden regular layer.
    const handleIdleTreeUpdate = () => {
      if (flightActiveRef.current) return;
      scheduleTreeUpdate();
    };
    map.on('idle', handleIdleTreeUpdate);
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
      if (chargingStationsTimer !== undefined) window.clearTimeout(chargingStationsTimer);
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
      canvas.removeEventListener('keydown', handleMapKeyDown);
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
      map.off('idle', handleIdleTreeUpdate);
      transitStopsLayer.dispose();
      transitRouteOverlay.dispose();
      trafficCamerasLayer.dispose();
      chargingStationsLayer.dispose();
      roadWeatherLayer.dispose();
      roadTrafficLayer.dispose();
      map.remove();
      mapRef.current = null;
      treeRefreshRef.current = null;
      treeLayerRef.current = null;
      flightTreeLayerRef.current = null;
      transitStopsLayerRef.current = null;
      trafficCamerasLayerRef.current = null;
      chargingStationsLayerRef.current = null;
      roadWeatherLayerRef.current = null;
      roadTrafficLayerRef.current = null;
      transitVehicleLayerRef.current = null;
    };
  }, []);



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
    const source = mapRef.current?.getSource('nearby-results') as { setData: (data: unknown) => void } | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: (nearbyPlaces ?? []).map((place) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: place.coordinates },
        properties: { ...place.properties, name: place.name || place.type.replaceAll('_', ' '), iconId: place.type },
      })),
    });
  }, [nearbyPlaces, mapLoaded]);

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
    try {
      await nominatimRequestGateRef.current.wait(controller.signal);
      const params = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
      });
      const endpoint = selection.osmType && selection.osmId
        ? `${serviceConfig.nominatimEndpoint}/lookup?osm_ids=${encodeURIComponent(`${selection.osmType}${selection.osmId}`)}&${params}`
        : `${serviceConfig.nominatimEndpoint}/reverse?lat=${selection.coordinates[1]}&lon=${selection.coordinates[0]}&zoom=18&${params}`;
      const response = await fetchWithTimeout(endpoint, { signal: controller.signal });
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
          zoom: Math.max(map.getZoom(), selectedTransitStop ? 14.6 : selectedTrafficCamera || selectedRoadWeather || selectedRoadTrafficMessage ? 12 : selectedRoadTraffic ? 11 : 14),
          offset: selectionCameraOffset(map),
          duration: 900,
        });
      });
    });
    return () => {
      cancelled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [positionInformation?.coordinates, selectedLocation, selectedTransitStop, selectedTrafficCamera, selectedChargingStation, selectedRoadWeather, selectedRoadTraffic, selectedRoadTrafficMessage]);
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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    let frame: number | undefined;
    let recenterTimer: number | undefined;
    let previousRouteLayout: string | undefined;
    const updatePadding = () => {
      frame = undefined;
      if (flightActiveRef.current) return;
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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    let frame: number | undefined;
    let recenterTimer: number | undefined;
    let previousRouteLayout: string | undefined;
    const updatePadding = () => {
      frame = undefined;
      if (flightActiveRef.current) return;
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

  const openNearby = (anchor: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;
    const layers = ['global-hiking-pois', 'location-poi-icons', 'location-poi-labels']
      .filter((layer) => Boolean(map.getLayer(layer)));
    const candidates = map.queryRenderedFeatures(undefined, { layers }).flatMap((feature) => {
      if (feature.geometry.type !== 'Point') return [];
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const coordinates = feature.geometry.coordinates as [number, number];
      const type = String(properties.class ?? properties.osm_value ?? properties.subclass ?? '');
      const osmId = properties.osm_id ?? feature.id;
      return [{
        id: osmId === undefined
          ? `${feature.sourceLayer ?? type}:${coordinates.map((value) => value.toFixed(5)).join(',')}:${String(properties.name ?? '')}`
          : `${properties.osm_type ?? feature.sourceLayer ?? ''}:${String(osmId)}`,
        name: typeof properties.name === 'string' ? properties.name : undefined,
        type,
        coordinates,
        properties,
      }];
    });
    const places = rankNearbyPlaces(anchor, candidates);
    setNearbyPlaces(places);
    setRouteContextMenu(null);
    setContextMenuMarker(anchor);
    setSearchOpen(false);
    setHighlightedSearchResults([]);
    clearLocationSelection();
    setSelectedTransitStop(null);
    trafficCamerasLayerRef.current?.clearSelection();
    setSelectedTrafficCamera(null);
    chargingStationsLayerRef.current?.clearSelection();
    setSelectedChargingStation(null);
    roadWeatherLayerRef.current?.clearSelection();
    setSelectedRoadWeather(null);
    roadTrafficLayerRef.current?.clearSelection();
    setSelectedRoadTraffic(null);
    setSelectedRoadTrafficMessage(null);
    viewedWeather.closePanel();
    window.requestAnimationFrame(() => {
      if (!places.length) return;
      const bounds = new maplibregl.LngLatBounds(anchor, anchor);
      places.forEach((place) => bounds.extend(place.coordinates));
      map.fitBounds(bounds, { padding: panelViewportPadding(map, 36, 16), maxZoom: 16.5, duration: 650 });
    });
  };

  const selectNearbyPlace = (place: NearbyPlace) => {
    const selection: LocationSelection = {
      name: place.name || place.type.replaceAll('_', ' '),
      category: locationCategory(place.properties), coordinates: place.coordinates, source: 'map',
      iconId: place.type,
      osmId: typeof place.properties.osm_id === 'string' || typeof place.properties.osm_id === 'number' ? place.properties.osm_id : undefined,
      osmType: typeof place.properties.osm_type === 'string' ? place.properties.osm_type : undefined,
      ...locationDetails(place.properties),
    };
    setNearbyPlaces(null);
    setContextMenuMarker(null);
    prepareInfoPanelOpen();
    clearTransitInfoSelection();
    setSelectedTransitStop(null);
    setSelectedLocation(selection);
    (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
      type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: selection.coordinates }, properties: {} }],
    });
    void enrichLocationDetails(selection);
  };

  return (
    <div className={`map-view${flight.active ? ' flight-mode' : ''}`}>
      <div ref={containerRef} className="map-canvas" aria-label="Interactive map. Use arrow keys to pan and plus or minus to zoom." />
      {!mapLoaded && !mapError && (
        <div className="map-status map-splash" role="status">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <strong>Katu Maps</strong>
          <span>Loading map…</span>
        </div>
      )}
      {mapError && (
        <div className="map-status map-status-error">
          <strong>Map unavailable</strong>
          <span>{mapError}</span>
          <small>Check that the browser can access the configured map style.</small>
        </div>
      )}
      {mapLoaded && !mapError && flight.active && (
        <FlightControls
          telemetry={flight.telemetry}
          onControlChange={flight.setControl}
          onExit={flight.stop}
        />
      )}
      {mapLoaded && !mapError && (
        <>
          {!flight.active && <MapControls
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
              closeNearby();
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
              closeNearby();
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
            contentPanelOpen={routeOpen || Boolean(selectedLocation) || Boolean(selectedTransitStop) || Boolean(selectedTrafficCamera) || Boolean(selectedChargingStation) || Boolean(selectedRoadWeather) || Boolean(selectedRoadTraffic) || Boolean(selectedRoadTrafficMessage) || Boolean(positionInformation) || Boolean(nearbyPlaces) || viewedWeather.panelOpen}
            orientationChanged={orientationChanged}
            notice={mapToolNotice}
            themePreference={themePreference}
            onThemeChange={setThemePreference}
          />}
          {!flight.active && layerToggles.weather && !routeOpen && !layersOpen && (
            <WeatherChip
              weather={viewedWeather.weather}
              loading={viewedWeather.loading}
              unavailable={viewedWeather.unavailable}
              expanded={viewedWeather.panelOpen}
              onOpen={() => {
                if (viewedWeather.panelOpen) {
                  viewedWeather.closePanel();
                  return;
                }
                prepareInfoPanelOpen();
                clearTransitInfoSelection();
                setSelectedTransitStop(null);
                clearLocationSelection();
                closeNearby();
                setLayersOpen(false);
                setSearchOpen(false);
                viewedWeather.openPanel();
              }}
            />
          )}
          {viewedWeather.panelOpen && (
            <WeatherPanel
              weather={viewedWeather.weather}
              loading={viewedWeather.loading}
              unavailable={viewedWeather.unavailable}
              sheet={weatherSheet}
              onClose={viewedWeather.closePanel}
              onOpenOverlay={viewedWeather.openOverlay}
            />
          )}
          {viewedWeather.overlayOpen && (
            <WeatherTimeSlider
              variable={viewedWeather.overlayVariable}
              times={weatherSliderTimes(
                viewedWeather.overlayGrid,
                viewedWeather.weather?.hourly.map((hour) => hour.time) ?? [],
              )}
              selectedTime={viewedWeather.overlayTime}
              loading={viewedWeather.overlayLoading}
              unavailable={viewedWeather.overlayUnavailable}
              onVariableChange={viewedWeather.setOverlayVariable}
              onTimeChange={viewedWeather.setOverlayTime}
              onClose={viewedWeather.closeOverlay}
            />
          )}
          {routeContextMenu && (
            <MapContextMenu
              position={{ x: routeContextMenu.x, y: routeContextMenu.y }}
              onPositionInformation={() => {
                const coordinates: [number, number] = [...routeContextMenu.coordinates];
                openPositionInformation(positionInformationState(coordinates));
                setRouteContextMenu(null);
              }}
              onNearby={() => openNearby([...routeContextMenu.coordinates])}
              onMeasureDistance={() => startMeasurement([...routeContextMenu.coordinates])}
              onSaveFavourite={() => {
                saveSelection({ name: 'Map point', category: 'Pinned location', coordinates: routeContextMenu.coordinates, source: 'map' });
                setRouteContextMenu(null);
              }}
              onFlyFromHere={() => {
                const coordinates: [number, number] = [...routeContextMenu.coordinates];
                setLayersOpen(false);
                setSearchOpen(false);
                setFavoritesOpen(false);
                setRouteSearchTarget(null);
                setRouteContextMenu(null);
                setContextMenuMarker(null);
                setPositionInformation(null);
                setNearbyPlaces(null);
                viewedWeather.closeWeatherUi();
                pendingSearchCameraRef.current = null;
                routeCameraRequestRef.current += 1;
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                if (measurementControllerRef.current) stopMeasurement();
                flight.start(coordinates);
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
          {nearbyPlaces && (
            <NearbyPlacesPanel places={nearbyPlaces} onClose={closeNearby} onSelect={selectNearbyPlace} />
          )}
          {positionInformation && (
            <PositionInformationPanel
              information={positionInformation}
              sheet={positionSheet}
              favorite={positionFavorite}
              is3dMode={is3dMode}
              onClose={() => { setPositionInformation(null); setContextMenuMarker(null); }}
              onEditFavorite={() => editFavorite(positionFavorite!)}
              onSaveFavorite={() => saveSelection({
                name: 'Map point', category: 'Pinned location', coordinates: positionInformation.coordinates,
                source: 'map', address: positionInformation.address.status === 'available' ? positionInformation.address.address : undefined,
              })}
              onRemoveFavorite={() => setFavorites((items) => items.filter((item) => item.id !== positionFavorite?.id))}
              onShare={() => shareSelection({
                type: 'position', coordinates: positionInformation.coordinates, zoom: Math.max(mapRef.current?.getZoom() ?? 16, 15),
              }, 'Map position')}
              onDirections={(selection) => {
                openRoute();
                setRouteEndpoint('destination', selection);
                setPositionInformation(null);
                setContextMenuMarker(null);
              }}
            />
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
          {selectedRoadWeather && (
            <RoadWeatherPanel
              key={selectedRoadWeather.id}
              station={selectedRoadWeather}
              sheet={roadWeatherSheet}
              onClose={() => {
                roadWeatherLayerRef.current?.clearSelection();
                closeRoadWeather();
              }}
              onShare={() => shareSelection({
                type: 'position',
                coordinates: selectedRoadWeather.coordinates,
                zoom: Math.max(mapRef.current?.getZoom() ?? 14, 12),
                name: selectedRoadWeather.name,
              }, selectedRoadWeather.name)}
              onDirections={(destination) => {
                openRoute();
                setRouteEndpoint('destination', destination);
              }}
            />
          )}
          {selectedRoadTrafficMessage && !selectedRoadWeather && (
            <RoadTrafficMessagePanel
              key={selectedRoadTrafficMessage.id}
              message={selectedRoadTrafficMessage}
              sheet={roadTrafficMessageSheet}
              onClose={() => {
                roadTrafficLayerRef.current?.clearSelection();
                closeRoadTrafficMessage();
              }}
              onShare={() => shareSelection({
                type: 'position',
                coordinates: selectedRoadTrafficMessage.coordinates,
                zoom: Math.max(mapRef.current?.getZoom() ?? 14, 12),
                name: selectedRoadTrafficMessage.name,
              }, selectedRoadTrafficMessage.name)}
              onDirections={(destination) => {
                openRoute();
                setRouteEndpoint('destination', destination);
              }}
            />
          )}
          {selectedRoadTraffic && !selectedRoadWeather && !selectedRoadTrafficMessage && (
            <RoadTrafficPanel
              key={selectedRoadTraffic.id}
              station={selectedRoadTraffic}
              sheet={roadTrafficSheet}
              onClose={() => {
                roadTrafficLayerRef.current?.clearSelection();
                closeRoadTraffic();
              }}
              onShare={() => shareSelection({
                type: 'position',
                coordinates: selectedRoadTraffic.coordinates,
                zoom: Math.max(mapRef.current?.getZoom() ?? 14, 11),
                name: selectedRoadTraffic.name,
              }, selectedRoadTraffic.name)}
              onDirections={(destination) => {
                openRoute();
                setRouteEndpoint('destination', destination);
              }}
            />
          )}
          {selectedChargingStation && !selectedRoadWeather && !selectedRoadTraffic && !selectedRoadTrafficMessage && (
            <ChargingStationPanel
              key={selectedChargingStation.id}
              station={selectedChargingStation}
              sheet={chargingStationSheet}
              onClose={() => {
                chargingStationsLayerRef.current?.clearSelection();
                closeChargingStation();
              }}
              onShare={() => shareSelection({
                type: 'position',
                coordinates: selectedChargingStation.coordinates,
                zoom: Math.max(mapRef.current?.getZoom() ?? 14, 14),
                name: selectedChargingStation.name,
              }, selectedChargingStation.name)}
              onDirections={(destination) => {
                openRoute();
                setRouteEndpoint('destination', destination);
              }}
            />
          )}
          {selectedTrafficCamera && !selectedChargingStation && !selectedRoadWeather && !selectedRoadTraffic && !selectedRoadTrafficMessage && (
            <TrafficCameraPanel
              key={selectedTrafficCamera.id}
              selection={selectedTrafficCamera}
              sheet={trafficCameraSheet}
              onClose={() => {
                trafficCamerasLayerRef.current?.clearSelection();
                closeTrafficCamera();
              }}
              onShare={() => shareSelection({
                type: 'position',
                coordinates: selectedTrafficCamera.coordinates,
                zoom: Math.max(mapRef.current?.getZoom() ?? 14, 12),
                name: selectedTrafficCamera.name,
              }, selectedTrafficCamera.name)}
              onDirections={(destination) => {
                openRoute();
                setRouteEndpoint('destination', destination);
              }}
            />
          )}
          {selectedTransitStop && !selectedTrafficCamera && !selectedChargingStation && !selectedRoadWeather && !selectedRoadTraffic && !selectedRoadTrafficMessage && (
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
                const routeVehicleRestore = takeRouteVehicleRestore();
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                setVehicleFollowAvailable(false);
                transitStopsLayerRef.current?.clearSelection();
                setSelectedTransitStop(null);
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
            <MapCameraActions
              routeMode={routeMode}
              infoPanelOpen={Boolean(selectedLocation || selectedTransitStop || selectedTrafficCamera || selectedChargingStation || selectedRoadWeather || selectedRoadTraffic || selectedRoadTrafficMessage || positionInformation)}
              vehicleFollowAvailable={vehicleFollowAvailable}
              vehicleFollowing={vehicleFollowing}
              vehiclePositionStatus={vehiclePositionStatus}
              onPauseVehicleFollow={pauseVehicleFollow}
              onResumeVehicleFollow={resumeVehicleFollow}
              onFitRoute={() => fitRouteNow(routeResult)}
            />
          )}
          {selectedLocation && !selectedTransitStop && !selectedTrafficCamera && !selectedChargingStation && !selectedRoadWeather && !selectedRoadTraffic && !selectedRoadTrafficMessage && (
            <LocationInformationPanel
              selection={selectedLocation}
              sheet={locationSheet}
              detailsLoading={locationDetailsLoading}
              icon={SelectedLocationIcon}
              iconColor={LOCATION_ICON_COLORS[selectedIconKey] ?? '#64748b'}
              favorite={favorites.find((item) => item.id === selectedLocation.favoriteId
                || item.id === selectedLocation.osmId
                || item.coordinates.join(',') === selectedLocation.coordinates.join(','))}
              onClose={() => {
                locationDetailsAbortRef.current?.abort();
                setLocationDetailsLoading(false);
                closeLocationInformation();
                (mapRef.current?.getSource('selected-location') as { setData: (data: unknown) => void } | undefined)?.setData({
                  type: 'FeatureCollection', features: [],
                });
              }}
              onSaveFavorite={() => saveSelection(selectedLocation, selectedLocation.osmId ? 'osm' : undefined, selectedLocation.osmId ? `${selectedLocation.osmType ?? ''}${selectedLocation.osmId}` : undefined)}
              onEditFavorite={() => {
                const favorite = favorites.find((item) => item.id === selectedLocation.favoriteId
                  || item.id === selectedLocation.osmId
                  || item.coordinates.join(',') === selectedLocation.coordinates.join(','));
                if (favorite) editFavorite(favorite);
              }}
              onRemoveFavorite={() => {
                const favorite = favorites.find((item) => item.id === selectedLocation.favoriteId
                  || item.id === selectedLocation.osmId
                  || item.coordinates.join(',') === selectedLocation.coordinates.join(','));
                if (favorite) setFavorites((items) => items.filter((item) => item.id !== favorite.id));
              }}
              onShare={() => shareSelection({
                type: selectedLocation.osmId ? 'poi' : 'position', coordinates: selectedLocation.coordinates,
                zoom: Math.max(mapRef.current?.getZoom() ?? 16, 15),
                id: selectedLocation.osmId ? `${selectedLocation.osmType ?? ''}${selectedLocation.osmId}` : undefined,
                provider: selectedLocation.osmId ? 'osm' : undefined, name: selectedLocation.name,
              }, selectedLocation.name)}
              onDirections={() => {
                openRoute();
                setRouteEndpoint('destination', selectedLocation);
              }}
            />
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
              <RoutePlannerControls
                route={{
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
                }}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                searchLoading={searchLoading}
                searchError={searchError}
                displayedSearchResults={displayedSearchResults}
                favoriteFeatures={favoriteFeatures}
                userLocationRef={userLocationRef}
                routeSearchAnchorRefs={routeSearchAnchorRefs}
                routeSearchResultsRef={routeSearchResultsRef}
                setSearchOpen={setSearchOpen}
                setSearchResults={setSearchResults}
                setSearchError={setSearchError}
                beginRouteSearch={beginRouteSearch}
                pickRouteEndpoint={pickRouteEndpoint}
                selectYourLocation={selectYourLocation}
                selectSearchResult={selectSearchResult}
                selectTransitRoute={selectTransitRoute}
                swapRouteEndpoints={swapRouteEndpoints}
                photonResultLabel={photonResultLabel}
              />
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
