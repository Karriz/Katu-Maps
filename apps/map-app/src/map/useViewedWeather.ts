import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';
import {
  closestHourIndex,
  fetchForecastGrid,
  fetchViewedWeather,
  fetchWeatherPlaceName,
  forecastBoundsUsable,
  isWeatherAbortError,
  overlayBoundsForView,
  viewedWeatherCacheKey,
  weatherPlaceCandidateFromFeature,
  weatherPlaceName,
  weatherZoomUsable,
  type ForecastGrid,
  type ViewedWeather,
  type WeatherOverlayVariable,
} from './Weather';
import { WeatherForecastLayer } from './WeatherForecastLayer';

const POINT_DEBOUNCE_MS = 1_000;
const GRID_DEBOUNCE_MS = 1_200;

function currentMapBounds(map: Map) {
  const bounds = map.getBounds();
  const center = map.getCenter();
  return overlayBoundsForView(
    { lng: center.lng, lat: center.lat },
    {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
  );
}

function mapWeatherPlaceName(map: Map) {
  if (!map.getSource(OPENFREEMAP_SOURCE_ID)) return undefined;
  try {
    const center = map.getCenter();
    const candidates = map.querySourceFeatures(OPENFREEMAP_SOURCE_ID, { sourceLayer: 'place' })
      .flatMap((feature) => {
        const candidate = weatherPlaceCandidateFromFeature(feature);
        return candidate ? [candidate] : [];
      });
    return weatherPlaceName(candidates, [center.lng, center.lat]);
  } catch {
    return undefined;
  }
}

export function useViewedWeather({
  mapRef,
  mapLoaded,
  enabled,
  flightActive,
}: {
  mapRef: RefObject<Map | null>;
  mapLoaded: boolean;
  enabled: boolean;
  flightActive: boolean;
}) {
  const overlayLayerRef = useRef<WeatherForecastLayer | null>(null);
  const [weather, setWeather] = useState<ViewedWeather | null>(null);
  const [placeName, setPlaceName] = useState<string | undefined>(undefined);
  const [viewUsable, setViewUsable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayVariable, setOverlayVariable] = useState<WeatherOverlayVariable>('cloud');
  const [overlayGrid, setOverlayGrid] = useState<ForecastGrid | null>(null);
  const [overlayTime, setOverlayTime] = useState<string | undefined>(undefined);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [overlayUnavailable, setOverlayUnavailable] = useState(false);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const requestedPointKeyRef = useRef<string | null>(null);
  const requestedGridKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const layer = new WeatherForecastLayer();
    layer.install(map);
    overlayLayerRef.current = layer;
    return () => {
      layer.dispose();
      overlayLayerRef.current = null;
    };
  }, [mapLoaded, mapRef]);

  useEffect(() => {
    overlayLayerRef.current?.setForecast(
      overlayOpen ? overlayGrid : null,
      overlayTime,
      overlayVariable,
    );
  }, [overlayGrid, overlayOpen, overlayTime, overlayVariable]);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    setOverlayUnavailable(false);
    overlayLayerRef.current?.clear();
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const closeWeatherUi = useCallback(() => {
    closePanel();
    closeOverlay();
  }, [closeOverlay, closePanel]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
  }, []);

  const openOverlay = useCallback((variable: WeatherOverlayVariable) => {
    setOverlayVariable(variable);
    setOverlayOpen(true);
    if (window.innerWidth <= 760) setPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!enabled) closeWeatherUi();
  }, [closeWeatherUi, enabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!enabled || !mapLoaded || flightActive || !map) {
      setViewUsable(false);
      return;
    }
    let timer: number | undefined;
    let controller = new AbortController();
    let cancelled = false;

    const applyViewUsable = () => {
      const usable = weatherZoomUsable(map.getZoom());
      setViewUsable(usable);
      if (!usable) {
        setPanelOpen(false);
        setOverlayOpen(false);
        setOverlayUnavailable(false);
        overlayLayerRef.current?.clear();
        setLoading(false);
      }
      return usable;
    };

    const load = () => {
      if (!applyViewUsable()) return;
      const center = map.getCenter();
      const key = viewedWeatherCacheKey(center.lng, center.lat);
      if (key === requestedPointKeyRef.current && weatherRef.current) return;
      requestedPointKeyRef.current = key;
      controller.abort();
      controller = new AbortController();
      if (!weatherRef.current) setLoading(true);
      void fetchViewedWeather(center.lng, center.lat, controller.signal)
        .then((next) => {
          if (cancelled) return;
          setWeather(next);
          setUnavailable(false);
        })
        .catch((error: unknown) => {
          if (cancelled || isWeatherAbortError(error)) return;
          requestedPointKeyRef.current = null;
          setUnavailable(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    const schedule = () => {
      if (!applyViewUsable()) {
        if (timer !== undefined) window.clearTimeout(timer);
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(load, POINT_DEBOUNCE_MS);
    };

    applyViewUsable();
    load();
    map.on('zoom', applyViewUsable);
    map.on('moveend', schedule);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller.abort();
      map.off('zoom', applyViewUsable);
      map.off('moveend', schedule);
    };
  }, [enabled, flightActive, mapLoaded, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!enabled || !mapLoaded || flightActive || !panelOpen || !viewUsable || !map) return;
    let cancelled = false;
    const controller = new AbortController();
    const coordinates = weatherRef.current?.coordinates;
    const lng = coordinates?.[0] ?? map.getCenter().lng;
    const lat = coordinates?.[1] ?? map.getCenter().lat;
    const fromMap = mapWeatherPlaceName(map);
    if (fromMap) setPlaceName(fromMap);

    void fetchWeatherPlaceName(lng, lat, controller.signal)
      .then((name) => {
        if (!cancelled && name) setPlaceName(name);
      })
      .catch((error: unknown) => {
        if (cancelled || isWeatherAbortError(error)) return;
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, flightActive, mapLoaded, mapRef, panelOpen, viewUsable, weather?.coordinates[0], weather?.coordinates[1]]);

  useEffect(() => {
    const map = mapRef.current;
    if (!enabled || !mapLoaded || flightActive || !overlayOpen || !map) {
      if (!overlayOpen) {
        setOverlayLoading(false);
        setOverlayUnavailable(false);
      }
      return;
    }
    let timer: number | undefined;
    let controller = new AbortController();
    let cancelled = false;

    const load = () => {
      if (!weatherZoomUsable(map.getZoom())) {
        setOverlayGrid(null);
        setOverlayUnavailable(true);
        setOverlayLoading(false);
        overlayLayerRef.current?.clear();
        return;
      }
      const bounds = currentMapBounds(map);
      if (!forecastBoundsUsable(bounds)) {
        setOverlayGrid(null);
        setOverlayUnavailable(true);
        setOverlayLoading(false);
        overlayLayerRef.current?.clear();
        return;
      }
      const key = [bounds.west, bounds.south, bounds.east, bounds.north]
        .map((value) => value.toFixed(2))
        .join(':');
      if (key === requestedGridKeyRef.current) return;
      requestedGridKeyRef.current = key;
      controller.abort();
      controller = new AbortController();
      setOverlayLoading(true);
      void fetchForecastGrid(bounds, 5, 5, controller.signal)
        .then((grid) => {
          if (cancelled) return;
          setOverlayGrid(grid);
          setOverlayUnavailable(false);
          setOverlayTime((current) => (
            current && grid.times.includes(current) ? current : grid.times[closestHourIndex(grid.times)]
          ));
        })
        .catch((error: unknown) => {
          if (cancelled || isWeatherAbortError(error)) return;
          requestedGridKeyRef.current = null;
          setOverlayUnavailable(true);
        })
        .finally(() => {
          if (!cancelled) setOverlayLoading(false);
        });
    };

    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(load, GRID_DEBOUNCE_MS);
    };

    load();
    map.on('moveend', schedule);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller.abort();
      map.off('moveend', schedule);
    };
  }, [enabled, flightActive, mapLoaded, mapRef, overlayOpen]);

  return {
    weather,
    placeName,
    viewUsable,
    loading,
    unavailable,
    panelOpen,
    overlayOpen,
    overlayVariable,
    overlayGrid,
    overlayTime,
    overlayLoading,
    overlayUnavailable,
    openPanel,
    closePanel,
    closeWeatherUi,
    openOverlay,
    closeOverlay,
    setOverlayVariable,
    setOverlayTime,
  };
}
