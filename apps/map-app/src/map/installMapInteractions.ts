import { Point, type Map, type MapMouseEvent } from 'maplibre-gl';

type MapInteractionOptions = {
  isBlocked: () => boolean;
  isMeasurementActive: () => boolean;
  onMapClick: (event: { point: Point }) => void;
  onContextMenu: (point: Point, coordinates: [number, number]) => void;
  onUserInteraction: () => void;
  onGestureStart: () => void;
  onBeforePan: () => void;
};

const CURSOR_LAYER_IDS = ['location-poi-icons', 'location-poi-labels', 'global-hiking-pois'];

export function installMapInteractions(map: Map, options: MapInteractionOptions) {
  const canvas = map.getCanvas();
  let cursorHandlersInstalled = false;

  const handleMapClick = (event: MapMouseEvent) => options.onMapClick(event);
  // MapLibre fires `contextmenu` both for right clicks and for a touch
  // long press, so one handler covers mouse, pen and keyboard paths.
  const handleMapContextMenu = (event: MapMouseEvent) => {
    event.originalEvent.preventDefault();
    if (options.isBlocked() || options.isMeasurementActive()) return;
    options.onContextMenu(event.point, [event.lngLat.lng, event.lngLat.lat]);
  };
  const handleMapKeyDown = (event: KeyboardEvent) => {
    if (options.isBlocked() || event.altKey || event.ctrlKey || event.metaKey || event.target !== canvas) return;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100],
    };
    if (pan[event.key]) {
      event.preventDefault();
      map.panBy(pan[event.key], { duration: 180 });
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      map.zoomIn({ duration: 180 });
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      map.zoomOut({ duration: 180 });
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const point = new Point(canvas.clientWidth / 2, canvas.clientHeight / 2);
      const center = map.getCenter();
      options.onContextMenu(point, [center.lng, center.lat]);
    }
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (options.isBlocked()) return;
    options.onUserInteraction();
  };
  const handleWheel = () => {
    if (options.isBlocked()) return;
    options.onUserInteraction();
  };
  const handleGestureStart = () => {
    if (options.isBlocked()) return;
    options.onGestureStart();
  };
  const handleBeforePan = () => {
    if (!options.isBlocked()) options.onBeforePan();
  };
  const showPointerCursor = () => { canvas.style.cursor = 'pointer'; };
  const clearPointerCursor = () => { canvas.style.cursor = ''; };

  map.on('click', handleMapClick);
  map.on('contextmenu', handleMapContextMenu);
  map.on('zoomstart', handleGestureStart);
  map.on('dragstart', handleGestureStart);
  canvas.setAttribute('aria-label', 'Interactive map. Use arrow keys to pan, plus or minus to zoom, and Shift+F10 for location actions.');
  canvas.addEventListener('mousedown', handleBeforePan, true);
  canvas.addEventListener('touchstart', handleBeforePan, { capture: true, passive: true });
  canvas.addEventListener('keydown', handleMapKeyDown);
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('wheel', handleWheel, { passive: true });

  return {
    installLayerCursors() {
      if (cursorHandlersInstalled) return;
      cursorHandlersInstalled = true;
      CURSOR_LAYER_IDS.forEach((layerId) => {
        if (!map.getLayer(layerId)) return;
        map.on('mouseenter', layerId, showPointerCursor);
        map.on('mouseleave', layerId, clearPointerCursor);
      });
    },
    dispose() {
      map.off('click', handleMapClick);
      map.off('contextmenu', handleMapContextMenu);
      map.off('zoomstart', handleGestureStart);
      map.off('dragstart', handleGestureStart);
      canvas.removeEventListener('mousedown', handleBeforePan, true);
      canvas.removeEventListener('touchstart', handleBeforePan, true);
      canvas.removeEventListener('keydown', handleMapKeyDown);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('wheel', handleWheel);
      if (cursorHandlersInstalled) CURSOR_LAYER_IDS.forEach((layerId) => {
        if (!map.getLayer(layerId)) return;
        map.off('mouseenter', layerId, showPointerCursor);
        map.off('mouseleave', layerId, clearPointerCursor);
      });
      clearPointerCursor();
    },
  };
}
