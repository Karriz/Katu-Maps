import { useCallback, useEffect, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import { coordinateBounds } from './RouteCamera';
import {
  CONTENT_PANEL_SELECTOR,
  panelViewportPadding,
  selectionCameraOffset,
} from './MapViewportLayout';
import { isValidCoordinate, routeCoordinates } from './RoutePresentation';
import type { RouteResult } from './ValhallaRouting';

type CameraSelection = { coordinates: [number, number] } | null;

type MapCameraCoordinatorOptions = {
  mapRef: RefObject<Map | null>;
  mapLoaded: boolean;
  immersiveActive: boolean;
  routeOpen: boolean;
  routeResult: RouteResult | null;
  routeSheetCollapsed: boolean;
  transitDetailsOpen: boolean;
  routeOriginRef: RefObject<[number, number] | null>;
  routeDestinationRef: RefObject<[number, number] | null>;
  routeCameraRequestRef: RefObject<number>;
  pendingSearchCameraRef: RefObject<[number, number] | null>;
  selectionCameraActiveRef: RefObject<boolean>;
  selectedTransitStop: CameraSelection;
  selectedLocation: CameraSelection;
  positionInformation: CameraSelection;
  selectedTrafficCamera: CameraSelection;
  selectedChargingStation: CameraSelection;
  selectedRoadWeather: CameraSelection;
  selectedRoadTraffic: CameraSelection;
  selectedRoadTrafficMessage: CameraSelection;
  setRouteSheetCollapsed: (collapsed: boolean) => void;
};

export function useMapCameraCoordinator({
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
}: MapCameraCoordinatorOptions) {
  const cancelPendingCamera = useCallback(() => {
    routeCameraRequestRef.current += 1;
  }, [routeCameraRequestRef]);

  const fitRouteInView = useCallback((result: RouteResult) => {
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
    const camera = map.cameraForBounds(
      [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
      { padding, maxZoom: 15, pitch: map.getPitch(), bearing: map.getBearing() },
    );
    if (!camera) return;
    map.stop();
    map.easeTo({ ...camera, duration: 900 });
  }, [mapRef, routeDestinationRef, routeOriginRef]);

  const scheduleRouteFit = useCallback((result: RouteResult) => {
    const request = ++routeCameraRequestRef.current;
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
  }, [fitRouteInView, mapRef, routeCameraRequestRef]);

  const fitRouteNow = useCallback((result: RouteResult) => {
    if (window.innerWidth <= 760) setRouteSheetCollapsed(true);
    scheduleRouteFit(result);
  }, [scheduleRouteFit, setRouteSheetCollapsed]);

  useEffect(() => {
    if (!routeOpen || !routeResult) return;
    scheduleRouteFit(routeResult);
  }, [mapLoaded, routeOpen, routeResult, scheduleRouteFit]);

  useEffect(() => cancelPendingCamera, [cancelPendingCamera]);

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
        map.stop();
        selectionCameraActiveRef.current = true;
        map.once('moveend', () => { selectionCameraActiveRef.current = false; });
        const overviewSelection = selectedTrafficCamera || selectedRoadWeather || selectedRoadTrafficMessage;
        map.easeTo({
          center: coordinates,
          zoom: Math.max(map.getZoom(), selectedTransitStop ? 14.6 : overviewSelection ? 12 : selectedRoadTraffic ? 11 : 14),
          offset: selectionCameraOffset(map),
          duration: 900,
        });
      });
    });
    return () => {
      cancelled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [
    mapRef,
    pendingSearchCameraRef,
    positionInformation?.coordinates,
    selectedChargingStation,
    selectedLocation,
    selectedRoadTraffic,
    selectedRoadTrafficMessage,
    selectedRoadWeather,
    selectedTrafficCamera,
    selectedTransitStop,
    selectionCameraActiveRef,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    let frame: number | undefined;
    let recenterTimer: number | undefined;
    let previousRouteLayout: string | undefined;
    const updatePadding = () => {
      frame = undefined;
      if (immersiveActive) return;
      if (routeOpen && routeResult) {
        const padding = panelViewportPadding(map, 48, 24);
        const layout = [
          map.getContainer().clientWidth,
          map.getContainer().clientHeight,
          padding.top, padding.right, padding.bottom, padding.left,
        ].join(':');
        const mobileSheetExpanded = window.innerWidth <= 760 && !routeSheetCollapsed;
        if (!mobileSheetExpanded && previousRouteLayout !== undefined && previousRouteLayout !== layout) {
          scheduleRouteFit(routeResult);
        }
        previousRouteLayout = layout;
        return;
      }

      if (pendingSearchCameraRef.current || selectionCameraActiveRef.current) return;
      const coordinates = selectedTransitStop?.coordinates
        ?? selectedLocation?.coordinates
        ?? positionInformation?.coordinates;
      if (!coordinates) return;
      if (recenterTimer !== undefined) window.clearTimeout(recenterTimer);
      recenterTimer = window.setTimeout(() => {
        if (pendingSearchCameraRef.current || selectionCameraActiveRef.current) return;
        map.easeTo({ center: coordinates, offset: selectionCameraOffset(map), duration: 250 });
      }, 120);
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
  }, [
    immersiveActive,
    mapLoaded,
    mapRef,
    pendingSearchCameraRef,
    positionInformation,
    routeOpen,
    routeResult,
    routeSheetCollapsed,
    scheduleRouteFit,
    selectedLocation,
    selectedTransitStop,
    selectionCameraActiveRef,
    transitDetailsOpen,
  ]);

  return { cancelPendingCamera, fitRouteNow, scheduleRouteFit };
}
