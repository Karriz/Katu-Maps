/** 3D terrain mesh is rebuilt on zoom. At wide regional cameras that covers a
 * large world area, which is why rapid zoom-out stutters and terrain gestures
 * misbehave. Keep the mesh for close city views only; hillshade still provides
 * relief whenever the terrain layer is enabled. */
export const TERRAIN_3D_ENABLE_ZOOM = 12.5;
export const TERRAIN_3D_DISABLE_ZOOM = 11.75;

/** Exponential follow rate (1/s). Higher catches terrain faster; lower is softer. */
export const TERRAIN_ELEVATION_FOLLOW_RATE = 4;
/** Ignore only sub-metre DEM noise; larger changes should start correcting promptly. */
export const TERRAIN_ELEVATION_FOLLOW_MIN_METERS = 1;
/** Smooth changes in the sampled DEM target when a more detailed tile arrives. */
export const TERRAIN_TARGET_FOLLOW_RATE = 2;
const TERRAIN_ELEVATION_SETTLE_METERS = 0.5;
const TERRAIN_ELEVATION_APPLY_METERS = 0.05;
const TERRAIN_FOLLOW_EVENT = 'terrainCameraFollow';

export type TerrainController = {
  getZoom: () => number;
  getTerrain: () => { source?: string } | null | undefined;
  setTerrain: (terrain: { source: string; exaggeration: number } | null) => unknown;
};

export type TerrainCameraFollowMap = {
  getTerrain: () => unknown;
  getCenter: () => { lng: number; lat: number };
  getCenterElevation: () => number;
  getCenterClampedToGround: () => boolean;
  setCenterClampedToGround: (value: boolean) => void;
  queryTerrainElevation: (
    lngLat: [number, number] | { lng: number; lat: number },
  ) => number | null | undefined;
  isMoving: () => boolean;
  triggerRepaint: () => void;
  on: (type: string, listener: (...args: any[]) => void) => unknown;
  off: (type: string, listener: (...args: any[]) => void) => unknown;
};

type ElevationTransform = {
  elevation: number;
  setElevation: (elevation: number) => void;
};

export function shouldEnableTerrain3d(
  userEnabled: boolean,
  zoom: number,
  currentlyEnabled: boolean,
): boolean {
  if (!userEnabled) return false;
  return currentlyEnabled ? zoom >= TERRAIN_3D_DISABLE_ZOOM : zoom >= TERRAIN_3D_ENABLE_ZOOM;
}

export function syncTerrain3d(
  map: TerrainController,
  options: { userEnabled: boolean; source: string },
): boolean {
  const currentlyEnabled = Boolean(map.getTerrain());
  const enable = shouldEnableTerrain3d(options.userEnabled, map.getZoom(), currentlyEnabled);
  if (enable) {
    const current = map.getTerrain();
    if (!current || current.source !== options.source) {
      map.setTerrain({ source: options.source, exaggeration: 1 });
    }
  } else if (currentlyEnabled) {
    map.setTerrain(null);
  }
  return enable;
}

export type TerrainGestureMap = {
  scrollZoom?: {
    isActive?: () => boolean;
    reset?: () => void;
  };
  _handlers?: {
    _terrainMovement?: boolean;
    _terrainGestureAnchorElevation?: number | null;
  };
  _camera?: {
    elevationFreeze?: boolean;
  };
};

/**
 * MapLibre freezes terrain elevation for the interaction that starts with a
 * wheel zoom, and scrollZoom stays "active" for ~200ms after the last tick.
 * A pan that begins in that window reuses the zoom-start elevation plane; after
 * a rapid zoom-out that plane is far from the camera and small drags leap
 * across the map. Call this on mousedown/touchstart (capture) before MapLibre
 * handles the pan so the new gesture captures a fresh anchor.
 */
export function clearStaleTerrainGesture(map: TerrainGestureMap): boolean {
  const handlers = map._handlers;
  const camera = map._camera;
  const scrollActive = Boolean(map.scrollZoom?.isActive?.());
  const hadStale = Boolean(
    handlers?._terrainMovement
    || handlers?._terrainGestureAnchorElevation != null
    || camera?.elevationFreeze
    || scrollActive,
  );
  if (!hadStale) return false;

  if (handlers) {
    handlers._terrainMovement = false;
    handlers._terrainGestureAnchorElevation = null;
  }
  if (camera) {
    camera.elevationFreeze = false;
  }
  if (scrollActive) {
    map.scrollZoom?.reset?.();
  }
  return true;
}

