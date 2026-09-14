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
  let longPressTimer: number | undefined;
  let longPressStart: { x: number; y: number } | undefined;
  const activeLongPressPointers = new Set<number>();
  let multiPointerGestureActive = false;
  let lastTouchOrPenInteractionAt = 0;
  let cursorHandlersInstalled = false;

  const supportsLongPress = (event: PointerEvent) => event.pointerType === 'touch' || event.pointerType === 'pen';
  const cancelLongPressTimer = () => {
    if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
    longPressStart = undefined;
  };
  const handleMapClick = (event: MapMouseEvent) => options.onMapClick(event);
  const handleMapContextMenu = (event: MapMouseEvent) => {
    event.originalEvent.preventDefault();
    if (options.isBlocked() || options.isMeasurementActive()) return;
    if (('pointerType' in event.originalEvent
        && (event.originalEvent.pointerType === 'touch' || event.originalEvent.pointerType === 'pen'))
      || Date.now() - lastTouchOrPenInteractionAt < 1000) return;
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
    if (options.isMeasurementActive() || !supportsLongPress(event)) return;
    lastTouchOrPenInteractionAt = Date.now();
    activeLongPressPointers.add(event.pointerId);
    if (activeLongPressPointers.size > 1) {
      multiPointerGestureActive = true;
      cancelLongPressTimer();
      return;
    }
    multiPointerGestureActive = false;
    longPressStart = { x: event.clientX, y: event.clientY };
    longPressTimer = window.setTimeout(() => {
      if (multiPointerGestureActive || activeLongPressPointers.size !== 1) {
        cancelLongPressTimer();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const point = new Point(event.clientX - rect.left, event.clientY - rect.top);
      const lngLat = map.unproject(point);
      options.onContextMenu(point, [lngLat.lng, lngLat.lat]);
      longPressTimer = undefined;
    }, 600);
  };
  const handleWheel = () => {
    if (options.isBlocked()) return;
    cancelLongPressTimer();
    options.onUserInteraction();
  };
  const handlePointerEnd = (event: PointerEvent) => {
    if (supportsLongPress(event) && event.type === 'pointermove' && activeLongPressPointers.size > 1) {
      multiPointerGestureActive = true;
      cancelLongPressTimer();
    } else if (longPressStart && Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 12) {
      cancelLongPressTimer();
    }
    if (event.type !== 'pointermove') {
      if (supportsLongPress(event)) activeLongPressPointers.delete(event.pointerId);
      if (activeLongPressPointers.size === 0) {
        multiPointerGestureActive = false;
        cancelLongPressTimer();
      }
    }
  };
  const handleGestureStart = () => {
    if (options.isBlocked()) return;
    cancelLongPressTimer();
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
  canvas.addEventListener('pointermove', handlePointerEnd);
  canvas.addEventListener('pointerup', handlePointerEnd);
  canvas.addEventListener('pointercancel', handlePointerEnd);

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
      cancelLongPressTimer();
      map.off('click', handleMapClick);
      map.off('contextmenu', handleMapContextMenu);
      map.off('zoomstart', handleGestureStart);
      map.off('dragstart', handleGestureStart);
      canvas.removeEventListener('mousedown', handleBeforePan, true);
      canvas.removeEventListener('touchstart', handleBeforePan, true);
      canvas.removeEventListener('keydown', handleMapKeyDown);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointermove', handlePointerEnd);
      canvas.removeEventListener('pointerup', handlePointerEnd);
      canvas.removeEventListener('pointercancel', handlePointerEnd);
      if (cursorHandlersInstalled) CURSOR_LAYER_IDS.forEach((layerId) => {
        if (!map.getLayer(layerId)) return;
        map.off('mouseenter', layerId, showPointerCursor);
        map.off('mouseleave', layerId, clearPointerCursor);
      });
      clearPointerCursor();
    },
  };
}
