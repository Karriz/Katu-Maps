import { useEffect, type RefObject } from 'react';
import type { Map as MaplibreMap, StyleLayer } from 'maplibre-gl';
import type { TransitRouteOverlay } from '../TransitRouteOverlay';
import { runIndependentRestoreSteps } from '../flight/flightCleanup';

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

const OPTIONAL_OVERLAY_PREFIXES = [
  'transit-',
  'traffic-cameras-',
  'charging-stations-',
  'road-weather-',
  'road-traffic-',
  'global-cycling-',
  'global-hiking-',
  'day-night-',
];

type DriveTransitOverlay = Pick<TransitRouteOverlay, 'setVisibility' | 'update'>;

function restoreTransitOverlay(
  overlay: DriveTransitOverlay | null,
  map: Pick<MaplibreMap, 'getBounds' | 'getZoom'>,
  visible: boolean,
) {
  overlay?.setVisibility(visible);
  if (visible) void overlay?.update(map.getBounds(), map.getZoom());
}

function restoreDrivePresentation(
  map: Pick<MaplibreMap, 'getLayer' | 'setLayoutProperty' | 'triggerRepaint' | 'getBounds' | 'getZoom'>,
  visibility: Map<string, boolean>,
  overlay: DriveTransitOverlay | null,
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

export function shouldHideLayerInDrive(layer: Pick<StyleLayer, 'id' | 'type'>) {
  if (layer.id === 'drive-car-model-3d') return false;
  if (OPTIONAL_OVERLAY_PREFIXES.some((prefix) => layer.id.startsWith(prefix))) return true;
  if (APPLICATION_OVERLAY_PREFIXES.some((prefix) => layer.id.startsWith(prefix))) return true;
  return layer.type === 'symbol'
    && (layer.id.includes('poi')
      || layer.id.includes('transit')
      || layer.id.includes('housenumber')
      || layer.id.includes('road-label'));
}

export function useDriveModePresentation({
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
    const layers = (map.getStyle().layers ?? []).filter(shouldHideLayerInDrive);
    const visibility = new Map<string, boolean>();
    layers.forEach((layer) => {
      visibility.set(layer.id, map.getLayoutProperty(layer.id, 'visibility') !== 'none');
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    });
    transitRouteOverlayRef.current?.setVisibility(false);
    map.triggerRepaint();

    return () => {
      restoreDrivePresentation(
        map,
        visibility,
        transitRouteOverlayRef.current,
        transitLinesVisible,
      );
    };
  }, [active, mapLoaded, mapRef, transitLinesVisible, transitRouteOverlayRef]);
}
