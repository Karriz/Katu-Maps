import { deploymentStorageKey } from '../lib/Deployment';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import {
  type ExpressionSpecification,
  type FillLayerSpecification,
  type FilterSpecification,
  type Map,
  type Point,
} from 'maplibre-gl';
import {
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
import { TreeModelLayer } from './TreeModelLayer';
import { BridgeModelLayer } from './BridgeModelLayer';
import { installTunnelPortals } from './TunnelPortals';
import { RoofModelLayer } from './RoofModelLayer';
import { FacadeModelLayer } from './FacadeModelLayer';
import { MapControls, defaultMapLayerState, is3dModeEnabled, set2dModeLayers, set3dStyleLayers, type Map3dStyle, type MapLayerState } from './MapControls';
import { MAP_COLORS } from './MapPalette';
import { TransitStopsLayer } from './TransitStopsLayer';
import type { TransitVehicleTripSelection } from './TransitStopsLayer';
import { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import { TransitRouteOverlay } from './TransitRouteOverlay';
import { RouteLineDeckLayer, type RouteLineFeature } from './RouteLineDeckLayer';
import { FlightControls } from './flight/FlightControls';
import { FlightTreeModelLayer } from './flight/FlightTreeModelLayer';
import { installFlightSceneScheduler } from './flight/FlightSceneScheduler';
import { useFlightSimulator } from './flight/useFlightSimulator';
import { useFlightModePresentation } from './flight/useFlightModePresentation';
import { DriveControls } from './drive/DriveControls';
import { useDriveSimulator } from './drive/useDriveSimulator';
import { useDriveModePresentation } from './drive/useDriveModePresentation';
const TransitDeparturesPanel = lazy(() => import('./TransitDeparturesPanel').then((module) => ({ default: module.TransitDeparturesPanel })));
import type { TransitStopSelection } from './TransitStopsLayer';
import { fetchValhallaRoute, type RouteMode, type RouteResult } from './ValhallaRouting';
import { fetchTransitRoutes, type TransitRouteResult } from './TransitRouting';
import {
  isWalkingTransitMode,
} from './TransitRouteOptions';
import { MapContextMenu } from './MapContextMenu';
import { NearbyPlacesPanel } from './NearbyPlacesPanel';
import { rankNearbyPlaces, type NearbyPlace } from './NearbyPlaces';
import {
  HIKING_POI_CLASSES,
  SPORT_FACILITY_POI_CLASSES,
  sportFacilityIconId,
} from './PoiClasses';
import { MapCameraActions } from './MapCameraActions';
import { PositionInformationPanel } from './PositionInformationPanel';
import { LocationInformationPanel } from './LocationInformationPanel';
import { TrafficCamerasLayer, trafficCameraFeatureAt } from './TrafficCamerasLayer';
import { RoadWeatherLayer, roadWeatherFeatureAt } from './RoadWeatherLayer';
import { RoadTrafficLayer, roadTrafficFeatureAt } from './RoadTrafficLayer';
import { ChargingStationsLayer, chargingStationFeatureAt } from './ChargingStationsLayer';
import { ChargingStationsConfigError } from './ChargingStations';
import { InfoActionRow } from '../components/InfoActionRow';
import { localDateTimeValue, useRoutePlanning, type LocationSelection } from './useRoutePlanning';
import {
  fetchDigitransitRoute,
  journeyVehicleKey,
  resolveJourneyVehicleLegs,
  type TransitProviderId,
} from './transit';
import { coordinateBounds, removeIsolatedCoordinateOutliers } from './RouteCamera';
import { elevationResult, formatCoordinates, formatNominatimAddress, queryTerrainElevation } from './PositionInformation';
import { useInfoPanelState } from './useInfoPanelState';
import { useTransitVehicleFollow } from './useTransitVehicleFollow';
import { useRouteVehicleRestore } from './useRouteVehicleRestore';
import { useMapSearch, type PhotonFeature } from './useMapSearch';
import { useRouteExecution } from './useRouteExecution';
import { useMapTools } from './useMapTools';
import { usePanelCoordinator } from './usePanelCoordinator';
import { useMapLayerVisibility } from './useMapLayerVisibility';
import { clearStaleTerrainGesture, installTerrainCameraFollower, isTerrainCameraFollowEvent, syncTerrain3d } from './MapTerrain';
import { useViewedWeather } from './useViewedWeather';
import { WeatherChip } from './WeatherChip';
import { WeatherPanel } from './WeatherPanel';
import { WeatherTimeSlider, weatherSliderTimes } from './WeatherTimeSlider';
import { DayNightTimeSlider } from './DayNightTimeSlider';
import { useDayNightCycle } from './useDayNightCycle';
import { DistanceMeasurementController, formatDistance, type Measurement } from './DistanceMeasurement';
import { availableGpsEndpoint, isMeaningfullyBetterLocation, locationZoomForAccuracy, markerFeatureCollection, normalizedLocationAccuracy } from './LocationMarkers';
import { installPersistedMapViewFlush } from './PersistedMapView';
import { useInAppNavigation } from '../lib/useInAppNavigation';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { installForegroundRecovery } from '../lib/ForegroundRecovery';
import { createMapDeepLink, shareMapDeepLink, type MapDeepLink } from '../lib/DeepLink';
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
  OPENFREEMAP_SOURCE_ID,
  updatePhysicalLineCaps,
  updatePhysicalWidthPaint,
  ROAD_WIDTH_DRIVE_MAX_ZOOM,
  ROAD_WIDTH_FLIGHT_MAX_ZOOM,
  applyMapTheme,
  ensureMountainPeakIcon,
} from './GlobalMapStyle';
import { overlayIconCollisionLayout, overlayIconLabelLayout } from './overlaySymbolLayout';
import {
  patternImageExpression,
  groundPatternLayers,
} from './GroundPatterns';
import { WATER_PATTERN_ID } from './WaterPattern';
import { installMapPatterns } from './MapPatterns';
import {
  closeRangeCameraOffset,
  smoothlyFollowVehicle,
  panelViewportPadding,
  searchViewportPadding,
} from './MapViewportLayout';
import {
  isValidCoordinate,
  mapRouteColor,
  routeColorForFeature,
} from './RoutePresentation';
import {
  locationCategory,
  locationDetails,
  locationIconId,
  locationSelectionFromFeature,
  photonResultLabel,
  positionInformationState,
  suggestedFavoriteName,
  type PendingFavorite,
} from './LocationFeature';
import { useMapCameraCoordinator } from './useMapCameraCoordinator';
import { RoutePlannerPanel } from './RoutePlannerPanel';
import { FavoriteDialog } from './FavoriteDialog';
import { InfrastructurePanels } from './InfrastructurePanels';
import { persistRuntimeCamera } from './MapRuntime';
import {
  assignMapLayerRuntimeRefs,
  createMapLayerRuntime,
  disposeMapLayerRuntime,
  releaseMapLayerRuntimeRefs,
  type MapLayerRuntimeRefs,
} from './MapLayerRuntime';
import { useMapRuntime, type MapRuntimeControls } from './useMapRuntime';
import { installMapInteractions } from './installMapInteractions';
import { installModelRefresh } from './installModelRefresh';
import { installAppSources } from './installAppSources';
const WATER_EFFECT_LAYER_IDS = ['global-water-pattern'];
const BUILDING_SHADOW_LAYER_IDS = [
  'global-building-shadow',
  'global-building-contact-shadow',
];
const LAYER_STORAGE_KEY = deploymentStorageKey('tampere-map-layer-options');
const THREE_D_STYLE_STORAGE_KEY = deploymentStorageKey('tampere-map-3d-style');

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
        minzoom: 14, maxzoom: 15.5, filter: locationPoiFilter(),
        layout: {
          'icon-image': iconImage as unknown as ExpressionSpecification,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 1.3, 15.5, 1.48, 18, 1.62] as ExpressionSpecification,
          ...overlayIconCollisionLayout(),
          'symbol-sort-key': locationPriorityExpression(),
        },
      },
      {
        id: 'location-poi-labels', type: 'symbol' as const, source, 'source-layer': sourceLayer,
        minzoom: 15.5, filter: locationPoiFilter(),
        layout: {
          'icon-image': iconImage as unknown as ExpressionSpecification,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 15.5, 1.2, 18, 1.5] as ExpressionSpecification,
          ...overlayIconCollisionLayout(),
          'text-field': ['get', 'name'] as ExpressionSpecification,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 10, 18, 13] as ExpressionSpecification,
          'text-offset': [0, 1.35] as [number, number],
          'text-anchor': 'top' as const,
          'text-padding': 10,
          ...overlayIconLabelLayout(),
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


