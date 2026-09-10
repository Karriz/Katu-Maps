import { describe, expect, it, vi } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { buildRoadCellPolygons } from './RoadPolygonGeometry';
import {
  ROAD_POLYGON_CENTERLINE_LAYER_ID,
  ROAD_POLYGON_ENTER_ZOOM,
  ROAD_POLYGON_EXIT_ZOOM,
  ROAD_POLYGON_FALLBACK_LAYER_ID,
  ROAD_POLYGON_LAYER_ID,
  coveredVectorRoadOpacity,
  createRoadPolygonController,
  roadPolygonCenterlineOpacity,
  roadPolygonFadeOpacity,
  shouldActivateRoadPolygons,
  uncoveredVectorRoadOpacity,
  type RoadPolygonJob,
} from './RoadPolygonLayer';

function createMap(options?: {
  zoom?: number;
  features?: Array<{ geometry: { type: string; coordinates: number[][] }; properties: Record<string, unknown> }>;
}) {
  const layers = new Map<string, { layout: Record<string, unknown>; paint: Record<string, unknown>; filter?: unknown }>();
  const sources = new Map<string, { data: unknown }>([
    ['openfreemap', { data: {} }],
  ]);
  const setData = vi.fn((id: string, data: unknown) => {
    sources.get(id)!.data = data;
  });
  let zoom = options?.zoom ?? 16;
  const map = {
    getZoom: () => zoom,
    setZoom: (value: number) => { zoom = value; },
    getCenter: () => ({ lng: 23.7609, lat: 61.4981 }),
    getCenterElevation: () => 0,
    getBearing: () => 0,
    getPitch: () => 0,
    getRoll: () => 0,
    getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    jumpTo: vi.fn(),
    redraw: vi.fn(),
    getSource: (id: string) => {
      const source = sources.get(id);
      if (!source) return undefined;
      return {
        ...source,
        setData: (data: unknown) => setData(id, data),
      };
    },
    addSource: (id: string, source: { data?: unknown }) => {
      sources.set(id, { data: source.data });
    },
    removeSource: (id: string) => { sources.delete(id); },
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }) => {
      layers.set(layer.id, { layout: { ...(layer.layout ?? {}) }, paint: { ...(layer.paint ?? {}) } });
    },
    removeLayer: (id: string) => { layers.delete(id); },
    setLayoutProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.layout[name] = value;
    },
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.paint[name] = value;
    },
    setFilter: vi.fn((id: string, filter: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.filter = filter;
    }),
    querySourceFeatures: vi.fn(() => options?.features ?? [
      {
        geometry: { type: 'LineString', coordinates: [[23.7609, 61.4981], [23.763, 61.4981]] },
        properties: { class: 'primary' },
      },
    ]),
  };
  layers.set('global-roads', { layout: {}, paint: {} });
  layers.set('global-road-casing', { layout: {}, paint: {} });
  layers.set('global-road-center-markings', { layout: {}, paint: {} });
  return { map, layers, sources, setData, setZoom: (value: number) => { zoom = value; } };
}

function evaluateOpacity(
  expression: ReturnType<typeof roadPolygonFadeOpacity>,
  zoom: number,
  properties: Record<string, unknown> = {},
) {
  const compiled = createExpression(expression, 'road-polygon-opacity');
  if (compiled.result !== 'success') throw new Error('Invalid opacity expression');
  return compiled.value.evaluate({ zoom }, { properties } as never) as number;
}

