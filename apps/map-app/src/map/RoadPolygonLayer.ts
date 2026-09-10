/** Close-zoom road surfaces as metre-buffered MapLibre fills that drape on terrain.
 *
 * Broad surface roads (not service roads, paths, bridges, or tunnels) are
 * generated per 256 m cell, off the main thread when a worker is available, and
 * cached by cell plus centreline signature. Vector `global-roads` /
 * `global-road-casing` keep only service roads once the camera cell is replaced;
 * uncovered remainder uses slightly narrower GeoJSON fallback lines so original
 * strokes cannot protrude. Cost stays bounded: two GeoJSON sources, four
 * layers, 25 nearby cells, and two in-flight jobs.
 */
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapSourceDataEvent,
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import {
  OPENFREEMAP_SOURCE_ID,
  refreshMapRenderState,
  roadWidthExpression,
} from './GlobalMapStyle';
import {
  ROAD_CELL_METRES,
  ROAD_CELL_PADDING_METRES,
  buildRoadCellPolygons,
  cellsAround,
  collectRoadCenterlines,
  fallbackLinesForCoverage,
  lineIntersectsRect,
  planOriginFromLngLat,
  roadWorkCellAt,
  type RoadCenterline,
  type RoadCellGeometry,
  type RoadWorkCell,
} from './RoadPolygonGeometry';
import {
  ROAD_POLYGON_CLASSES,
  ROAD_WIDTH_MODEL_REVISION,
} from './RoadWidth';

export const ROAD_POLYGON_SOURCE_ID = 'road-polygons';
export const ROAD_POLYGON_FALLBACK_SOURCE_ID = 'road-polygon-fallback';
export const ROAD_POLYGON_CASING_LAYER_ID = 'global-road-polygon-casing';
export const ROAD_POLYGON_LAYER_ID = 'global-road-polygons';
export const ROAD_POLYGON_FALLBACK_CASING_LAYER_ID = 'global-road-polygon-fallback-casing';
export const ROAD_POLYGON_FALLBACK_LAYER_ID = 'global-road-polygon-fallback';

export const ROAD_POLYGON_ENTER_ZOOM = 15.2;
export const ROAD_POLYGON_EXIT_ZOOM = 14.75;
export const ROAD_POLYGON_NEAR_METRES = 800;
export const ROAD_POLYGON_FALLBACK_METRES = 2200;
export const ROAD_POLYGON_MAX_CELLS = 25;
export const ROAD_POLYGON_MAX_CACHE_CELLS = 72;
export const ROAD_POLYGON_MAX_IN_FLIGHT = 2;

const SURFACE_ROAD_FILTER: FilterSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
  ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
];

const SERVICE_ONLY_FILTER: FilterSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['==', ['get', 'class'], 'service'],
  ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
];

const QUERY_FILTER: FilterSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', [...ROAD_POLYGON_CLASSES]]],
  ['!', ['in', ['get', 'brunnel'], ['literal', ['bridge', 'tunnel']]]],
];

const CLOSEUP_ROAD_GRAY = '#d8dce0';
const CLOSEUP_ROAD_CASING = '#ffffff';
const UNPAVED_ROAD = '#d9cbaa';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const VECTOR_ROAD_LAYER_IDS = ['global-road-casing', 'global-roads'] as const;

type CachedCell = RoadCellGeometry & { inputSignature: string };
type PendingWork = { requestId: number; cellKey: string; inputSignature: string };

export type RoadPolygonJob = {
  cell: RoadWorkCell;
  lines: RoadCenterline[];
  requestId: number;
  revision: string;
  complete: (result: RoadCellGeometry) => void;
};

export type RoadPolygonScheduler = (job: RoadPolygonJob) => void;

export type RoadPolygonController = {
  update: () => void;
  invalidateSource: () => void;
  dispose: () => void;
};

function polygonFillColor(): ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'surface'], 'unpaved'], UNPAVED_ROAD,
    CLOSEUP_ROAD_GRAY,
  ] as ExpressionSpecification;
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./roadPolygonWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

function collectionSignature(data: FeatureCollection) {
  return JSON.stringify(data.features.map((feature) => [feature.properties, feature.geometry]));
}

function cellInputSignature(lines: RoadCenterline[]) {
  return `${ROAD_WIDTH_MODEL_REVISION}:${lines.map((line) => (
    `${line.properties.className}:${line.properties.layer}:${line.properties.ramp ? 1 : 0}:${line.coordinates.map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join(';')}`
  )).sort().join('|')}`;
}