/** One frame of exponential smoothing toward sampled terrain elevation. */
export function stepTerrainElevation(
  current: number,
  target: number,
  deltaSeconds: number,
  followRate = TERRAIN_ELEVATION_FOLLOW_RATE,
): number {
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(current)) return target;
  const dt = Math.max(0, Math.min(deltaSeconds, 0.05));
  if (dt === 0 || Math.abs(target - current) < 1e-6) return current;
  const alpha = 1 - Math.exp(-followRate * dt);
  return current + (target - current) * alpha;
}

/** Keep terrain LOD changes from instantly replacing the elevation target. */
export function stepTerrainTarget(
  current: number,
  sampled: number,
  deltaSeconds: number,
): number {
  return stepTerrainElevation(current, sampled, deltaSeconds, TERRAIN_TARGET_FOLLOW_RATE);
}

export function shouldFollowTerrainElevation(
  current: number,
  target: number,
  minDeltaMeters = TERRAIN_ELEVATION_FOLLOW_MIN_METERS,
): boolean {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
  return Math.abs(target - current) >= minDeltaMeters;
}

function elevationTransforms(map: object): ElevationTransform[] {
  const camera = (map as {
    _camera?: {
      transform?: ElevationTransform;
      _requestedCameraState?: ElevationTransform;
    };
  })._camera;
  if (!camera?.transform) return [];
  if (!camera._requestedCameraState || camera._requestedCameraState === camera.transform) {
    return [camera.transform];
  }
  return [camera.transform, camera._requestedCameraState];
}

/** Change look-at elevation only — do not recalculate zoom/center (that reads as a snap/pan). */
function applyElevationQuietly(map: TerrainCameraFollowMap, elevation: number): void {
  const transforms = elevationTransforms(map);
  if (transforms.length) {
    let changed = false;
    for (const transform of transforms) {
      if (Math.abs(transform.elevation - elevation) < TERRAIN_ELEVATION_APPLY_METERS) continue;
      transform.setElevation(elevation);
      changed = true;
    }
    if (changed) map.triggerRepaint();
    return;
  }
  const publicMap = map as TerrainCameraFollowMap & {
    setCenterElevation?: (elevation: number, eventData?: Record<string, unknown>) => void;
  };
  if (Math.abs(map.getCenterElevation() - elevation) < TERRAIN_ELEVATION_APPLY_METERS) return;
  publicMap.setCenterElevation?.(elevation, { [TERRAIN_FOLLOW_EVENT]: true });
}

export function isTerrainCameraFollowEvent(event: unknown): boolean {
  return Boolean(
    event
    && typeof event === 'object'
    && TERRAIN_FOLLOW_EVENT in event
    && (event as Record<string, unknown>)[TERRAIN_FOLLOW_EVENT],
  );
}

/**
 * Owns center elevation while the 3D terrain mesh is on.
 *
 * MapLibre freezes elevation during gestures, then snaps via
 * `recalculateZoomAndCenter` on moveend when `centerClampedToGround` is true.
 * That snap is what feels jumpy over mountains. We disable the clamp and ease
 * elevation toward a filtered DEM target while ignoring only sub-metre noise.
 * When the mesh turns off, the residual elevation is eased back to zero before
 * normal ground clamping resumes.
 */
