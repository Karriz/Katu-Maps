import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import { dayNightAppearance, globeShadeOpacity } from './DayNightAppearance';
import { DayNightShadeLayer, DAY_NIGHT_SHADE_LAYER_ID } from './DayNightShadeLayer';
import { applyDayNightStyle, restoreDayNightStyle } from './DayNightStyle';
import { useGlobeCloudCover } from './useGlobeCloudCover';
import { screenLockedSunDirection, timeZoneAt } from './DayNightSun';
import type { TreeModelLayer } from './TreeModelLayer';
import type { BridgeModelLayer } from './BridgeModelLayer';
import type { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import type { ResolvedTheme } from '../theme';

function firstSymbolLayerId(map: Map) {
  return (map.getStyle().layers ?? []).find((layer) => layer.type === 'symbol')?.id;
}

export function useDayNightCycle({
  mapRef,
  mapLoaded,
  enabled,
  cloudsEnabled,
  utcMs,
  flightActive,
  resolvedTheme,
    treeLayerRef,
    bridgeLayerRef,
    transitVehicleLayerRef,
}: {
  mapRef: RefObject<Map | null>;
  mapLoaded: boolean;
  enabled: boolean;
  cloudsEnabled: boolean;
  utcMs: number;
  flightActive: boolean;
  resolvedTheme: ResolvedTheme;
  treeLayerRef: RefObject<TreeModelLayer | null>;
  bridgeLayerRef: RefObject<BridgeModelLayer | null>;
  transitVehicleLayerRef: RefObject<TransitVehicleModelLayer | null>;
}) {
  const layerRef = useRef<DayNightShadeLayer | null>(null);
  const wasActiveRef = useRef(false);
  const utcMsRef = useRef(utcMs);
  utcMsRef.current = utcMs;
  const applyRef = useRef<() => void>(() => {});
  const [view, setView] = useState(() => ({
    latitude: 61.4981,
    longitude: 23.7609,
    zoom: 2,
    timeZone: 'Europe/Helsinki',
  }));

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (flightActive) {
      if (map.getLayer(DAY_NIGHT_SHADE_LAYER_ID)) {
        map.setLayoutProperty(DAY_NIGHT_SHADE_LAYER_ID, 'visibility', 'none');
      }
      layerRef.current?.setAppearance([1, 0, 0], 0, 0);
      treeLayerRef.current?.setDayNightLighting(null);
      bridgeLayerRef.current?.setDayNightLighting(null);
      transitVehicleLayerRef.current?.setDayNightLighting(null);
      wasActiveRef.current = false;
      applyRef.current = () => {};
      return;
    }
    if (wasActiveRef.current && !enabled) restoreDayNightStyle(map, resolvedTheme);
    wasActiveRef.current = enabled;
    if (!layerRef.current) layerRef.current = new DayNightShadeLayer();
    if (!map.getLayer(DAY_NIGHT_SHADE_LAYER_ID)) {
      const before = firstSymbolLayerId(map);
      if (before) map.addLayer(layerRef.current, before);
      else map.addLayer(layerRef.current);
    } else {
      map.setLayoutProperty(DAY_NIGHT_SHADE_LAYER_ID, 'visibility', 'visible');
    }

    let frame = 0;
    const apply = () => {
      frame = 0;
      const center = map.getCenter();
      const zoom = map.getZoom();
      if (!enabled) {
        // Decorative terminator locked to the screen, not the real sun.
        layerRef.current?.setAppearance(
          screenLockedSunDirection(center.lng, center.lat, map.getBearing()),
          globeShadeOpacity(zoom),
          0,
          true,
          true,
        );
        treeLayerRef.current?.setDayNightLighting(null);
        bridgeLayerRef.current?.setDayNightLighting(null);
        transitVehicleLayerRef.current?.setDayNightLighting(null);
        map.triggerRepaint();
        return;
      }
      const appearance = dayNightAppearance(new Date(utcMsRef.current), center.lat, center.lng, zoom);
      applyDayNightStyle(map, appearance);
      layerRef.current?.setAppearance(appearance.sunDirection, appearance.shadeOpacity, appearance.lightsIntensity);
      treeLayerRef.current?.setDayNightLighting({
        azimuth: appearance.azimuth,
        polar: appearance.polar,
        nightMix: appearance.treeNightMix,
        shadowOffset: appearance.treeShadowOffset,
      });
      bridgeLayerRef.current?.setDayNightLighting({
        azimuth: appearance.azimuth,
        polar: appearance.polar,
        nightMix: appearance.treeNightMix,
        shadowOffset: appearance.treeShadowOffset,
      });
      transitVehicleLayerRef.current?.setDayNightLighting({
        palette: appearance.palette,
        azimuth: appearance.azimuth,
        polar: appearance.polar,
        nightMix: appearance.treeNightMix,
      });
      setView({
        latitude: center.lat,
        longitude: center.lng,
        zoom,
        timeZone: timeZoneAt(center.lat, center.lng),
      });
      map.triggerRepaint();
    };
    applyRef.current = apply;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    apply();
    map.on('move', schedule);
    map.on('zoom', schedule);
    map.on('rotate', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      map.off('move', schedule);
      map.off('zoom', schedule);
      map.off('rotate', schedule);
      applyRef.current = () => {};
    };
  }, [
    enabled, flightActive, mapLoaded, mapRef, resolvedTheme,
    treeLayerRef, bridgeLayerRef, transitVehicleLayerRef,
  ]);

  useGlobeCloudCover(mapRef, layerRef, mapLoaded, flightActive, cloudsEnabled);

  useEffect(() => {
    if (enabled && !flightActive) applyRef.current();
  }, [enabled, flightActive, utcMs]);

  useEffect(() => () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (map && layer && map.getLayer(layer.id)) map.removeLayer(layer.id);
    layerRef.current = null;
  }, [mapRef]);

  const appearance = dayNightAppearance(new Date(utcMs), view.latitude, view.longitude, view.zoom);
  return { appearance, timeZone: view.timeZone, latitude: view.latitude, longitude: view.longitude };
}
