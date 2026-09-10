import { useEffect, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import type { TreeModelLayer } from './TreeModelLayer';
import type { BridgeModelLayer } from './BridgeModelLayer';
import type { RoofModelLayer } from './RoofModelLayer';
import type { FacadeModelLayer } from './FacadeModelLayer';
import type { TransitRouteOverlay } from './TransitRouteOverlay';
import type { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import type { RouteLineDeckLayer } from './RouteLineDeckLayer';
import type { MapLayerState } from './MapControls';
import { applyMapTheme, buildingColorPaint, GLOBAL_BASE_LABEL_LAYER_IDS, GLOBAL_FEATURE_LABEL_LAYER_IDS } from './GlobalMapStyle';
import { syncTerrain3d } from './MapTerrain';
import { TRAFFIC_CAMERA_LAYER_IDS } from './TrafficCamerasLayer';
import { CHARGING_STATION_LAYER_IDS } from './ChargingStationsLayer';
import { ROAD_WEATHER_LAYER_IDS } from './RoadWeatherLayer';
import { ROAD_TRAFFIC_LAYER_IDS } from './RoadTrafficLayer';
import { applyGroundPatternTheme } from './GroundPatterns';
import {
  COMBINED_SYMBOL_TEXT_LAYER_IDS,
  RUNTIME_LABEL_LAYER_IDS,
  setLayerTextVisible,
  syncIconLabelZoomBands,
} from './overlaySymbolLayout';

type LayerRefs = {
  treeLayerRef: RefObject<TreeModelLayer | null>;
  bridgeLayerRef: RefObject<BridgeModelLayer | null>;
  roofLayerRef: RefObject<RoofModelLayer | null>;
  facadeLayerRef: RefObject<FacadeModelLayer | null>;
  transitRouteOverlayRef: RefObject<TransitRouteOverlay | null>;
  transitVehicleLayerRef: RefObject<TransitVehicleModelLayer | null>;
  selectedRouteDeckLayerRef: RefObject<RouteLineDeckLayer | null>;
  transitStopRouteDeckLayerRef: RefObject<RouteLineDeckLayer | null>;
  treeRefreshRef: RefObject<(() => void) | null>;
  terrainSourceRef: RefObject<string>;
  terrainEnabledRef: RefObject<boolean>;
  flightActiveRef: RefObject<boolean>;
  flightActive: boolean;
};

type MapLayerVisibilityOptions = LayerRefs & {
  mapRef: RefObject<Map | null>;
  mapLoaded: boolean;
  layerToggles: MapLayerState;
  resolvedTheme: 'light' | 'dark';
  dayNightEnabled: boolean;
  building3dLayerIds: string[];
  buildingShadowLayerIds: string[];
  buildingTransitionFootprintLayerId: string;
  building2dLayerId: string;
  cyclingLayerIds: string[];
  hikingLayerIds: string[];
  waterEffectLayerIds: string[];
  onTransitDisabled: () => void;
  onTrafficCamerasDisabled: () => void;
  onChargingStationsDisabled: () => void;
  onRoadWeatherDisabled: () => void;
  onRoadTrafficDisabled: () => void;
};

type LayerVisibilityMap = {
  getLayer: (layerId: string) => unknown;
  setLayoutProperty: (layerId: string, property: 'visibility', value: 'visible' | 'none') => unknown;
};

function applyBuildingColors(map: Map, enabled: boolean, theme: 'light' | 'dark', footprintLayerIds: string[]) {
  const buildingColor = theme === 'dark' ? '#293f53' : '#fffdf8';
  const buildingBand = theme === 'dark' ? '#625f52' : '#dedad1';
  footprintLayerIds.forEach((id) => {
    if (map.getLayer(id)) map.setPaintProperty(id, 'fill-color', buildingColorPaint(buildingColor, enabled));
  });
  if (map.getLayer('global-building-ground-storeys')) {
    map.setPaintProperty('global-building-ground-storeys', 'fill-extrusion-color', buildingColorPaint(buildingBand, enabled));
  }
  if (map.getLayer('global-buildings')) {
    map.setPaintProperty('global-buildings', 'fill-extrusion-color', buildingColorPaint(buildingColor, enabled));
  }
}

export function setMapLayerVisibility(map: LayerVisibilityMap, layerIds: string[], visible: boolean) {
  layerIds.forEach((layerId) => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  });
}

export function useMapLayerVisibility({
  mapRef, mapLoaded, layerToggles, resolvedTheme, dayNightEnabled,
  treeLayerRef, bridgeLayerRef, roofLayerRef, facadeLayerRef, transitRouteOverlayRef, transitVehicleLayerRef, selectedRouteDeckLayerRef, transitStopRouteDeckLayerRef, treeRefreshRef,
  terrainSourceRef, terrainEnabledRef, flightActiveRef, flightActive, building3dLayerIds, buildingShadowLayerIds,
  buildingTransitionFootprintLayerId, building2dLayerId, cyclingLayerIds,
  hikingLayerIds, waterEffectLayerIds, onTransitDisabled, onTrafficCamerasDisabled, onChargingStationsDisabled,
  onRoadWeatherDisabled, onRoadTrafficDisabled,
}: MapLayerVisibilityOptions) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const setVisibility = (layerIds: string[], visible: boolean) => setMapLayerVisibility(map, layerIds, visible);
    // Flight owns trees, terrain, projection, and theme sky while active.
    // Re-run this effect when flight ends so map mode reclaims those.
    if (flightActive || flightActiveRef.current) {
      return;
    }
    setVisibility(['tree-models-3d', 'tree-points'], layerToggles.trees);
    terrainEnabledRef.current = layerToggles.terrain;
    syncTerrain3d(map, { userEnabled: layerToggles.terrain, source: terrainSourceRef.current });
    if (map.getLayer('terrain-hillshade')) {
      map.setLayoutProperty('terrain-hillshade', 'visibility', layerToggles.terrain && terrainSourceRef.current === 'terrain' ? 'visible' : 'none');
    }
    bridgeLayerRef.current?.setEnabled(layerToggles.bridges);
    const proceduralBuildingEnabled = layerToggles.proceduralBuildingDetails && layerToggles.buildings;
    roofLayerRef.current?.setEnabled(proceduralBuildingEnabled);
    facadeLayerRef.current?.setEnabled(proceduralBuildingEnabled);
    setVisibility((map.getStyle().layers ?? []).map((layer) => layer.id)
      .filter((layerId) => layerId.startsWith('transit-') && layerId !== 'transit-vehicle-model-3d' && layerId !== 'transit-selected-route-deck-3d'), layerToggles.transit);
    setVisibility(['transit-vehicle-model-3d'], layerToggles.transitModels);
    setVisibility([...TRAFFIC_CAMERA_LAYER_IDS], layerToggles.trafficCameras);
    setVisibility([...CHARGING_STATION_LAYER_IDS], layerToggles.chargingStations);
    setVisibility([...ROAD_WEATHER_LAYER_IDS], layerToggles.roadWeather);
    setVisibility([...ROAD_TRAFFIC_LAYER_IDS], layerToggles.roadTraffic);
    setVisibility(building3dLayerIds, layerToggles.buildings);
    setVisibility([buildingTransitionFootprintLayerId], layerToggles.buildings);
    setVisibility([building2dLayerId], !layerToggles.buildings);
    setVisibility(buildingShadowLayerIds, layerToggles.buildings);
    treeLayerRef.current?.setShadowsEnabled(layerToggles.trees);
    setVisibility(cyclingLayerIds, layerToggles.cycling);
    setVisibility(hikingLayerIds, layerToggles.hiking);
    setVisibility(['location-poi-icons', 'favorite-icons'], layerToggles.locationIcons);
    setVisibility(['location-poi-labels'], layerToggles.locationIcons && layerToggles.labels);
    if (!layerToggles.locationIcons) setVisibility(['global-hiking-pois'], false);
    transitRouteOverlayRef.current?.setVisibility(layerToggles.transitLines);
    if (layerToggles.transitLines) void transitRouteOverlayRef.current?.update(map.getBounds(), map.getZoom());
    setVisibility(GLOBAL_BASE_LABEL_LAYER_IDS, layerToggles.labels);
    if (!layerToggles.labels) {
      setVisibility([...GLOBAL_FEATURE_LABEL_LAYER_IDS, ...RUNTIME_LABEL_LAYER_IDS], false);
    }
    setLayerTextVisible(map, COMBINED_SYMBOL_TEXT_LAYER_IDS, layerToggles.labels);
    syncIconLabelZoomBands(map, layerToggles.labels);
    // 3D deck layers draw bridge-crossing segments on top of bridge decks.
    // Native 2D lines stay visible everywhere else (no hiding needed).
    const deckActive = layerToggles.terrain && layerToggles.bridges;
    selectedRouteDeckLayerRef.current?.setVisible(deckActive);
    transitStopRouteDeckLayerRef.current?.setVisible(deckActive && layerToggles.transit);
    setVisibility(waterEffectLayerIds, true);
    map.setProjection({ type: layerToggles.globe ? 'globe' : 'mercator' });
    map.triggerRepaint();
    treeRefreshRef.current?.();
    if (!layerToggles.transit) onTransitDisabled();
    if (!layerToggles.trafficCameras) onTrafficCamerasDisabled();
    if (!layerToggles.chargingStations) onChargingStationsDisabled();
    if (!layerToggles.roadWeather) onRoadWeatherDisabled();
    if (!layerToggles.roadTraffic) onRoadTrafficDisabled();
  }, [mapLoaded, layerToggles.globe, layerToggles.terrain, layerToggles.buildings, layerToggles.bridges,
    layerToggles.proceduralBuildingDetails,
    layerToggles.trees, layerToggles.cycling, layerToggles.hiking, layerToggles.transit,
    layerToggles.transitLines, layerToggles.transitModels, layerToggles.trafficCameras,
    layerToggles.chargingStations, layerToggles.roadWeather, layerToggles.roadTraffic,
    layerToggles.locationIcons, layerToggles.labels,
    building2dLayerId, building3dLayerIds, buildingShadowLayerIds, buildingTransitionFootprintLayerId,
    cyclingLayerIds, hikingLayerIds, flightActive, flightActiveRef, mapRef, onChargingStationsDisabled,
    onRoadTrafficDisabled, onRoadWeatherDisabled, onTrafficCamerasDisabled, onTransitDisabled,
    terrainEnabledRef, terrainSourceRef, treeLayerRef, treeRefreshRef, transitRouteOverlayRef,
    waterEffectLayerIds, bridgeLayerRef, roofLayerRef, facadeLayerRef, selectedRouteDeckLayerRef, transitStopRouteDeckLayerRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    treeLayerRef.current?.setTheme(!dayNightEnabled && resolvedTheme === 'dark');
    bridgeLayerRef.current?.setTheme(!dayNightEnabled && resolvedTheme === 'dark');
    roofLayerRef.current?.setTheme(!dayNightEnabled && resolvedTheme === 'dark');
    facadeLayerRef.current?.setTheme(!dayNightEnabled && resolvedTheme === 'dark');
    transitVehicleLayerRef.current?.setTheme(!dayNightEnabled && resolvedTheme === 'dark');
    applyGroundPatternTheme(map, resolvedTheme);
    if (flightActive || flightActiveRef.current || dayNightEnabled) return;
    applyMapTheme(map, resolvedTheme);
    map.triggerRepaint();
  }, [dayNightEnabled, flightActive, flightActiveRef, mapLoaded, mapRef, resolvedTheme,
    bridgeLayerRef, roofLayerRef, facadeLayerRef, transitVehicleLayerRef, treeLayerRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || flightActive || flightActiveRef.current || dayNightEnabled) return;
    applyBuildingColors(map, layerToggles.buildingColors, resolvedTheme,
      [buildingTransitionFootprintLayerId, building2dLayerId]);
    map.triggerRepaint();
  }, [building2dLayerId, buildingTransitionFootprintLayerId, dayNightEnabled, flightActive,
    flightActiveRef, layerToggles.buildingColors, mapLoaded, mapRef, resolvedTheme]);
}
