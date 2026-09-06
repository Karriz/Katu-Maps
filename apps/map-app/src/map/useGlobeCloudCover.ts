import { useEffect, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import type { DayNightShadeLayer } from './DayNightShadeLayer';
import { fetchForecastGrid } from './Weather';

/** ~9° global sampling (~861 points) stays under Open-Meteo's 1000-location cap. */
const GLOBE_CLOUD_COLUMNS = 41;
const GLOBE_CLOUD_ROWS = 21;

export function useGlobeCloudCover(
  mapRef: RefObject<Map | null>,
  layerRef: RefObject<DayNightShadeLayer | null>,
  mapLoaded: boolean,
  flightActive: boolean,
  enabled: boolean,
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || flightActive || !enabled) {
      layerRef.current?.setCloudCover(null);
      return;
    }
    const controller = new AbortController();
    let loading = false;
    let nextAttempt = 0;
    let fetchedAt = 0;
    const update = async () => {
      if (controller.signal.aborted || map.getZoom() >= 5.5 || loading || Date.now() < nextAttempt) return;
      loading = true;
      nextAttempt = Date.now() + 5 * 60_000;
      try {
        // Current model coverage, not satellite imagery or invented clouds.
        const grid = await fetchForecastGrid(
          { west: -180, east: 180, south: -90, north: 90 },
          GLOBE_CLOUD_COLUMNS,
          GLOBE_CLOUD_ROWS,
          controller.signal,
          { forecastDays: 1, hourly: 'cloud_cover' },
        );
        if (controller.signal.aborted) return;
        layerRef.current?.setCloudCover(grid);
        fetchedAt = Date.now();
        nextAttempt = fetchedAt + 30 * 60_000;
      } catch {
        // Keep recent coverage through a temporary outage, but never show stale
        // weather indefinitely. The base globe remains usable without clouds.
        if (!controller.signal.aborted && Date.now() - fetchedAt > 60 * 60_000) {
          layerRef.current?.setCloudCover(null);
        }
      } finally {
        loading = false;
      }
    };
    void update();
    map.on('zoomend', update);
    const timer = window.setInterval(() => { void update(); }, 60_000);
    return () => {
      controller.abort();
      map.off('zoomend', update);
      window.clearInterval(timer);
      layerRef.current?.setCloudCover(null);
    };
  }, [mapRef, layerRef, mapLoaded, flightActive, enabled]);
}
