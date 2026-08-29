import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

export type SheetSnap = 'collapsed' | 'half' | 'expanded';
const SNAP_ORDER: SheetSnap[] = ['collapsed', 'half', 'expanded'];

export function mobileSheetSnapHeights(viewportHeight: number) {
  const available = Math.max(120, viewportHeight);
  return {
    collapsed: Math.min(104, available),
    half: Math.round(Math.max(104, available * 0.52)),
    expanded: Math.round(Math.max(104, available - 12)),
  };
}

export function destinationSheetSnap(height: number, velocityY: number, viewportHeight: number): SheetSnap {
  const heights = mobileSheetSnapHeights(viewportHeight);
  const projected = height - velocityY * 180;
  return SNAP_ORDER.reduce((best, snap) => (
    Math.abs(heights[snap] - projected) < Math.abs(heights[best] - projected) ? snap : best
  ), 'collapsed' as SheetSnap);
}

export function useMobileBottomSheet(initialSnap: SheetSnap = 'half', onHeightChange?: () => void) {
  const [snap, setSnapState] = useState<SheetSnap>(initialSnap);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number; lastY: number; lastTime: number; velocityY: number } | null>(null);
  const viewportHeight = () => window.visualViewport?.height ?? window.innerHeight;
  const heightFor = useCallback((value: SheetSnap) => mobileSheetSnapHeights(viewportHeight())[value], []);

  const setSnap = useCallback((value: SheetSnap) => {
    setDragHeight(null);
    setSnapState(value);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resized = () => { setDragHeight(null); onHeightChange?.(); };
    window.addEventListener('resize', resized);
    viewport?.addEventListener('resize', resized);
    return () => {
      window.removeEventListener('resize', resized);
      viewport?.removeEventListener('resize', resized);
    };
  }, [onHeightChange]);

  useEffect(() => { onHeightChange?.(); }, [dragHeight, onHeightChange, snap]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (window.innerWidth > 760 || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    const startHeight = dragHeight ?? heightFor(snap);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight, lastY: event.clientY, lastTime: event.timeStamp, velocityY: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragHeight(startHeight);
    event.preventDefault();
    event.stopPropagation();
  }, [dragHeight, heightFor, snap]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const elapsed = Math.max(1, event.timeStamp - state.lastTime);
    state.velocityY = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    const heights = mobileSheetSnapHeights(viewportHeight());
    setDragHeight(Math.min(heights.expanded, Math.max(heights.collapsed, state.startHeight - (event.clientY - state.startY))));
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    const height = dragHeight ?? state.startHeight;
    setSnap(destinationSheetSnap(height, state.velocityY, viewportHeight()));
    setDragHeight(null);
    event.stopPropagation();
  }, [dragHeight]);

  const cycle = useCallback(() => setSnap(snap === 'collapsed' ? 'half' : snap === 'half' ? 'expanded' : 'collapsed'), [setSnap, snap]);
  const style = { '--mobile-sheet-height': `${dragHeight ?? heightFor(snap)}px` } as CSSProperties;
  return {
    snap,
    setSnap,
    style,
    dragging: dragHeight !== null,
    handleProps: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onDoubleClick: cycle },
  };
}
