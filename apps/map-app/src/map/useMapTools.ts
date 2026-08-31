import { useEffect, useRef, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import { isMeaningfullyBetterLocation, locationZoomForAccuracy, markerFeatureCollection, normalizedLocationAccuracy } from './LocationMarkers';

type Coordinate = [number, number];

type MapToolsOptions = {
  mapRef: RefObject<Map | null>;
  showNotice: (message: string, duration?: number | null) => void;
  pauseRouteVehicle: () => void;
  resumeRouteVehicle: (map: Map, coordinates: Coordinate) => void;
};

export function useMapTools({
  mapRef, showNotice, pauseRouteVehicle, resumeRouteVehicle,
}: MapToolsOptions) {
  const userLocationRef = useRef<Coordinate | null>(null);
  const userLocationAccuracyRef = useRef(Number.POSITIVE_INFINITY);
  const userLocationTimestampRef = useRef(0);
  const userLocationWatchRef = useRef<number | null>(null);
  const locateFocusRef = useRef<((coords: GeolocationCoordinates) => void) | null>(null);
  const locateFocusTimerRef = useRef<number | undefined>(undefined);
  const locateUser = () => {
    if (!navigator.geolocation) {
      showNotice('Location is not available in this browser.');
      return;
    }
    showNotice('Finding your location...', null);
    const updateUserLocation = ({ coords, timestamp }: GeolocationPosition) => {
      if (timestamp < userLocationTimestampRef.current) return;
      const map = mapRef.current;
      const coordinates: Coordinate = [coords.longitude, coords.latitude];
      userLocationRef.current = coordinates;
      userLocationAccuracyRef.current = coords.accuracy;
      userLocationTimestampRef.current = timestamp;
      (map?.getSource('user-location') as { setData: (data: unknown) => void } | undefined)?.setData(markerFeatureCollection(coordinates, 'gps'));
      locateFocusRef.current?.(coords);
    };
    const focusState = { centered: false, bestAccuracy: Number.POSITIVE_INFINITY };
    const focusCoordinates = (coordinates: Coordinate, accuracy: number) => {
      const map = mapRef.current;
      if (!map) return;
      const effectiveAccuracy = normalizedLocationAccuracy(accuracy);
      if (focusState.centered && !isMeaningfullyBetterLocation(focusState.bestAccuracy, effectiveAccuracy)) return;
      const refining = focusState.centered;
      focusState.centered = true;
      focusState.bestAccuracy = effectiveAccuracy;
      map.flyTo({ center: coordinates, zoom: Math.max(map.getZoom(), locationZoomForAccuracy(effectiveAccuracy)), duration: refining ? 450 : 650 });
      showNotice(effectiveAccuracy <= 100 ? 'Location found' : 'Approximate location found');
      if (effectiveAccuracy <= 50) locateFocusRef.current = null;
    };
    const focusFromCoordinates = (coords: GeolocationCoordinates) => focusCoordinates([coords.longitude, coords.latitude], coords.accuracy);
    locateFocusRef.current = focusFromCoordinates;
    if (locateFocusTimerRef.current !== undefined) window.clearTimeout(locateFocusTimerRef.current);
    locateFocusTimerRef.current = window.setTimeout(() => {
      if (locateFocusRef.current === focusFromCoordinates) locateFocusRef.current = null;
      locateFocusTimerRef.current = undefined;
    }, 12_000);
    if (userLocationRef.current) focusCoordinates(userLocationRef.current, userLocationAccuracyRef.current);
    if (userLocationWatchRef.current === null) {
      userLocationWatchRef.current = navigator.geolocation.watchPosition(updateUserLocation, (error) => {
        if (error.code === error.PERMISSION_DENIED && locateFocusRef.current) {
          locateFocusRef.current = null;
          showNotice('Unable to access your location.');
        }
      }, { enableHighAccuracy: true, maximumAge: 120_000, timeout: 15_000 });
    }
    navigator.geolocation.getCurrentPosition(updateUserLocation, (fastError) => {
      if (fastError.code === fastError.PERMISSION_DENIED) {
        locateFocusRef.current = null;
        showNotice('Unable to access your location.');
        return;
      }
      if (focusState.centered) return;
      navigator.geolocation.getCurrentPosition(updateUserLocation, () => {
        if (!focusState.centered) {
          locateFocusRef.current = null;
          showNotice('Unable to access your location.');
        }
      }, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 });
    }, { enableHighAccuracy: false, maximumAge: 120_000, timeout: 1_500 });
  };

  const resetMapOrientation = () => {
    pauseRouteVehicle();
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 600 });
  };
  const zoomIn = () => { pauseRouteVehicle(); mapRef.current?.zoomIn({ duration: 250 }); };
  const zoomOut = () => { pauseRouteVehicle(); mapRef.current?.zoomOut({ duration: 250 }); };

  useEffect(() => () => {
    if (userLocationWatchRef.current !== null) navigator.geolocation.clearWatch(userLocationWatchRef.current);
    if (locateFocusTimerRef.current !== undefined) window.clearTimeout(locateFocusTimerRef.current);
  }, []);

  return {
    userLocationRef, userLocationAccuracyRef, userLocationTimestampRef, userLocationWatchRef,
    locateFocusRef, locateFocusTimerRef,
    locateUser, resetMapOrientation, zoomIn, zoomOut,
  };
}
