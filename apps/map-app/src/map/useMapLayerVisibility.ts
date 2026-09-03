import { useEffect, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import type { TreeModelLayer } from './TreeModelLayer';
import type { TransitRouteOverlay } from './TransitRouteOverlay';
import type { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import type { MapLayerState } from './MapControls';
import { applyMapTheme } from './GlobalMapStyle';

type LayerRefs = {
  treeLayerRef: RefObject<TreeModelLayer | null>;
  transitRouteOverlayRef: RefObject<TransitRouteOverlay | null>;
  transitVehicleLayerRef: RefObject<TransitVehicleModelLayer | null>;
  treeRefreshRef: RefObject<(() => void) | null>;
  terrainSourceRef: RefObject<string>;
  terrainEnabledRef: RefObject<boolean>;
  flightActiveRef: RefObject<boolean>;
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
  terrainSourceRef, terrainEnabledRef, flightActiveRef, building3dLayerIds, buildingShadowLayerIds,
  buildingTransitionFootprintLayerId, building2dLayerId, cyclingLayerIds,
  hikingLayerIds, waterEffectLayerIds, onTransitDisabled,
}: MapLayerVisibilityOptions) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const setVisibility = (layerIds: string[], visible: boolean) => setMapLayerVisibility(map, layerIds, visible);
    setVisibility(['tree-models-3d', 'tree-points'], layerToggles.trees);
    setVisibility((map.getStyle().layers ?? []).map((layer) => layer.id)
      .filter((layerId) => layerId.startsWith('transit-') && layerId !== 'transit-vehicle-model-3d'), layerToggles.transit);
    setVisibility(['transit-vehicle-model-3d'], layerToggles.transitModels);
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
    // Flight mode owns terrain/projection for the duration of the flight;
    // re-asserting the saved preference here would fight its own setTerrain
    // call every time this effect re-runs (e.g. from an unrelated toggle).
    if (!flightActiveRef.current) {
      map.setProjection({ type: layerToggles.globe ? 'globe' : 'mercator' });
      terrainEnabledRef.current = layerToggles.terrain;
      map.setTerrain(layerToggles.terrain ? { source: terrainSourceRef.current, exaggeration: 1.0 } : null);
      if (map.getLayer('terrain-hillshade')) {
        map.setLayoutProperty('terrain-hillshade', 'visibility', layerToggles.terrain && terrainSourceRef.current === 'terrain' ? 'visible' : 'none');
      }
    }
    map.triggerRepaint();
    treeRefreshRef.current?.();
    if (!layerToggles.transit) onTransitDisabled();
  }, [mapLoaded, layerToggles, building2dLayerId, building3dLayerIds, buildingShadowLayerIds, buildingTransitionFootprintLayerId, cyclingLayerIds, hikingLayerIds, flightActiveRef, mapRef, onTransitDisabled, terrainEnabledRef, terrainSourceRef, treeLayerRef, treeRefreshRef, transitRouteOverlayRef, waterEffectLayerIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    treeLayerRef.current?.setTheme(resolvedTheme === 'dark');
    transitVehicleLayerRef.current?.setTheme(resolvedTheme === 'dark');
    applyMapTheme(map, resolvedTheme);
    map.triggerRepaint();
  }, [mapLoaded, mapRef, resolvedTheme, transitVehicleLayerRef, treeLayerRef]);
}
