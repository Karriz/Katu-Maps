import type { MutableRefObject, RefObject } from 'react';
import type { TransitStopsLayer, TransitStopSelection } from './TransitStopsLayer';
import type { PositionInformationState } from './useInfoPanelState';
import type { RouteResult } from './ValhallaRouting';
import type { TrafficCameraSelection } from './TrafficCameras';
import type { TrafficCamerasLayer } from './TrafficCamerasLayer';

type PanelCoordinatorOptions = {
  routeVehicleViewRef: RefObject<boolean>;
  routeResultRef: RefObject<RouteResult | null>;
  vehicleFollowEnabledRef: MutableRefObject<boolean>;
  vehicleFollowingRef: MutableRefObject<boolean>;
  setVehicleFollowing: (following: boolean) => void;
  setVehicleFollowAvailable: (available: boolean) => void;
  transitStopsLayerRef: RefObject<TransitStopsLayer | null>;
  setContextMenuMarker: (marker: [number, number] | null) => void;
  closePositionInformation: () => void;
  setPositionInformation: (information: PositionInformationState | null) => void;
  clearLocationSelection: () => void;
  setSelectedTransitStop: (stop: (TransitStopSelection & { favoriteId?: string }) | null) => void;
  trafficCamerasLayerRef: RefObject<TrafficCamerasLayer | null>;
  setSelectedTrafficCamera: (camera: TrafficCameraSelection | null) => void;
  cancelRoute: () => void;
  rememberRouteVehicle: (result: RouteResult, following: boolean) => void;
};

export function shouldPreserveRouteVehicleForInfoPanel(viewportWidth: number, routeVisible: boolean) {
  return viewportWidth > 760 && routeVisible;
}

export function usePanelCoordinator({
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
  cancelRoute,
  rememberRouteVehicle,
}: PanelCoordinatorOptions) {
  function prepareInfoPanelOpen() {
    closePositionInformation();
    setContextMenuMarker(null);
    trafficCamerasLayerRef.current?.clearSelection();
    setSelectedTrafficCamera(null);
    if (window.innerWidth <= 760) cancelRoute();
  }

  function preserveRouteVehicleForInfoPanel() {
    return shouldPreserveRouteVehicleForInfoPanel(window.innerWidth, routeVehicleViewRef.current);
  }

  function selectTransitStopForInfoPanel(stop: TransitStopSelection & { favoriteId?: string }) {
    closePositionInformation();
    setContextMenuMarker(null);
    if (preserveRouteVehicleForInfoPanel()) {
      if (routeResultRef.current) {
        // The selected stop gets its own vehicle context, but the planner's
        // selected route remains available for restoration when it closes.
        rememberRouteVehicle(routeResultRef.current, vehicleFollowingRef.current);
        transitStopsLayerRef.current?.selectSearchStopPreservingTrip(stop);
      }
    } else {
      transitStopsLayerRef.current?.selectSearchStop(stop);
    }
  }

  function clearTransitInfoSelection() {
    if (preserveRouteVehicleForInfoPanel()) transitStopsLayerRef.current?.clearStopSelection();
    else transitStopsLayerRef.current?.clearSelection();
  }

  function openPositionInformation(information: PositionInformationState) {
    prepareInfoPanelOpen();
    setContextMenuMarker(information.coordinates);
    if (!routeVehicleViewRef.current) {
      vehicleFollowEnabledRef.current = false;
      setVehicleFollowing(false);
      setVehicleFollowAvailable(false);
    }
    if (routeVehicleViewRef.current) transitStopsLayerRef.current?.clearStopSelection();
    else transitStopsLayerRef.current?.clearSelection();
    setSelectedTransitStop(null);
    clearLocationSelection();
    setPositionInformation(information);
  }

  return {
    prepareInfoPanelOpen,
    preserveRouteVehicleForInfoPanel,
    selectTransitStopForInfoPanel,
    clearTransitInfoSelection,
    openPositionInformation,
  };
}
