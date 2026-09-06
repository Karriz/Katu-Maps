import { describe, expect, it, vi } from 'vitest';
import {
  clearStaleTerrainGesture,
  installTerrainCameraFollower,
  isTerrainCameraFollowEvent,
  shouldEnableTerrain3d,
  shouldFollowTerrainElevation,
  stepTerrainElevation,
  syncTerrain3d,
  TERRAIN_3D_DISABLE_ZOOM,
  TERRAIN_3D_ENABLE_ZOOM,
  TERRAIN_ELEVATION_FOLLOW_MIN_METERS,
} from './MapTerrain';

describe('terrain 3d zoom gating', () => {
  it('keeps the mesh off at globe through mid-regional zooms', () => {
    expect(shouldEnableTerrain3d(true, 2.2, false)).toBe(false);
    expect(shouldEnableTerrain3d(true, 5.5, false)).toBe(false);
    expect(shouldEnableTerrain3d(true, 8, false)).toBe(false);
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_ENABLE_ZOOM - 0.01, false)).toBe(false);
  });

  it('turns the mesh on once the camera reaches city-region zooms', () => {
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_ENABLE_ZOOM, false)).toBe(true);
    expect(shouldEnableTerrain3d(true, 14, false)).toBe(true);
  });

  it('uses hysteresis so a zoom gesture does not toggle around the cutoff', () => {
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_ENABLE_ZOOM - 0.25, true)).toBe(true);
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_DISABLE_ZOOM, true)).toBe(true);
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_DISABLE_ZOOM - 0.01, true)).toBe(false);
  });

  it('honours the user terrain toggle', () => {
    expect(shouldEnableTerrain3d(false, 16, true)).toBe(false);
  });

  it('does not call setTerrain when the mesh already matches the view', () => {
    const map = {
      getZoom: () => 2.2,
      getTerrain: () => null,
      setTerrain: vi.fn(),
    };
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(false);
    expect(map.setTerrain).not.toHaveBeenCalled();
  });

  it('enables and disables the mesh only when crossing the zoom gate', () => {
    const setTerrain = vi.fn();
    const map = {
      getZoom: () => 14,
      getTerrain: () => null as { source?: string } | null,
      setTerrain,
    };
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(true);
    expect(setTerrain).toHaveBeenCalledWith({ source: 'terrain', exaggeration: 1 });

    map.getTerrain = () => ({ source: 'terrain' });
    setTerrain.mockClear();
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(true);
    expect(setTerrain).not.toHaveBeenCalled();

    map.getZoom = () => 10;
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(false);
    expect(setTerrain).toHaveBeenCalledWith(null);
  });
});

describe('terrain elevation smoothing', () => {
  it('moves exponentially toward the target elevation', () => {
    let elevation = 0;
    for (let i = 0; i < 8; i += 1) {
      elevation = stepTerrainElevation(elevation, 100, 0.05);
    }
    expect(elevation).toBeGreaterThan(50);
    expect(elevation).toBeLessThan(100);
    expect(stepTerrainElevation(elevation, 100, 0.05)).toBeGreaterThan(elevation);
  });

  it('ignores non-finite targets and zero-length frames', () => {
    expect(stepTerrainElevation(40, Number.NaN, 0.016)).toBe(40);
    expect(stepTerrainElevation(40, 80, 0)).toBe(40);
  });

  it('skips follow for small flat-terrain elevation changes', () => {
    expect(shouldFollowTerrainElevation(12, 18)).toBe(false);
    expect(shouldFollowTerrainElevation(12, 12 + TERRAIN_ELEVATION_FOLLOW_MIN_METERS)).toBe(true);
  });

  it('recognizes quiet follow events from the public elevation fallback', () => {
    expect(isTerrainCameraFollowEvent({ terrainCameraFollow: true })).toBe(true);
    expect(isTerrainCameraFollowEvent({ originalEvent: null })).toBe(false);
  });

  it('clears a stale terrain gesture freeze left over from wheel zoom', () => {
    let scrollActive = true;
    const scrollZoom = {
      isActive: vi.fn(() => scrollActive),
      reset: vi.fn(() => { scrollActive = false; }),
    };
    const map = {
      scrollZoom,
      _handlers: {
        _terrainMovement: true,
        _terrainGestureAnchorElevation: 1840 as number | null,
      },
      _camera: {
        elevationFreeze: true,
      },
    };

    expect(clearStaleTerrainGesture(map)).toBe(true);
    expect(map._handlers._terrainMovement).toBe(false);
    expect(map._handlers._terrainGestureAnchorElevation).toBeNull();
    expect(map._camera.elevationFreeze).toBe(false);
    expect(scrollZoom.reset).toHaveBeenCalled();
    expect(clearStaleTerrainGesture(map)).toBe(false);
  });

  it('eases large elevation changes and cancels without snapping', () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    let terrain: { source: string } | null = { source: 'terrain' };
    let elevation = 10;
    let clamped = true;
    let moving = false;
    const frames: FrameRequestCallback[] = [];

    const map = {
      getTerrain: () => terrain,
      getCenter: () => ({ lng: 23.76, lat: 61.5 }),
      getCenterElevation: () => elevation,
      getCenterClampedToGround: () => clamped,
      setCenterClampedToGround: (value: boolean) => { clamped = value; },
      setCenterElevation: (value: number) => { elevation = value; },
      queryTerrainElevation: () => 210,
      isMoving: () => moving,
      triggerRepaint: vi.fn(),
      on: (type: string, listener: (...args: never[]) => void) => {
        const bucket = listeners.get(type) ?? [];
        bucket.push(listener as (...args: unknown[]) => void);
        listeners.set(type, bucket);
      },
      off: (type: string, listener: (...args: never[]) => void) => {
        const bucket = listeners.get(type) ?? [];
        listeners.set(type, bucket.filter((item) => item !== listener));
      },
    };

    const follower = installTerrainCameraFollower(map, {
      requestAnimationFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame: () => {
        frames.length = 0;
      },
    });

    expect(clamped).toBe(false);
    frames.length = 0;

    moving = false;
    elevation = 10;
    listeners.get('moveend')?.forEach((listener) => listener());
    expect(frames).toHaveLength(1);

    frames.shift()?.(16);
    expect(elevation).toBeGreaterThan(10);
    expect(elevation).toBeLessThan(210);
    const midEaseElevation = elevation;

    follower.cancel();
    expect(frames).toHaveLength(0);
    expect(elevation).toBe(midEaseElevation);

    elevation = 50;
    map.queryTerrainElevation = () => 55;
    listeners.get('moveend')?.forEach((listener) => listener());
    expect(frames).toHaveLength(0);
    expect(elevation).toBe(50);

    terrain = null;
    listeners.get('terrain')?.forEach((listener) => listener());
    expect(clamped).toBe(true);
    expect(elevation).toBe(0);

    follower.dispose();
  });
});