function linesForCell(cell: RoadWorkCell, lines: RoadCenterline[]) {
  const origin = planOriginFromLngLat((cell.west + cell.east) / 2, (cell.south + cell.north) / 2);
  const rect = {
    minEast: -ROAD_CELL_METRES / 2 - ROAD_CELL_PADDING_METRES,
    maxEast: ROAD_CELL_METRES / 2 + ROAD_CELL_PADDING_METRES,
    minNorth: -ROAD_CELL_METRES / 2 - ROAD_CELL_PADDING_METRES,
    maxNorth: ROAD_CELL_METRES / 2 + ROAD_CELL_PADDING_METRES,
  };
  return lines.filter((line) => lineIntersectsRect(line.coordinates, origin, rect));
}

export function shouldActivateRoadPolygons(zoom: number, currentlyActive: boolean) {
  if (currentlyActive) return zoom >= ROAD_POLYGON_EXIT_ZOOM;
  return zoom >= ROAD_POLYGON_ENTER_ZOOM;
}

export function installRoadPolygonLayer(
  map: MapLibreMap,
  options?: { schedule?: RoadPolygonScheduler },
): () => void {
  const controller = createRoadPolygonController(map, options);
  let timer: number | undefined;
  const scheduleUpdate = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      controller.update();
    }, 80);
  };
  const sourceData = (event: MapSourceDataEvent) => {
    if (event.sourceId === OPENFREEMAP_SOURCE_ID && event.sourceDataType === 'content') {
      scheduleUpdate();
    }
  };
  map.on('moveend', scheduleUpdate);
  map.on('sourcedata', sourceData);
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    map.off('moveend', scheduleUpdate);
    map.off('sourcedata', sourceData);
    controller.dispose();
  };
}

