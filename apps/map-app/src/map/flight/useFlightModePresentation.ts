import { useEffect, type RefObject } from 'react';
import type { Map as MaplibreMap, StyleLayer } from 'maplibre-gl';
import type { TransitRouteOverlay } from '../TransitRouteOverlay';
import { runIndependentRestoreSteps } from './flightCleanup';

const APPLICATION_OVERLAY_PREFIXES = [
  'context-menu-location',
  'distance-measurement',
  'favorite-',
  'nearby-result',
  'route-endpoint',
  'search-result',
  'selected-location',
  'selected-route',
  'user-location',
];

type FlightTransitOverlay = Pick<TransitRouteOverlay, 'setVisibility' | 'update'>;

export function restoreTransitOverlay(
  overlay: FlightTransitOverlay | null,
  map: Pick<MaplibreMap, 'getBounds' | 'getZoom'>,
  visible: boolean,
) {
  overlay?.setVisibility(visible);
  if (visible) void overlay?.update(map.getBounds(), map.getZoom());
}

type FlightPresentationMap = Pick<
  MaplibreMap,
  'getLayer' | 'setLayoutProperty' | 'triggerRepaint' | 'getBounds' | 'getZoom'
>;

export function restoreFlightPresentation(
  map: FlightPresentationMap,
  visibility: Map<string, boolean>,
  overlay: FlightTransitOverlay | null,
  transitLinesVisible: boolean,
) {
  runIndependentRestoreSteps([
    ...[...visibility].map(([layerId, visible]) => ({
      label: `layer ${layerId}`,
      run: () => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
      },
    })),
    {
      label: 'transit overlay',
      run: () => restoreTransitOverlay(overlay, map, transitLinesVisible),
    },
    { label: 'repaint', run: () => map.triggerRepaint() },
  ]);
}

export function shouldHideLayerInFlight(layer: Pick<StyleLayer, 'id' | 'type'>) {
  if (layer.id === 'flight-aircraft-model-3d') return false;
  if (layer.id.startsWith('transit-')) return true;
  if (APPLICATION_OVERLAY_PREFIXES.some((prefix) => layer.id.startsWith(prefix))) return true;
  return layer.type === 'symbol'
    && (layer.id.includes('poi') || layer.id.includes('transit'));
}

export function useFlightModePresentation({
  mapRef,
  mapLoaded,
  active,
  transitRouteOverlayRef,
  transitLinesVisible,
}: {
  mapRef: RefObject<MaplibreMap | null>;
  mapLoaded: boolean;
  active: boolean;
  transitRouteOverlayRef: RefObject<TransitRouteOverlay | null>;
  transitLinesVisible: boolean;
}) {
  useEffect(() => {
    const map = mapRef.current;
    if (!active || !mapLoaded || !map) return;
    const layers = (map.getStyle().layers ?? []).filter(shouldHideLayerInFlight);
    const visibility = new Map<string, boolean>();
    layers.forEach((layer) => {
      visibility.set(layer.id, map.getLayoutProperty(layer.id, 'visibility') !== 'none');
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    });
    transitRouteOverlayRef.current?.setVisibility(false);
    map.triggerRepaint();

    return () => {
      restoreFlightPresentation(
        map,
        visibility,
        transitRouteOverlayRef.current,
        transitLinesVisible,
      );
    };
  }, [active, mapLoaded, mapRef, transitLinesVisible, transitRouteOverlayRef]);
}
