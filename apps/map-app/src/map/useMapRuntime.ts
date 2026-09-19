import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import { parseMapDeepLink, type MapDeepLink } from '../lib/DeepLink';
import { createRuntimeMap } from './MapRuntime';

export type MapRuntimeControls = {
  setLoaded: (loaded: boolean) => void;
  setError: (error: string | null) => void;
  setOrientationChanged: (changed: boolean) => void;
  consumeInitialDeepLink: () => void;
};

type MapRuntimeInitializer = (
  map: Map,
  initialDeepLink: MapDeepLink | null,
  controls: MapRuntimeControls,
) => void | (() => void);

export function useMapRuntime(
  containerRef: RefObject<HTMLDivElement | null>,
  initializeFeatures: MapRuntimeInitializer,
  initialBuildingMode: { buildings: boolean; buildingColors: boolean },
) {
  const mapRef = useRef<Map | null>(null);
  const initializerRef = useRef(initializeFeatures);
  const initialDeepLinkRef = useRef<MapDeepLink | null>(parseMapDeepLink(window.location.search));
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [orientationChanged, setOrientationChanged] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const initialDeepLink = initialDeepLinkRef.current;
    let map: Map;
    try {
      map = createRuntimeMap(container, initialDeepLink, initialBuildingMode);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'The map could not be created.');
      return;
    }

    mapRef.current = map;
    let disposeFeatures: void | (() => void);
    try {
      disposeFeatures = initializerRef.current(map, initialDeepLink, {
        setLoaded: setMapLoaded,
        setError: setMapError,
        setOrientationChanged,
        consumeInitialDeepLink: () => { initialDeepLinkRef.current = null; },
      });
    } catch (error) {
      map.remove();
      mapRef.current = null;
      setMapError(error instanceof Error ? error.message : 'The map could not be initialized.');
      return;
    }

    return () => {
      disposeFeatures?.();
      map.remove();
      mapRef.current = null;
    };
  }, [containerRef]);

  return { mapRef, mapError, mapLoaded, orientationChanged };
}