export function createRoadPolygonController(
  map: MapLibreMap,
  options?: { schedule?: RoadPolygonScheduler },
): RoadPolygonController {
  const cache = new Map<string, CachedCell>();
  const inFlight = new Map<string, PendingWork>();
  const queuedCells = new Map<string, RoadWorkCell>();
  const worker = options?.schedule ? null : createWorker();
  let requestId = 0;
  let active = false;
  let covering = false;
  let lastPublished = '';
  let lastFallback = '';
  let lastLatitude: number | undefined;
  let lastLines: RoadCenterline[] = [];
  let lastCells: RoadWorkCell[] = [];
  let lastCenter = { longitude: 0, latitude: 0 };
  let disposed = false;

  const currentSignature = (cell: RoadWorkCell) => cellInputSignature(linesForCell(cell, lastLines));
  const cachedFor = (cell: RoadWorkCell) => {
    const cached = cache.get(cell.key);
    if (cached && cached.inputSignature === currentSignature(cell)) return cached;
    return undefined;
  };

  const remember = (result: RoadCellGeometry, inputSignature: string) => {
    cache.set(result.cellKey, { ...result, inputSignature });
    while (cache.size > ROAD_POLYGON_MAX_CACHE_CELLS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const insertBefore = () => (
    map.getLayer('global-road-center-markings')
      ? 'global-road-center-markings'
      : map.getLayer('global-path-casing') ? 'global-path-casing' : undefined
  );

  const ensureStyle = () => {
    if (!map.getSource(ROAD_POLYGON_SOURCE_ID)) {
      map.addSource(ROAD_POLYGON_SOURCE_ID, { type: 'geojson', data: EMPTY, maxzoom: 16 });
    }
    if (!map.getSource(ROAD_POLYGON_FALLBACK_SOURCE_ID)) {
      map.addSource(ROAD_POLYGON_FALLBACK_SOURCE_ID, { type: 'geojson', data: EMPTY, maxzoom: 16 });
    }
    const before = insertBefore();
    if (!map.getLayer(ROAD_POLYGON_FALLBACK_CASING_LAYER_ID)) {
      map.addLayer({
        id: ROAD_POLYGON_FALLBACK_CASING_LAYER_ID,
        type: 'line',
        source: ROAD_POLYGON_FALLBACK_SOURCE_ID,
        minzoom: ROAD_POLYGON_EXIT_ZOOM,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': CLOSEUP_ROAD_CASING,
          'line-width': roadWidthExpression(map.getCenter().lat, true),
          'line-opacity': 0.9,
        },
      }, before);
    }
    if (!map.getLayer(ROAD_POLYGON_FALLBACK_LAYER_ID)) {
      map.addLayer({
        id: ROAD_POLYGON_FALLBACK_LAYER_ID,
        type: 'line',
        source: ROAD_POLYGON_FALLBACK_SOURCE_ID,
        minzoom: ROAD_POLYGON_EXIT_ZOOM,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': polygonFillColor(),
          'line-width': roadWidthExpression(map.getCenter().lat),
          'line-opacity': 1,
        },
      }, before);
    }
    if (!map.getLayer(ROAD_POLYGON_CASING_LAYER_ID)) {
      map.addLayer({
        id: ROAD_POLYGON_CASING_LAYER_ID,
        type: 'fill',
        source: ROAD_POLYGON_SOURCE_ID,
        minzoom: ROAD_POLYGON_EXIT_ZOOM,
        filter: ['==', ['get', 'kind'], 'casing'],
        layout: {
          visibility: 'none',
          'fill-sort-key': ['+', ['coalesce', ['get', 'layer'], 0], 0.05],
        },
        paint: {
          'fill-color': CLOSEUP_ROAD_CASING,
          'fill-opacity': 1,
        },
      }, before);
    }
    if (!map.getLayer(ROAD_POLYGON_LAYER_ID)) {
      map.addLayer({
        id: ROAD_POLYGON_LAYER_ID,
        type: 'fill',
        source: ROAD_POLYGON_SOURCE_ID,
        minzoom: ROAD_POLYGON_EXIT_ZOOM,
        filter: ['==', ['get', 'kind'], 'surface'],
        layout: {
          visibility: 'none',
          'fill-sort-key': ['+', ['coalesce', ['get', 'layer'], 0], 0.1],
        },
        paint: {
          'fill-color': polygonFillColor(),
          'fill-opacity': 1,
        },
      }, before);
    }
  };

  const setVectorRoadFilter = (replaced: boolean) => {
    const filter = replaced ? SERVICE_ONLY_FILTER : SURFACE_ROAD_FILTER;
    for (const id of VECTOR_ROAD_LAYER_IDS) {
      if (map.getLayer(id)) map.setFilter(id, filter);
    }
  };

  const setReplacementVisible = (visible: boolean) => {
    const visibility = visible ? 'visible' : 'none';
    for (const id of [
      ROAD_POLYGON_CASING_LAYER_ID, ROAD_POLYGON_LAYER_ID,
      ROAD_POLYGON_FALLBACK_CASING_LAYER_ID, ROAD_POLYGON_FALLBACK_LAYER_ID,
    ]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  };

  const publish = () => {
    const completed = lastCells.filter((cell) => {
      const cached = cachedFor(cell);
      return cached && !cached.skipped;
    });
    const centerCell = roadWorkCellAt(lastCenter.longitude, lastCenter.latitude);
    const centerReady = completed.some((cell) => cell.key === centerCell.key);
    const polygonData: FeatureCollection = {
      type: 'FeatureCollection',
      features: completed.flatMap((cell) => cachedFor(cell)!.polygons),
    };
    const fallbackData: FeatureCollection = {
      type: 'FeatureCollection',
      features: fallbackLinesForCoverage(lastLines, completed, {
        longitude: lastCenter.longitude,
        latitude: lastCenter.latitude,
        metres: ROAD_POLYGON_FALLBACK_METRES,
      }),
    };
    const polygonSource = map.getSource(ROAD_POLYGON_SOURCE_ID) as GeoJSONSource | undefined;
    const fallbackSource = map.getSource(ROAD_POLYGON_FALLBACK_SOURCE_ID) as GeoJSONSource | undefined;
    const polygonSignature = collectionSignature(polygonData);
    const fallbackSignature = collectionSignature(fallbackData);
    if (polygonSource && polygonSignature !== lastPublished) {
      polygonSource.setData(polygonData);
      lastPublished = polygonSignature;
    }
    if (fallbackSource && fallbackSignature !== lastFallback) {
      fallbackSource.setData(fallbackData);
      lastFallback = fallbackSignature;
    }
    const nextCovering = centerReady && completed.length > 0;
    if (nextCovering !== covering) {
      covering = nextCovering;
      setVectorRoadFilter(covering);
      setReplacementVisible(covering);
      refreshMapRenderState(map);
    }
  };

  const updateFallbackWidths = () => {
    const latitude = map.getCenter().lat;
    if (lastLatitude !== undefined && Math.abs(latitude - lastLatitude) < 0.25) return;
    lastLatitude = latitude;
    if (map.getLayer(ROAD_POLYGON_FALLBACK_CASING_LAYER_ID)) {
      map.setPaintProperty(
        ROAD_POLYGON_FALLBACK_CASING_LAYER_ID,
        'line-width',
        roadWidthExpression(latitude, true),
      );
    }
    if (map.getLayer(ROAD_POLYGON_FALLBACK_LAYER_ID)) {
      map.setPaintProperty(
        ROAD_POLYGON_FALLBACK_LAYER_ID,
        'line-width',
        roadWidthExpression(latitude),
      );
    }
  };

  const completeCell = (result: RoadCellGeometry, token: number, inputSignature: string) => {
    const pending = inFlight.get(result.cellKey);
    if (!pending || pending.requestId !== token || pending.inputSignature !== inputSignature || disposed) return;
    inFlight.delete(result.cellKey);
    remember(result, inputSignature);
    pumpQueue();
    if (active) publish();
  };

  const runJob = (job: RoadPolygonJob) => {
    if (options?.schedule) {
      options.schedule(job);
      return;
    }
    if (worker) {
      worker.postMessage({ requestId: job.requestId, cell: job.cell, lines: job.lines });
      return;
    }
    job.complete(buildRoadCellPolygons(job.cell, job.lines));
  };

  const scheduleCell = (cell: RoadWorkCell) => {
    const nearby = linesForCell(cell, lastLines);
    const inputSignature = cellInputSignature(nearby);
    const cached = cache.get(cell.key);
    if (inFlight.has(cell.key) || (cached && cached.inputSignature === inputSignature)) return;
    if (inFlight.size >= ROAD_POLYGON_MAX_IN_FLIGHT) {
      queuedCells.set(cell.key, cell);
      return;
    }
    const token = requestId += 1;
    inFlight.set(cell.key, { requestId: token, cellKey: cell.key, inputSignature });
    runJob({
      cell,
      lines: nearby,
      requestId: token,
      revision: inputSignature,
      complete: (result) => completeCell(result, token, inputSignature),
    });
  };

  const pumpQueue = () => {
    for (const [key, cell] of queuedCells) {
      if (inFlight.size >= ROAD_POLYGON_MAX_IN_FLIGHT) break;
      queuedCells.delete(key);
      scheduleCell(cell);
    }
  };

  if (worker) {
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as {
        requestId: number;
        cellKey: string;
        ok: boolean;
        polygons?: RoadCellGeometry['polygons'];
        vertexCount?: number;
        skipped?: boolean;
      };
      const pending = inFlight.get(data.cellKey);
      if (!pending || pending.requestId !== data.requestId) return;
      if (!data.ok) {
        inFlight.delete(data.cellKey);
        return;
      }
      completeCell({
        cellKey: data.cellKey,
        polygons: data.polygons ?? [],
        vertexCount: data.vertexCount ?? 0,
        skipped: Boolean(data.skipped),
      }, data.requestId, pending.inputSignature);
    });
  }

  const teardown = () => {
    if (!active && !covering) return;
    active = false;
    covering = false;
    queuedCells.clear();
    inFlight.clear();
    lastPublished = '';
    lastFallback = '';
    setVectorRoadFilter(false);
    setReplacementVisible(false);
    (map.getSource(ROAD_POLYGON_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY);
    (map.getSource(ROAD_POLYGON_FALLBACK_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY);
    refreshMapRenderState(map);
  };

  const update = () => {
    if (disposed || !map.getSource?.(OPENFREEMAP_SOURCE_ID) || map.isStyleLoaded?.() === false) return;
    ensureStyle();
    const zoom = map.getZoom();
    if (!shouldActivateRoadPolygons(zoom, active)) {
      teardown();
      return;
    }
    active = true;
    const center = map.getCenter();
    lastCenter = { longitude: center.lng, latitude: center.lat };
    updateFallbackWidths();
    let features: Array<{
      geometry?: { type?: string; coordinates?: unknown } | null;
      properties?: Record<string, unknown> | null;
    }> = [];
    try {
      features = map.querySourceFeatures(OPENFREEMAP_SOURCE_ID, {
        sourceLayer: 'transportation',
        filter: QUERY_FILTER,
      });
    } catch {
      return;
    }
    lastLines = collectRoadCenterlines(features);
    lastCells = cellsAround(center.lng, center.lat, ROAD_POLYGON_NEAR_METRES, ROAD_POLYGON_MAX_CELLS);
    for (const cell of lastCells) scheduleCell(cell);
    publish();
  };

  return {
    update,
    invalidateSource: () => {
      cache.clear();
      inFlight.clear();
      queuedCells.clear();
    },
    dispose: () => {
      disposed = true;
      worker?.terminate();
      inFlight.clear();
      queuedCells.clear();
      cache.clear();
      teardown();
      if (map.getLayer(ROAD_POLYGON_FALLBACK_LAYER_ID)) map.removeLayer(ROAD_POLYGON_FALLBACK_LAYER_ID);
      if (map.getLayer(ROAD_POLYGON_FALLBACK_CASING_LAYER_ID)) map.removeLayer(ROAD_POLYGON_FALLBACK_CASING_LAYER_ID);
      if (map.getLayer(ROAD_POLYGON_LAYER_ID)) map.removeLayer(ROAD_POLYGON_LAYER_ID);
      if (map.getLayer(ROAD_POLYGON_CASING_LAYER_ID)) map.removeLayer(ROAD_POLYGON_CASING_LAYER_ID);
      if (map.getSource(ROAD_POLYGON_FALLBACK_SOURCE_ID)) map.removeSource(ROAD_POLYGON_FALLBACK_SOURCE_ID);
      if (map.getSource(ROAD_POLYGON_SOURCE_ID)) map.removeSource(ROAD_POLYGON_SOURCE_ID);
    },
  };
}