export function installTerrainCameraFollower(
  map: TerrainCameraFollowMap,
  options: {
    isPaused?: () => boolean;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
  } = {},
): { cancel: () => void; dispose: () => void } {
  const requestFrame = options.requestAnimationFrame ?? requestAnimationFrame.bind(globalThis);
  const cancelFrame = options.cancelAnimationFrame ?? cancelAnimationFrame.bind(globalThis);
  const isPaused = options.isPaused ?? (() => false);

  let frame = 0;
  let lastTime = 0;
  let smoothedElevation: number | null = null;
  let smoothedTarget: number | null = null;
  let following = false;
  let resetting = false;
  let frameGeneration = 0;

  const meshEnabled = () => Boolean(map.getTerrain());

  const sampleTarget = (): number | null => {
    if (!meshEnabled()) return null;
    const center = map.getCenter();
    const elevation = map.queryTerrainElevation([center.lng, center.lat]);
    return elevation == null || !Number.isFinite(elevation) ? null : elevation;
  };

  const stopFrame = () => {
    // cancelAnimationFrame cannot stop a callback that the browser has
    // already dispatched. Invalidate it as well so an interrupted ease can
    // never apply the previous location's elevation during a new gesture.
    frameGeneration += 1;
    if (frame) cancelFrame(frame);
    frame = 0;
    lastTime = 0;
  };

  const scheduleTick = () => {
    const generation = frameGeneration;
    let handle = 0;
    handle = requestFrame((time) => {
      if (generation !== frameGeneration) return;
      if (frame === handle) frame = 0;
      tick(time);
    });
    frame = handle;
  };

  /** Stop easing immediately without snapping elevation to the DEM target. */
  const cancel = () => {
    stopFrame();
    if (following) {
      smoothedElevation = map.getCenterElevation();
      // A gesture can move to unrelated ground; do not pull the next camera
      // correction toward the previous location's filtered target.
      smoothedTarget = null;
    }
  };

  const disableFollowing = () => {
    // setTerrain(null) leaves elevation untouched while the center is not
    // clamped. Ease that residual height back to zero before restoring the
    // clamp, otherwise mountainous views visibly jump at the zoom threshold.
    resetting = true;
    stopFrame();
    smoothedElevation = map.getCenterElevation();
    smoothedTarget = 0;
    requestFrameIfNeeded();
  };

  const enableFollowing = () => {
    following = true;
    resetting = false;
    if (map.getCenterClampedToGround()) {
      map.setCenterClampedToGround(false);
    }
    smoothedElevation = map.getCenterElevation();
    smoothedTarget = null;
  };

  const finishReset = () => {
    applyElevationQuietly(map, 0);
    resetting = false;
    following = false;
    smoothedElevation = null;
    smoothedTarget = null;
    if (!map.getCenterClampedToGround()) map.setCenterClampedToGround(true);
  };

  const tick = (time: number) => {
    if ((!following && !resetting) || isPaused() || map.isMoving()) {
      lastTime = 0;
      return;
    }

    const sampledTarget = resetting ? 0 : sampleTarget();
    if (sampledTarget == null) {
      lastTime = 0;
      return;
    }

    if (smoothedElevation == null) {
      smoothedElevation = map.getCenterElevation();
    }

    const deltaSeconds = lastTime ? (time - lastTime) / 1000 : 1 / 60;
    lastTime = time;
    smoothedTarget = smoothedTarget == null
      ? sampledTarget
      : stepTerrainTarget(smoothedTarget, sampledTarget, deltaSeconds);
    smoothedElevation = stepTerrainElevation(smoothedElevation, smoothedTarget, deltaSeconds);
    applyElevationQuietly(map, smoothedElevation);

    if (Math.abs(sampledTarget - smoothedElevation) > TERRAIN_ELEVATION_SETTLE_METERS
      || Math.abs(sampledTarget - smoothedTarget) > TERRAIN_ELEVATION_SETTLE_METERS) {
      scheduleTick();
    } else {
      lastTime = 0;
      if (resetting) {
        finishReset();
      } else if (Math.abs(map.getCenterElevation() - sampledTarget) > TERRAIN_ELEVATION_APPLY_METERS) {
        smoothedElevation = sampledTarget;
        smoothedTarget = sampledTarget;
        applyElevationQuietly(map, sampledTarget);
      }
    }
  };

  function requestFrameIfNeeded() {
    if ((!following && !resetting) || isPaused() || map.isMoving() || frame) return;
    const current = smoothedElevation ?? map.getCenterElevation();
    const target = resetting ? 0 : sampleTarget();
    if (target == null || !shouldFollowTerrainElevation(current, target)) {
      if (target != null) smoothedElevation = current;
      if (resetting && target != null) finishReset();
      return;
    }
    scheduleTick();
  }

  const request = requestFrameIfNeeded;

  const syncFromTerrain = () => {
    if (isPaused()) return;
    if (meshEnabled()) {
      if (!following) enableFollowing();
      return;
    }
    if (following) disableFollowing();
  };

  const handleMoveEnd = () => {
    if (isPaused()) return;
    if (resetting) {
      smoothedElevation = map.getCenterElevation();
      request();
      return;
    }
    if (meshEnabled()) {
      if (!following) enableFollowing();
      smoothedElevation = map.getCenterElevation();
      // A completed camera move establishes a new target immediately. Target
      // filtering is reserved for later DEM tile/LOD updates at this center.
      smoothedTarget = sampleTarget();
      request();
    }
  };
  const handleIdle = () => {
    if (isPaused()) return;
    if (resetting) {
      request();
      return;
    }
    if (meshEnabled() && !following) enableFollowing();
    request();
  };
  const handleSourceData = (event: { sourceId?: string; dataType?: string }) => {
    if (event.dataType === 'source' && event.sourceId === 'terrain') request();
  };

  map.on('terrain', syncFromTerrain);
  map.on('moveend', handleMoveEnd);
  map.on('idle', handleIdle);
  map.on('sourcedata', handleSourceData);
  syncFromTerrain();

  return {
    cancel,
    dispose: () => {
      stopFrame();
      map.off('terrain', syncFromTerrain);
      map.off('moveend', handleMoveEnd);
      map.off('idle', handleIdle);
      map.off('sourcedata', handleSourceData);
      if (following && !isPaused()) {
        following = false;
      }
    },
  };
}
