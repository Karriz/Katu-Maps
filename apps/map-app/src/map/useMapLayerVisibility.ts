import { useEffect, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import type { TreeModelLayer } from './TreeModelLayer';
import type { TransitRouteOverlay } from './TransitRouteOverlay';
import type { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import type { MapLayerState } from './MapControls';
import { applyMapTheme } from './GlobalMapStyle';
import { TRAFFIC_CAMERA_LAYER_IDS } from './TrafficCamerasLayer';

type LayerRefs = {
  treeLayerRef: RefObject<TreeModelLayer | null>;
  transitRouteOverlayRef: RefObject<TransitRouteOverlay | null>;
  transitVehicleLayerRef: RefObject<TransitVehicleModelLayer | null>;
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
  building3dLayerIds: string[];
  buildingShadowLayerIds: string[];
  buildingTransitionFootprintLayerId: string;
  building2dLayerId: string;
  cyclingLayerIds: string[];
  hikingLayerIds: string[];
  waterEffectLayerIds: string[];
  onTransitDisabled: () => void;
  onTrafficCamerasDisabled: () => void;
};

type LayerVisibilityMap = {
  getLayer: (layerId: string) => unknown;
  setLayoutProperty: (layerId: string, property: 'visibility', value: 'visible' | 'none') => unknown;
};

export function setMapLayerVisibility(map: LayerVisibilityMap, layerIds: string[], visible: boolean) {
  layerIds.forEach((layerId) => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  });
}

export function useMapLayerVisibility({
  mapRef, mapLoaded, layerToggles, resolvedTheme,
  treeLayerRef, transitRouteOverlayRef, transitVehicleLayerRef, treeRefreshRef,
  terrainSourceRef, terrainEnabledRef, flightActiveRef, flightActive, building3dLayerIds, buildingShadowLayerIds,
  buildingTransitionFootprintLayerId, building2dLayerId, cyclingLayerIds,
  hikingLayerIds, waterEffectLayerIds, onTransitDisabled, onTrafficCamerasDisabled,
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
    setVisibility((map.getStyle().layers ?? []).map((layer) => layer.id)
      .filter((layerId) => layerId.startsWith('transit-') && layerId !== 'transit-vehicle-model-3d'), layerToggles.transit);
    setVisibility(['transit-vehicle-model-3d'], layerToggles.transitModels);
    setVisibility([...TRAFFIC_CAMERA_LAYER_IDS], layerToggles.trafficCameras);
    setVisibility(building3dLayerIds, layerToggles.buildings);
    setVisibility([buildingTransitionFootprintLayerId], layerToggles.buildings);
    setVisibility([building2dLayerId], !layerToggles.buildings);
    setVisibility(buildingShadowLayerIds, layerToggles.buildings);
    treeLayerRef.current?.setShadowsEnabled(layerToggles.trees);
    setVisibility(cyclingLayerIds, layerToggles.cycling);
    setVisibility(hikingLayerIds, layerToggles.hiking);
    transitRouteOverlayRef.current?.setVisibility(layerToggles.transitLines);
    if (layerToggles.transitLines) void transitRouteOverlayRef.current?.update(map.getBounds(), map.getZoom());
    setVisibility(waterEffectLayerIds, true);
    map.setProjection({ type: layerToggles.globe ? 'globe' : 'mercator' });
    terrainEnabledRef.current = layerToggles.terrain;
    map.setTerrain(layerToggles.terrain ? { source: terrainSourceRef.current, exaggeration: 1.0 } : null);
    if (map.getLayer('terrain-hillshade')) {
      map.setLayoutProperty('terrain-hillshade', 'visibility', layerToggles.terrain && terrainSourceRef.current === 'terrain' ? 'visible' : 'none');
    }
    map.triggerRepaint();
    treeRefreshRef.current?.();
    if (!layerToggles.transit) onTransitDisabled();
    if (!layerToggles.trafficCameras) onTrafficCamerasDisabled();
  }, [mapLoaded, layerToggles, building2dLayerId, building3dLayerIds, buildingShadowLayerIds, buildingTransitionFootprintLayerId, cyclingLayerIds, hikingLayerIds, flightActive, flightActiveRef, mapRef, onTrafficCamerasDisabled, onTransitDisabled, terrainEnabledRef, terrainSourceRef, treeLayerRef, treeRefreshRef, transitRouteOverlayRef, waterEffectLayerIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    treeLayerRef.current?.setTheme(resolvedTheme === 'dark');
    transitVehicleLayerRef.current?.setTheme(resolvedTheme === 'dark');
    if (flightActive || flightActiveRef.current) return;
    applyMapTheme(map, resolvedTheme);
    map.triggerRepaint();
  }, [flightActive, flightActiveRef, mapLoaded, mapRef, resolvedTheme, transitVehicleLayerRef, treeLayerRef]);
}