describe('road polygon layer', () => {
  it('uses hysteresis so close zooms stay active until the exit zoom', () => {
    expect(shouldActivateRoadPolygons(15.2, false)).toBe(true);
    expect(shouldActivateRoadPolygons(15.0, false)).toBe(false);
    expect(shouldActivateRoadPolygons(14.9, true)).toBe(true);
    expect(shouldActivateRoadPolygons(ROAD_POLYGON_EXIT_ZOOM - 0.01, true)).toBe(false);
    expect(ROAD_POLYGON_ENTER_ZOOM).toBeGreaterThan(ROAD_POLYGON_EXIT_ZOOM);
  });

  it('crossfades polygon fills and replaced vector roads across the hysteresis band', () => {
    expect(evaluateOpacity(roadPolygonFadeOpacity(1), ROAD_POLYGON_EXIT_ZOOM)).toBe(0);
    expect(evaluateOpacity(roadPolygonFadeOpacity(1), ROAD_POLYGON_ENTER_ZOOM)).toBe(1);
    expect(evaluateOpacity(roadPolygonFadeOpacity(1), 16)).toBe(1);
    const midZoom = (ROAD_POLYGON_EXIT_ZOOM + ROAD_POLYGON_ENTER_ZOOM) / 2;
    expect(evaluateOpacity(roadPolygonFadeOpacity(1), midZoom)).toBeCloseTo(0.5, 5);

    const primary = { class: 'primary' };
    const service = { class: 'service' };
    expect(evaluateOpacity(coveredVectorRoadOpacity(0.98), 16, primary)).toBe(0);
    expect(evaluateOpacity(coveredVectorRoadOpacity(0.98), ROAD_POLYGON_ENTER_ZOOM, primary)).toBe(0);
    expect(evaluateOpacity(coveredVectorRoadOpacity(0.98), ROAD_POLYGON_EXIT_ZOOM, primary)).toBe(0.98);
    expect(evaluateOpacity(coveredVectorRoadOpacity(0.98), midZoom, primary)).toBeCloseTo(0.49, 5);
    expect(evaluateOpacity(coveredVectorRoadOpacity(0.98), 16, service)).toBe(0.98);
    expect(evaluateOpacity(uncoveredVectorRoadOpacity(0.98), 16, primary)).toBe(0.98);
    expect(evaluateOpacity(roadPolygonCenterlineOpacity(), ROAD_POLYGON_EXIT_ZOOM)).toBe(0);
    expect(evaluateOpacity(roadPolygonCenterlineOpacity(), 16)).toBeGreaterThan(0.6);
  });

  it('fades vector roads with zoom after the camera cell is replaced', () => {
    const jobs: RoadPolygonJob[] = [];
    const { map, layers } = createMap();
    const controller = createRoadPolygonController(map as never, {
      schedule: (job) => jobs.push(job),
    });
    controller.update();
    expect(map.setFilter).not.toHaveBeenCalled();
    expect(layers.get('global-roads')?.paint['line-opacity']).toBeUndefined();
    const centerJob = jobs[0];
    expect(centerJob).toBeTruthy();
    centerJob.complete(buildRoadCellPolygons(centerJob.cell, centerJob.lines));
    expect(map.setFilter).not.toHaveBeenCalled();
    expect(layers.get('global-roads')?.paint['line-opacity']).toEqual(coveredVectorRoadOpacity(0.98));
    expect(layers.get('global-road-casing')?.paint['line-opacity']).toEqual(coveredVectorRoadOpacity(0.78));
    expect(layers.get(ROAD_POLYGON_LAYER_ID)?.layout.visibility).toBe('visible');
    expect(layers.get(ROAD_POLYGON_LAYER_ID)?.paint['fill-opacity']).toEqual(roadPolygonFadeOpacity(1));
    expect(layers.get(ROAD_POLYGON_LAYER_ID)?.layout['fill-sort-key']).toBeDefined();
    expect(layers.get(ROAD_POLYGON_LAYER_ID)?.paint['fill-sort-key']).toBeUndefined();
    expect(layers.get(ROAD_POLYGON_CENTERLINE_LAYER_ID)?.layout.visibility).toBe('visible');
    expect(layers.get(ROAD_POLYGON_CENTERLINE_LAYER_ID)?.layout['line-sort-key']).toBeDefined();
    expect(layers.get(ROAD_POLYGON_CENTERLINE_LAYER_ID)?.paint['line-dasharray']).toEqual([3, 4]);
    expect(layers.get(ROAD_POLYGON_CENTERLINE_LAYER_ID)?.paint['line-opacity']).toEqual(roadPolygonCenterlineOpacity());
    expect(layers.get('global-road-center-markings')?.layout.visibility).toBe('none');
    expect((map.getSource('road-polygons') as { data: { features: unknown[] } }).data.features.length).toBeGreaterThan(0);
    expect((map.getSource('road-polygon-centerlines') as { data: { features: unknown[] } }).data.features.length).toBeGreaterThan(0);
    controller.dispose();
  });

  it('discards stale asynchronous cell results after a source invalidation', () => {
    const jobs: RoadPolygonJob[] = [];
    const { map, layers, setData } = createMap();
    const controller = createRoadPolygonController(map as never, {
      schedule: (job) => jobs.push(job),
    });
    controller.update();
    const firstWave = jobs.length;
    const stale = jobs[0];
    controller.invalidateSource();
    controller.update();
    const freshJobs = jobs.slice(firstWave);
    stale.complete(buildRoadCellPolygons(stale.cell, stale.lines));
    expect(layers.get('global-roads')?.paint['line-opacity']).toBeUndefined();
    const callsAfterStale = setData.mock.calls.length;
    for (const job of freshJobs) {
      job.complete(buildRoadCellPolygons(job.cell, job.lines));
    }
    expect(layers.get('global-roads')?.paint['line-opacity']).toEqual(coveredVectorRoadOpacity(0.98));
    expect(setData.mock.calls.length).toBeGreaterThan(callsAfterStale);
    const published = setData.mock.calls.filter((call) => call[0] === 'road-polygons').at(-1)?.[1] as { features: unknown[] };
    expect(published.features.length).toBeGreaterThan(0);
    controller.dispose();
  });

  it('restores original road opacity when zooming back out', () => {
    const { map, setZoom } = createMap();
    const controller = createRoadPolygonController(map as never, {
      schedule: (job) => job.complete(buildRoadCellPolygons(job.cell, job.lines)),
    });
    controller.update();
    expect(map.getLayer('global-roads')?.paint['line-opacity']).toEqual(coveredVectorRoadOpacity(0.98));
    setZoom(13);
    controller.update();
    expect(map.getLayer('global-roads')?.paint['line-opacity']).toEqual(uncoveredVectorRoadOpacity(0.98));
    expect(map.getLayer('global-road-casing')?.paint['line-opacity']).toEqual(uncoveredVectorRoadOpacity(0.78));
    expect(map.setFilter).toHaveBeenLastCalledWith('global-roads', expect.arrayContaining([
      ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
    ]));
    expect(map.getLayer(ROAD_POLYGON_LAYER_ID)?.layout.visibility).toBe('none');
    expect(map.getLayer(ROAD_POLYGON_FALLBACK_LAYER_ID)?.layout.visibility).toBe('none');
    expect(map.getLayer(ROAD_POLYGON_CENTERLINE_LAYER_ID)?.layout.visibility).toBe('none');
    expect(map.getLayer('global-road-center-markings')?.layout.visibility).toBe('visible');
    controller.dispose();
  });

  it('tears down on zoom events as soon as the camera leaves the exit zoom', () => {
    const { map, setZoom } = createMap();
    const controller = createRoadPolygonController(map as never, {
      schedule: (job) => job.complete(buildRoadCellPolygons(job.cell, job.lines)),
    });
    controller.update();
    expect(map.getLayer(ROAD_POLYGON_LAYER_ID)?.layout.visibility).toBe('visible');
    setZoom(ROAD_POLYGON_EXIT_ZOOM);
    controller.syncZoom();
    expect(map.getLayer(ROAD_POLYGON_LAYER_ID)?.layout.visibility).toBe('visible');
    setZoom(ROAD_POLYGON_EXIT_ZOOM - 0.01);
    controller.syncZoom();
    expect(map.getLayer('global-roads')?.paint['line-opacity']).toEqual(uncoveredVectorRoadOpacity(0.98));
    expect(map.getLayer(ROAD_POLYGON_LAYER_ID)?.layout.visibility).toBe('none');
    controller.dispose();
  });

  it('does not rebuild cached cells when only pitch would have changed', () => {
    const schedule = vi.fn((job: RoadPolygonJob) => job.complete(buildRoadCellPolygons(job.cell, job.lines)));
    const { map } = createMap();
    const controller = createRoadPolygonController(map as never, { schedule });
    controller.update();
    const first = schedule.mock.calls.length;
    controller.update();
    expect(schedule.mock.calls.length).toBe(first);
    controller.dispose();
  });
});
