import type { Map as MaplibreMap, MapSourceDataEvent } from 'maplibre-gl';

export type FlightSceneView = { longitude: number; latitude: number; heading: number };

export function flightSceneNeedsRefresh(previous: FlightSceneView, current: FlightSceneView) {
  const longitudeDelta = ((current.longitude - previous.longitude + 540) % 360) - 180;
  const east = longitudeDelta * Math.PI / 180 * 6_378_137
    * Math.cos((current.latitude + previous.latitude) / 2 * Math.PI / 180);
  const north = (current.latitude - previous.latitude) * Math.PI / 180 * 6_378_137;
  const turn = Math.abs(((current.heading - previous.heading + 540) % 360) - 180);
  return Math.hypot(east, north) >= 90 || turn >= 12;
}

/** Coalesce streaming/movement requests; run each layer on a separate frame. */
export function installFlightSceneScheduler(
  map: Pick<MaplibreMap, 'on' | 'off' | 'getCenter' | 'getBearing' | 'getTerrain'>,
  sourceId: string,
  jobs: (() => void)[],
) {
  let disposed = false;
  let frame: number | undefined;
  let sourceDirty = true;
  let previous: FlightSceneView | undefined;
  let lastRefresh = -Infinity;
  const readView = (): FlightSceneView => {
    const center = map.getCenter();
    return { longitude: center.lng, latitude: center.lat, heading: map.getBearing() };
  };
  const check = () => {
    if (disposed || frame !== undefined) return;
    const now = performance.now();
    const current = readView();
    if (now - lastRefresh < 750) return;
    if (previous && !sourceDirty && !flightSceneNeedsRefresh(previous, current)
      && now - lastRefresh < 3000) return;
    previous = current;
    lastRefresh = now;
    sourceDirty = false;
    let index = 0;
    const run = () => {
      if (disposed) return;
      jobs[index++]?.();
      frame = index < jobs.length ? requestAnimationFrame(run) : undefined;
    };
    frame = requestAnimationFrame(run);
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
    if (frame !== undefined) cancelAnimationFrame(frame);
    map.off('move', check);
    map.off('sourcedata', onSource);
  };
}
