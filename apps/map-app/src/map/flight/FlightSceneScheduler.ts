import type { Map as MaplibreMap, MapSourceDataEvent } from 'maplibre-gl';

export type FlightSceneView = { longitude: number; latitude: number; heading: number };

export type FlightSceneSchedulerOptions = {
  /** Metres of ground travel before a movement refresh. Default 90. */
  moveMeters?: number;
  /** Degrees of heading change before a movement refresh. Default 12. */
  turnDegrees?: number;
};

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };

/**
 * Keep synchronous map-source queries out of the animation-frame callback that
 * drives the camera. Native idle callbacks run after paint; the rAF fallback
 * still spreads work across frames on browsers without requestIdleCallback.
 */
export function scheduleSceneJobs(jobs: (() => void)[], onComplete?: () => void) {
  let cancelled = false;
  let index = 0;
  let handle: number | undefined;
  const idleApi = globalThis as unknown as {
    requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const requestIdle = idleApi.requestIdleCallback?.bind(globalThis);
  const cancelIdle = idleApi.cancelIdleCallback?.bind(globalThis);

  const run = (idleDeadline?: IdleDeadlineLike) => {
    if (cancelled) return;
    const deadline = idleDeadline ?? { didTimeout: true, timeRemaining: () => 0 };
    // Avoid beginning a potentially expensive query in the scraps of an idle
    // period. The timeout guarantees progress while flight/drive paints
    // continuously and therefore offers few genuinely idle frames.
    if (!deadline.didTimeout && deadline.timeRemaining() < 2) {
      schedule();
      return;
    }
    jobs[index++]?.();
    if (index < jobs.length) schedule();
    else onComplete?.();
  };
  const schedule = () => {
    if (requestIdle) {
      handle = requestIdle(run, { timeout: 250 });
    } else {
      handle = requestAnimationFrame(() => run({ didTimeout: true, timeRemaining: () => 0 }));
    }
  };
  if (jobs.length > 0) schedule();
  else onComplete?.();
  return () => {
    cancelled = true;
    if (handle === undefined) return;
    if (requestIdle) cancelIdle?.(handle);
    else cancelAnimationFrame(handle);
  };
}

export function flightSceneNeedsRefresh(
  previous: FlightSceneView,
  current: FlightSceneView,
  moveMeters = 90,
  turnDegrees = 12,
) {
  const longitudeDelta = ((current.longitude - previous.longitude + 540) % 360) - 180;
  const east = longitudeDelta * Math.PI / 180 * 6_378_137
    * Math.cos((current.latitude + previous.latitude) / 2 * Math.PI / 180);
  const north = (current.latitude - previous.latitude) * Math.PI / 180 * 6_378_137;
  const turn = Math.abs(((current.heading - previous.heading + 540) % 360) - 180);
  return Math.hypot(east, north) >= moveMeters || turn >= turnDegrees;
}

/** Coalesce streaming/movement requests; run each layer on a separate frame. */
export function installFlightSceneScheduler(
  map: Pick<MaplibreMap, 'on' | 'off' | 'getCenter' | 'getBearing' | 'getTerrain'>,
  sourceId: string,
  jobs: (() => void)[],
  options: FlightSceneSchedulerOptions = {},
) {
  const moveMeters = options.moveMeters ?? 90;
  const turnDegrees = options.turnDegrees ?? 12;
  let disposed = false;
  let cancelJobs: (() => void) | undefined;
  let sourceDirty = true;
  let previous: FlightSceneView | undefined;
  let lastRefresh = -Infinity;
  const readView = (): FlightSceneView => {
    const center = map.getCenter();
    return { longitude: center.lng, latitude: center.lat, heading: map.getBearing() };
  };
  const check = () => {
    if (disposed || cancelJobs !== undefined) return;
    const now = performance.now();
    const current = readView();
    if (now - lastRefresh < 750) return;
    if (previous && !sourceDirty && !flightSceneNeedsRefresh(previous, current, moveMeters, turnDegrees)
      && now - lastRefresh < 3000) return;
    previous = current;
    lastRefresh = now;
    sourceDirty = false;
    cancelJobs = scheduleSceneJobs(jobs, () => { cancelJobs = undefined; });
  };
  const onSource = (event: MapSourceDataEvent) => {
    if (event.sourceDataType !== 'content') return;
    if (event.sourceId !== sourceId && event.sourceId !== map.getTerrain()?.source) return;
    sourceDirty = true;
    check();
  };
  map.on('move', check);
  map.on('sourcedata', onSource);
  // Also flush dirty data after the cooldown if movement stops.
  const timer = setInterval(check, 250);
  check();
  return () => {
    disposed = true;
    clearInterval(timer);
    cancelJobs?.();
    map.off('move', check);
    map.off('sourcedata', onSource);
  };
}
