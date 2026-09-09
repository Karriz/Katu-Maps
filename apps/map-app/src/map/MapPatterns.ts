import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  EMPTY_PATTERN_ID, GROUND_PATTERN_LAYER_IDS, generateGroundPattern,
  groundPatternImageId, groundPatternKinds,
  type GroundCoverageCache, type PatternImage,
} from './GroundPatterns';
import { generateWaterPattern, WATER_PATTERN_ID } from './WaterPattern';

// Fixed resolutions and kinds bound this cache to 19 images across map mounts.
const images = new Map<string, PatternImage>();
const PATTERN_WORK_BUDGET_MS = 2;

export function installMapPatterns(map: MapLibreMap) {
  const coverage: GroundCoverageCache = new Map();
  const jobs = new Map<string, Generator<void, PatternImage>>();
  let disposed = false;
  let scheduled: number | undefined;
  const useIdle = typeof window.requestIdleCallback === 'function';

  if (!map.hasImage(EMPTY_PATTERN_ID)) {
    map.addImage(EMPTY_PATTERN_ID, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
  }

  const candidates = () => {
    const zoom = map.getZoom();
    const ids: string[] = [];
    // Prewarm one zoom level before each texture becomes visible.
    if (zoom >= 7) ids.push(WATER_PATTERN_ID);
    if (zoom >= 8) {
      const paint = map.getLayer(GROUND_PATTERN_LAYER_IDS[0])
        ? map.getPaintProperty(GROUND_PATTERN_LAYER_IDS[0], 'fill-pattern') : undefined;
      const dark = JSON.stringify(paint)?.includes('-dark') ?? false;
      for (const theme of dark ? ['dark', 'light'] as const : ['light', 'dark'] as const) {
        for (const kind of groundPatternKinds()) ids.push(groundPatternImageId(kind, theme));
      }
    }
    return ids.filter((id) => !map.hasImage(id));
  };

  const run = (idle?: IdleDeadline) => {
    scheduled = undefined;
    if (disposed) return;
    const id = candidates()[0];
    if (!id) return;
    let image = images.get(id);
    if (!image) {
      let job = jobs.get(id);
      if (!job) {
        if (id === WATER_PATTERN_ID) job = generateWaterPattern(512);
        else {
          const kind = groundPatternKinds().find((kind) => id === groundPatternImageId(kind, 'light')
            || id === groundPatternImageId(kind, 'dark'))!;
          job = generateGroundPattern(256, kind, id.endsWith('-dark') ? 'dark' : 'light', coverage);
        }
        jobs.set(id, job);
      }
      const deadline = performance.now() + PATTERN_WORK_BUDGET_MS;
      // A timeout permits progress, not an unbounded drain of the queue.
      while (performance.now() < deadline && (!idle || idle.didTimeout || idle.timeRemaining() > 0.5)) {
        const result = job.next();
        if (result.done) {
          image = result.value;
          images.set(id, image);
          jobs.delete(id);
          break;
        }
      }
    }
    if (image) {
      // Publish at most one image per callback; solid fills remain visible
      // through the transparent pattern fallback until registration completes.
      map.addImage(id, image, { pixelRatio: 0.5 });
      for (const kind of groundPatternKinds()) {
        if (images.has(groundPatternImageId(kind, 'light')) && images.has(groundPatternImageId(kind, 'dark'))) {
          coverage.delete(kind);
        }
      }
    }
    schedule();
  };

  const schedule = () => {
    if (disposed || scheduled !== undefined || candidates().length === 0) return;
    scheduled = useIdle
      ? window.requestIdleCallback(run, { timeout: 250 })
      : window.setTimeout(run, 16);
  };
  map.on('zoomend', schedule);
  map.on('styleimagemissing', schedule);
  schedule();

  return () => {
    disposed = true;
    if (scheduled !== undefined) {
      if (useIdle) window.cancelIdleCallback(scheduled);
      else window.clearTimeout(scheduled);
    }
    map.off('zoomend', schedule);
    map.off('styleimagemissing', schedule);
    jobs.clear();
    coverage.clear();
  };
}