function globalWaterPatternLayer(): FillLayerSpecification {
  return {
    id: 'global-water-pattern',
    type: 'fill',
    source: OPENFREEMAP_SOURCE_ID,
    'source-layer': 'water',
    // Pattern sampling over every ocean polygon is wasted at globe zooms
    // where the opacity is still 0. Keep this for close-range water texture.
    minzoom: 8,
    paint: {
      'fill-pattern': patternImageExpression(WATER_PATTERN_ID),
      'fill-antialias': false,
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        6, 0,
        7, 0.04,
        10, 0.12,
        14, 0.18,
        18, 0.24,
      ],
    },
  };
}

export function MapView({ onImmersiveModeChange }: { onImmersiveModeChange?: (active: boolean) => void }) {
  const { preference: themePreference, resolvedTheme, setPreference: setThemePreference } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [layerToggles, setLayerToggles] = useState<MapLayerState>(() => {
    const defaults = defaultMapLayerState();
    try {
      const saved = JSON.parse(window.localStorage.getItem(LAYER_STORAGE_KEY) ?? 'null') as Partial<MapLayerState> | null;
      return saved ? { ...defaults, ...saved } : defaults;
    } catch { return defaults; }
  });
  const [threeDStyle, setThreeDStyle] = useState<Map3dStyle>(() => {
    const defaultStyle: Map3dStyle = 'simple';
    try {
      const saved = window.localStorage.getItem(THREE_D_STYLE_STORAGE_KEY);
      return saved === 'simple' || saved === 'detailed' ? saved : defaultStyle;
    } catch { return defaultStyle; }
  });
  const { mapRef, mapError, mapLoaded, orientationChanged } = useMapRuntime(containerRef, installMapFeatures, {
    buildings: layerToggles.buildings,
    buildingColors: layerToggles.buildingColors,
  });
  const treeRefreshRef = useRef<(() => void) | null>(null);
  const treeLayerRef = useRef<TreeModelLayer | null>(null);
  const bridgeLayerRef = useRef<BridgeModelLayer | null>(null);
  const roofLayerRef = useRef<RoofModelLayer | null>(null);
  const facadeLayerRef = useRef<FacadeModelLayer | null>(null);
  const transitStopsLayerRef = useRef<TransitStopsLayer | null>(null);
  const trafficCamerasLayerRef = useRef<TrafficCamerasLayer | null>(null);
  const roadWeatherLayerRef = useRef<RoadWeatherLayer | null>(null);
  const roadTrafficLayerRef = useRef<RoadTrafficLayer | null>(null);
  const chargingStationsLayerRef = useRef<ChargingStationsLayer | null>(null);
  const transitVehicleLayerRef = useRef<TransitVehicleModelLayer | null>(null);
  const transitRouteOverlayRef = useRef<TransitRouteOverlay | null>(null);
  const selectedRouteDeckLayerRef = useRef<RouteLineDeckLayer | null>(null);
  const transitStopRouteDeckLayerRef = useRef<RouteLineDeckLayer | null>(null);
  const mapLayerRuntimeRefs = {
    tree: treeLayerRef,
    bridge: bridgeLayerRef,
    roof: roofLayerRef,
    facade: facadeLayerRef,
    transitStops: transitStopsLayerRef,
    trafficCameras: trafficCamerasLayerRef,
    roadWeather: roadWeatherLayerRef,
    roadTraffic: roadTrafficLayerRef,
    chargingStations: chargingStationsLayerRef,
    transitVehicle: transitVehicleLayerRef,
    transitRouteOverlay: transitRouteOverlayRef,
    selectedRouteDeck: selectedRouteDeckLayerRef,
    transitStopRouteDeck: transitStopRouteDeckLayerRef,
  } satisfies MapLayerRuntimeRefs;
  const flightTreeLayerRef = useRef<FlightTreeModelLayer | null>(null);
  const flightActiveRef = useRef(false);
  const driveActiveRef = useRef(false);
  const flightWasActiveRef = useRef(false);
  const driveWasActiveRef = useRef(false);
  const plannedVehicleTripRef = useRef<string | null>(null);
  const terrainSourceRef = useRef('terrain');
  const terrainEnabledRef = useRef(false);
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
  const departureAutoFollowPendingRef = useRef(false);
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
    routeSheet, routeSheetCollapsed, routeSheetSnapBeforeDetailsRef,
    routeOriginRef, routeDestinationRef, routePickingRef, routeAbortRef,
    routeCameraRequestRef, setRouteSheetCollapsed, closeTransitDetails,
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
  const is3dMode = is3dModeEnabled(layerToggles);
  const selectedMapStyle: '2d' | Map3dStyle = is3dMode ? threeDStyle : '2d';
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
  const [dayNightUtcMs, setDayNightUtcMs] = useState(() => Date.now());
  const [dayNightFollowNow, setDayNightFollowNow] = useState(true);
  const flight = useFlightSimulator({
    mapRef,
    mapLoaded,
    activeRef: flightActiveRef,
    dayNightUtcMs: layerToggles.dayNight ? dayNightUtcMs : undefined,
    terrainSourceRef,
    terrainEnabledRef,
    resolvedTheme,
    blockedRef: driveActiveRef,
  });
  const drive = useDriveSimulator({
    mapRef,
    mapLoaded,
    activeRef: driveActiveRef,
    dayNightUtcMs: layerToggles.dayNight ? dayNightUtcMs : undefined,
    terrainSourceRef,
    terrainEnabledRef,
    bridgeDeckSourceRef: bridgeLayerRef,
    resolvedTheme,
    blockedRef: flightActiveRef,
  });
  const immersiveActive = flight.active || drive.active;
  useMapLayerVisibility({
    mapRef,
    mapLoaded,
    layerToggles,
    resolvedTheme,
    dayNightEnabled: layerToggles.dayNight,
    treeLayerRef,
    bridgeLayerRef,
    roofLayerRef,
    facadeLayerRef,
    transitRouteOverlayRef,
    transitVehicleLayerRef,
    selectedRouteDeckLayerRef,
    transitStopRouteDeckLayerRef,
    treeRefreshRef,
    terrainSourceRef,
    terrainEnabledRef,
    flightActiveRef,
    flightActive: immersiveActive,
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
    flightActive: immersiveActive,
  });
  const dayNight = useDayNightCycle({
    mapRef,
    mapLoaded,
    enabled: layerToggles.dayNight,
    cloudsEnabled: layerToggles.clouds,
    buildingColorsEnabled: layerToggles.buildingColors,
    utcMs: dayNightUtcMs,
    flightActive: immersiveActive,
    resolvedTheme,
    treeLayerRef,
    bridgeLayerRef,
    transitVehicleLayerRef,
    facadeLayerRef,
    roofLayerRef,
  });
  useEffect(() => {
    if (!layerToggles.dayNight || !dayNightFollowNow) return;
    setDayNightUtcMs(Date.now());
    const timer = window.setInterval(() => setDayNightUtcMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [dayNightFollowNow, layerToggles.dayNight]);
  useFlightModePresentation({
    mapRef,
    mapLoaded,
    active: flight.active,
    transitRouteOverlayRef,
    transitLinesVisible: layerToggles.transitLines,
  });
  useDriveModePresentation({
    mapRef,
    mapLoaded,
    active: drive.active,
    transitRouteOverlayRef,
    transitLinesVisible: layerToggles.transitLines,
  });
  useEffect(() => {
    onImmersiveModeChange?.(immersiveActive);
    return () => onImmersiveModeChange?.(false);
  }, [immersiveActive, onImmersiveModeChange]);
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;
    // Map mode plateaus at z18; flight extends to z19; drive (closer chase) to z21.
    const latitude = map.getCenter().lat;
    const maxZoom = drive.active
      ? ROAD_WIDTH_DRIVE_MAX_ZOOM
      : flight.active
        ? ROAD_WIDTH_FLIGHT_MAX_ZOOM
        : 18;
    updatePhysicalWidthPaint(map, latitude, maxZoom);
    updatePhysicalLineCaps(map, immersiveActive);
  }, [drive.active, flight.active, immersiveActive, mapLoaded]);
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
    if (drive.active) {
      driveWasActiveRef.current = true;
      return;
    }
    if (!driveWasActiveRef.current) return;
    driveWasActiveRef.current = false;
    const frame = window.requestAnimationFrame(() => mapRef.current?.getCanvas().focus());
    return () => window.cancelAnimationFrame(frame);
  }, [drive.active]);
  useEffect(() => {
    const map = mapRef.current;
    if (!flight.active || !mapLoaded || !layerToggles.trees || !map) return;

    const flightTreeLayer = new FlightTreeModelLayer({
      sourceId: OPENFREEMAP_SOURCE_ID,
      waterLayers: ['water'],
      vegetationLayers: ['landcover', 'landuse', 'park'],
      biomeLayer: 'global-globe-biomes',
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
    return () => {
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
    const map = mapRef.current;
    if (!flight.active || !mapLoaded || !map) return;
    const roofLayer = roofLayerRef.current;
    const facadeLayer = facadeLayerRef.current;
    const bridgeLayer = bridgeLayerRef.current;
    bridgeLayer?.setFlightMode(true);
    roofLayer?.setFlightMode(true);
    facadeLayer?.setFlightMode(true);
    const stopRefresh = installFlightSceneScheduler(map, OPENFREEMAP_SOURCE_ID, [
      () => flightTreeLayerRef.current?.updateTrees(true),
      () => bridgeLayer?.updateBridges(),
      () => roofLayer?.requestFlightRefresh(),
      () => facadeLayer?.requestFlightRefresh(),
    ]);
    return () => {
      stopRefresh();
      bridgeLayer?.setFlightMode(false);
      roofLayer?.setFlightMode(false);
      facadeLayer?.setFlightMode(false);
    };
  }, [flight.active, layerToggles.trees, mapLoaded]);
  useEffect(() => {
    const map = mapRef.current;
    if (!drive.active || !mapLoaded || !map) return;
    const roofLayer = roofLayerRef.current;
    const facadeLayer = facadeLayerRef.current;
    const bridgeLayer = bridgeLayerRef.current;
    const treeLayer = treeLayerRef.current;
    // Same continuous-camera refresh path as flight: normal moveend/idle
    // updates are skipped while jumpTo runs every frame.
    bridgeLayer?.setFlightMode(true);
    roofLayer?.setFlightMode(true);
    facadeLayer?.setFlightMode(true);
    treeLayer?.setDriveCoverage(true);
    const stopRefresh = installFlightSceneScheduler(map, OPENFREEMAP_SOURCE_ID, [
      () => {
        if (layerToggles.trees) treeLayerRef.current?.updateTrees();
      },
      () => bridgeLayer?.updateBridges(),
      () => roofLayer?.requestFlightRefresh(),
      () => facadeLayer?.requestFlightRefresh(),
    ], { moveMeters: 60, turnDegrees: 10 });
    return () => {
      stopRefresh();
      bridgeLayer?.setFlightMode(false);
      roofLayer?.setFlightMode(false);
      facadeLayer?.setFlightMode(false);
      treeLayer?.setDriveCoverage(false);
      if (layerToggles.trees) treeRefreshRef.current?.();
    };
  }, [drive.active, layerToggles.trees, mapLoaded]);

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
      smoothlyFollowVehicle(map, coordinates, 500);
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
    smoothlyFollowVehicle(map, vehicle.coordinates, 500);
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
    : drive.active ? 'drive'
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
    if (drive.active) { drive.stop(); return; }
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
      selectedRouteDeckLayerRef.current?.setFeatures([]);
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
      : result.geometry.coordinates.length > 1
        ? { type: 'Feature', geometry: result.geometry, properties: { mode: directMode } }
        : { type: 'FeatureCollection', features: [] });
    // Feed the same geometry to the 3D deck layer so route lines render on
    // bridge decks instead of sinking under them when terrain is on.
    const deckFeatures: RouteLineFeature[] = legFeatures.length > 0
      ? legFeatures.map((f) => ({
          coordinates: f.geometry.coordinates as Array<[number, number]>,
          color: routeColorForFeature(f.properties.mode, f.properties.routeColor),
          widthPixels: 4.5,
          casingWidthPixels: 8,
        }))
      : result.geometry.coordinates.length > 1 ? [{
          coordinates: result.geometry.coordinates as Array<[number, number]>,
          color: routeColorForFeature(directMode),
          widthPixels: 4.5,
          casingWidthPixels: 8,
        }] : [];
    selectedRouteDeckLayerRef.current?.setFeatures(deckFeatures);
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

  const { cancelPendingCamera, fitRouteNow, scheduleRouteFit } = useMapCameraCoordinator({
    mapRef,
    mapLoaded,
    immersiveActive,
    routeOpen,
    routeResult,
    routeSheetCollapsed,
    transitDetailsOpen,
    routeOriginRef,
    routeDestinationRef,
    routeCameraRequestRef,
    pendingSearchCameraRef,
    selectionCameraActiveRef,
    selectedTransitStop,
    selectedLocation,
    positionInformation,
    selectedTrafficCamera,
    selectedChargingStation,
    selectedRoadWeather,
    selectedRoadTraffic,
    selectedRoadTrafficMessage,
    setRouteSheetCollapsed,
  });

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
    prepareInfrastructurePanelOpen,
    preserveRouteVehicleForInfoPanel,
    selectTransitStopForInfoPanel,
    clearTransitInfoSelection,
    openPositionInformation,
    prepareForMeasurement,
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
    stopMeasurement();
    prepareForMeasurement();
    setRouteContextMenu(null);
    measurementControllerRef.current = new DistanceMeasurementController(map, start, setMeasurement);
  }

  function installMapFeatures(map: Map, deepLink: MapDeepLink | null, runtime: MapRuntimeControls) {
    // Peak markers share a symbol with their labels; register the icon before
    // the first paint so labeled peaks render as a point + name together.
    ensureMountainPeakIcon(map);
    const disposeTunnelPortals = installTunnelPortals(map);
    // Use the explicitly documented key bindings below rather than MapLibre's
    // broader defaults, so modifier keys and editable controls remain untouched.
    map.keyboard.disable();

    const layerRuntime = createMapLayerRuntime((pose) => {
      latestVehiclePoseRef.current = pose;
      setVehicleFollowAvailable(Boolean(pose));
      setVehiclePositionStatus(pose?.status ?? 'unavailable');
      if (pose?.hasLeftStartingStop && departureAutoFollowPendingRef.current
        && vehicleFollowEnabledRef.current) {
        departureAutoFollowPendingRef.current = false;
        setVehicleFollowing(true);
      }
      if (!pose || !vehicleFollowEnabledRef.current || (flightActiveRef.current || driveActiveRef.current)) return;
      if (!vehicleFollowingRef.current && !pose.hasLeftStartingStop) return;
      if (Date.now() - lastUserInteractionRef.current < 400) return;
      const vehicle = pose.parts[Math.floor(pose.parts.length / 2)];
      smoothlyFollowVehicle(map, vehicle.coordinates);
    });
    assignMapLayerRuntimeRefs(layerRuntime, mapLayerRuntimeRefs);
    const {
      tree: treeLayer,
      bridge: bridgeLayer,
      roof: roofLayer,
      facade: facadeLayer,
      transitVehicle: transitVehicleLayer,
      transitStops: transitStopsLayer,
      trafficCameras: trafficCamerasLayer,
      roadWeather: roadWeatherLayer,
      roadTraffic: roadTrafficLayer,
      chargingStations: chargingStationsLayer,
      transitRouteOverlay,
      selectedRouteDeck: selectedRouteDeckLayer,
      transitStopRouteDeck: transitStopRouteDeckLayer,
    } = layerRuntime;
    let disposeMapPatterns: (() => void) | undefined;
    let transitStopsTimer: number | undefined;
    let chargingStationsTimer: number | undefined;
    let initialLoadComplete = false;
    let roadWidthLatitude: number | undefined;
    let roadWidthMaxZoom: number | undefined;
    let globalLabelDensitySignature: string | undefined;
    let previousOrientationChanged = false;

    const updateGlobalPhysicalWidths = () => {
      const latitude = map.getCenter().lat;
      const immersive = flightActiveRef.current || driveActiveRef.current;
      const maxZoom = driveActiveRef.current
        ? ROAD_WIDTH_DRIVE_MAX_ZOOM
        : flightActiveRef.current
          ? ROAD_WIDTH_FLIGHT_MAX_ZOOM
          : 18;
      if (
        roadWidthLatitude !== undefined
        && Math.abs(latitude - roadWidthLatitude) < 0.25
        && roadWidthMaxZoom === maxZoom
      ) return;
      roadWidthLatitude = latitude;
      roadWidthMaxZoom = maxZoom;
      updatePhysicalWidthPaint(map, latitude, maxZoom);
      updatePhysicalLineCaps(map, immersive);
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
        ['global-road-labels-regional', [regionalLabelFade, 0.78 * regionalLabelFade, 0.5 * regionalLabelFade]],
        ['global-town-labels', [1, 1, 1]],
        ['global-locality-labels', [1, 1, 1]],
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
    const modelRefresh = installModelRefresh({
      map,
      layers: layerRuntime,
      terrainSource: () => terrainSourceRef.current,
      terrainEnabled: () => terrainEnabledRef.current,
      immersiveActive: () => flightActiveRef.current || driveActiveRef.current,
    });
    const scheduleTreeUpdate = modelRefresh.schedule;
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
    treeRefreshRef.current = modelRefresh.invalidate;
    const handleLocationClick = (event: { point: Point }) => {
      if ((flightActiveRef.current || driveActiveRef.current)) return;
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
    const showRouteContextMenu = (point: Point, coordinates: [number, number]) => {
      const container = map.getContainer();
      setContextMenuMarker(coordinates);
      setRouteContextMenu({
        x: Math.min(Math.max(point.x, 12), container.clientWidth - 12),
        y: Math.min(Math.max(point.y, 12), container.clientHeight - 12),
        coordinates,
      });
    };
    let cancelTerrainCameraEase = () => {};
    let interactionController: ReturnType<typeof installMapInteractions> | undefined;
    map.once('load', async () => {
      disposeMapPatterns = installMapPatterns(map);
      map.addLayer(globalWaterPatternLayer(), 'global-pedestrian-areas');
      for (const layer of groundPatternLayers()) map.addLayer(layer, 'global-pedestrian-areas');
      map.addLayer(bridgeLayer, 'global-road-labels');
      map.addLayer(treeLayer, 'global-road-labels');
      map.addLayer(roofLayer, 'global-road-labels');
      map.addLayer(facadeLayer, 'global-road-labels');
      map.addLayer(transitVehicleLayer, 'global-road-labels');
      map.addLayer(selectedRouteDeckLayer, 'global-road-labels');
      map.addLayer(transitStopRouteDeckLayer, 'global-road-labels');
      try {
        await addLocationIcons(map);
      } catch (error) {
        console.warn('Location icons could not be loaded; hiding POI icons.', error);
      }
      const poiLayers = locationPoiLayers();
      installAppSources(map);
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
      interactionController = installMapInteractions(map, {
        isBlocked: () => flightActiveRef.current || driveActiveRef.current,
        isMeasurementActive: () => measurementControllerRef.current !== null,
        onMapClick: handleLocationClick,
        onContextMenu: showRouteContextMenu,
        onUserInteraction: () => {
          lastUserInteractionRef.current = Date.now();
          vehicleFollowEnabledRef.current = false;
          setVehicleFollowing(false);
        },
        onGestureStart: () => { lastUserInteractionRef.current = Date.now(); },
        onBeforePan: () => {
          clearStaleTerrainGesture(map);
          cancelTerrainCameraEase();
        },
      });
      interactionController.installLayerCursors();
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
        prepareInfrastructurePanelOpen();
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
        prepareInfrastructurePanelOpen();
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
        prepareInfrastructurePanelOpen();
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
        prepareInfrastructurePanelOpen();
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
      updateGlobalPhysicalWidths();
      updateGlobalLabelDensity();
      scheduleTreeUpdate();
      scheduleTransitStopsUpdate();
      updateTransitRouteOverlay();
      initialLoadComplete = true;
      runtime.setLoaded(true);
      if (deepLink) {
        runtime.consumeInitialDeepLink();
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
      try { persistRuntimeCamera(map); } catch { /* local storage can be disabled */ }
    };
    const terrainCameraFollower = installTerrainCameraFollower(map, {
      isPaused: () => (flightActiveRef.current || driveActiveRef.current),
    });
    cancelTerrainCameraEase = () => terrainCameraFollower.cancel();
    const handleMoveEnd = (event?: unknown) => {
      if ((flightActiveRef.current || driveActiveRef.current) || isTerrainCameraFollowEvent(event)) return;
      persistCamera();
      updateGlobalPhysicalWidths();
      scheduleTreeUpdate();
      // Vehicle follow recenters the map several times per second. Those
      // camera-only moves must not trigger a fresh stop query on every moveend.
      if (!vehicleFollowEnabledRef.current) scheduleTransitStopsUpdate();
      updateTransitRouteOverlay();
      selectedRouteDeckLayer.rebuildFromCurrentFeatures();
      transitStopRouteDeckLayer.rebuildFromCurrentFeatures();
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
    const handleCameraMove = (event?: unknown) => {
      if ((flightActiveRef.current || driveActiveRef.current)) {
        updateGlobalPhysicalWidths();
        return;
      }
      if (isTerrainCameraFollowEvent(event)) return;
      const zoom = map.getZoom();
      const pitch = map.getPitch();
      const nextLabelSignature = `${Math.round(zoom * 2) / 2}:${Math.round(pitch / 10) * 10}`;
      const nextOrientationChanged = Math.abs(map.getBearing()) > 1 || pitch > 1;
      if (nextOrientationChanged !== previousOrientationChanged) {
        previousOrientationChanged = nextOrientationChanged;
        runtime.setOrientationChanged(nextOrientationChanged);
      }
      if (nextLabelSignature !== globalLabelDensitySignature) {
        updateGlobalLabelDensity();
      }
      syncTerrain3d(map, {
        userEnabled: terrainEnabledRef.current,
        source: terrainSourceRef.current,
      });
    };
    map.on('move', handleCameraMove);
    map.on('moveend', handleMoveEnd);
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
        runtime.setError(message);
      }
    });

    return () => {
      disposeMapPatterns?.();
      disposeTunnelPortals();
      terrainCameraFollower.dispose();
      measurementControllerRef.current?.dispose();
      measurementControllerRef.current = null;
      if (transitStopsTimer !== undefined) window.clearTimeout(transitStopsTimer);
      if (chargingStationsTimer !== undefined) window.clearTimeout(chargingStationsTimer);
      modelRefresh.dispose();
      map.off('move', handleCameraMove);
      removePersistedMapViewFlush();
      removeForegroundRecovery();
      map.off('moveend', handleMoveEnd);
      interactionController?.dispose();
      disposeMapLayerRuntime(layerRuntime);
      treeRefreshRef.current = null;
      flightTreeLayerRef.current = null;
      releaseMapLayerRuntimeRefs(layerRuntime, mapLayerRuntimeRefs);
    };
  }



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

  useEffect(() => () => {
    routeAddressAbortRef.current.origin?.abort();
    routeAddressAbortRef.current.destination?.abort();
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(layerToggles)); } catch { /* storage can be disabled */ }
  }, [layerToggles]);

  useEffect(() => {
    try { window.localStorage.setItem(THREE_D_STYLE_STORAGE_KEY, threeDStyle); } catch { /* storage can be disabled */ }
  }, [threeDStyle]);

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
    <div className={`map-view${flight.active ? ' flight-mode' : ''}${drive.active ? ' drive-mode' : ''}`}>
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
      {mapLoaded && !mapError && drive.active && (
        <DriveControls
          telemetry={drive.telemetry}
          onControlChange={drive.setControl}
          onExit={drive.stop}
        />
      )}
      {mapLoaded && !mapError && (
        <>
          {!immersiveActive && <MapControls
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
            onLayerChange={(key, enabled) => {
              setLayerToggles((current) => ({
                ...current,
                [key]: enabled,
              }));
              if (key === 'dayNight' && enabled) {
                setDayNightFollowNow(true);
                setDayNightUtcMs(Date.now());
              }
            }}
            is3dMode={is3dMode}
            onToggle3dMode={() => setLayerToggles((current) => {
              if (is3dModeEnabled(current)) return set2dModeLayers(current);
              return set3dStyleLayers(current, threeDStyle);
            })}
            selectedMapStyle={selectedMapStyle}
            onMapStyleChange={(style) => {
              if (style === '2d') {
                setLayerToggles(set2dModeLayers);
                return;
              }
              setThreeDStyle(style);
              setLayerToggles((current) => set3dStyleLayers(current, style));
            }}
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
          {!immersiveActive && layerToggles.weather && !routeOpen && !layersOpen && viewedWeather.viewUsable && (
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
          {viewedWeather.panelOpen && viewedWeather.viewUsable && (
            <WeatherPanel
              weather={viewedWeather.weather}
              placeName={viewedWeather.placeName}
              loading={viewedWeather.loading}
              unavailable={viewedWeather.unavailable}
              sheet={weatherSheet}
              onClose={viewedWeather.closePanel}
              onOpenOverlay={viewedWeather.openOverlay}
            />
          )}
          {viewedWeather.overlayOpen && viewedWeather.viewUsable && (
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
          {!immersiveActive && layerToggles.dayNight && !routeOpen && !layersOpen && (
            <DayNightTimeSlider
              appearance={dayNight.appearance}
              timeZone={dayNight.timeZone}
              followNow={dayNightFollowNow}
              weatherOverlayOpen={viewedWeather.overlayOpen && viewedWeather.viewUsable}
              onTimeChange={(utcMs) => {
                setDayNightFollowNow(false);
                setDayNightUtcMs(utcMs);
              }}
              onFollowNow={() => {
                setDayNightFollowNow(true);
                setDayNightUtcMs(Date.now());
              }}
              onClose={() => setLayerToggles((current) => ({ ...current, dayNight: false }))}
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
                cancelPendingCamera();
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                if (measurementControllerRef.current) stopMeasurement();
                flight.start(coordinates);
              }}
              onDriveFromHere={() => {
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
                cancelPendingCamera();
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                if (measurementControllerRef.current) stopMeasurement();
                drive.start(coordinates);
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
          <FavoriteDialog
            favorite={pendingFavorite}
            setFavorite={setPendingFavorite}
            onKindChange={selectFavoriteKind}
            onClose={closeFavoriteDialog}
            onConfirm={confirmFavorite}
          />
          <InfrastructurePanels
            selections={{
              roadWeather: selectedRoadWeather,
              roadTrafficMessage: selectedRoadTrafficMessage,
              roadTraffic: selectedRoadTraffic,
              chargingStation: selectedChargingStation,
              trafficCamera: selectedTrafficCamera,
            }}
            sheets={{
              roadWeather: roadWeatherSheet,
              roadTrafficMessage: roadTrafficMessageSheet,
              roadTraffic: roadTrafficSheet,
              chargingStation: chargingStationSheet,
              trafficCamera: trafficCameraSheet,
            }}
            onClose={{
              roadWeather: () => {
                roadWeatherLayerRef.current?.clearSelection();
                closeRoadWeather();
              },
              roadTrafficMessage: () => {
                roadTrafficLayerRef.current?.clearSelection();
                closeRoadTrafficMessage();
              },
              roadTraffic: () => {
                roadTrafficLayerRef.current?.clearSelection();
                closeRoadTraffic();
              },
              chargingStation: () => {
                chargingStationsLayerRef.current?.clearSelection();
                closeChargingStation();
              },
              trafficCamera: () => {
                trafficCamerasLayerRef.current?.clearSelection();
                closeTrafficCamera();
              },
            }}
            onShare={(selection, minimumZoom) => shareSelection({
              type: 'position',
              coordinates: selection.coordinates,
              zoom: Math.max(mapRef.current?.getZoom() ?? 14, minimumZoom),
              name: selection.name,
            }, selection.name)}
            onDirections={(destination) => {
              openRoute();
              setRouteEndpoint('destination', destination);
            }}
          />
          {selectedTransitStop && !selectedTrafficCamera && !selectedChargingStation && !selectedRoadWeather && !selectedRoadTraffic && !selectedRoadTrafficMessage && (
            <Suspense fallback={null}><TransitDeparturesPanel
              stop={selectedTransitStop}
              onDetailOpenChange={setTransitDepartureDetailOpen}
              navigationBackSignal={transitNavigationBackSignal}
              onDepartureSelect={({ tripId, mode, color, serviceDate, departure, scheduledDeparture }) => {
                departureAutoFollowPendingRef.current = true;
                vehicleFollowEnabledRef.current = true;
                setVehicleFollowing(false);
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
                departureAutoFollowPendingRef.current = false;
                vehicleFollowEnabledRef.current = false;
                setVehicleFollowing(false);
                setVehicleFollowAvailable(false);
                transitStopsLayerRef.current?.clearTrip();
                const map = mapRef.current;
                if (map) map.easeTo({
                  center: selectedTransitStop.coordinates,
                  zoom: Math.max(map.getZoom(), 14.6),
                  offset: closeRangeCameraOffset(),
                  duration: 700,
                });
              }}
              onFollowRequest={() => {
                departureAutoFollowPendingRef.current = false;
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
          <RoutePlannerPanel
            route={routePlanning}
            onCancel={cancelRoute}
            controls={{
              searchQuery,
              setSearchQuery,
              searchLoading,
              searchError,
              displayedSearchResults,
              favoriteFeatures,
              userLocationRef,
              routeSearchAnchorRefs,
              routeSearchResultsRef,
              setSearchOpen,
              setSearchResults,
              setSearchError,
              beginRouteSearch,
              pickRouteEndpoint,
              selectYourLocation,
              selectSearchResult,
              selectTransitRoute,
              swapRouteEndpoints,
              photonResultLabel,
            }}
          />
        </>
      )}
    </div>
  );
}
