import { describe, expect, it, vi } from 'vitest';
import {
  DistanceMeasurementController,
  formatDistance,
  geodesicDistance,
  MEASUREMENT_LAYER_IDS,
  MEASUREMENT_SOURCE_ID,
  pathDistance,
} from './DistanceMeasurement';

describe('distance measurement', () => {
  it('calculates known geodesic distances', () => {
    expect(geodesicDistance([0, 0], [1, 0])).toBeCloseTo(111_195, -1);
    expect(geodesicDistance([23.7609, 61.4981], [24.9384, 60.1699])).toBeCloseTo(160_700, -3);
  });

  it('formats metres and kilometres with useful precision', () => {
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1_234)).toBe('1.23 km');
    expect(formatDistance(12_340)).toBe('12.3 km');
    expect(formatDistance(123_400)).toBe('123 km');
  });

  it('adds map points and calculates the cumulative path distance', () => {
    let click: ((event: unknown) => void) | undefined;
    let renderedPointIndex: number | undefined;
    const source = { setData: vi.fn() };
    const layers = new Set<string>();
    const sources = new Set<string>();
    const canvas = { style: { cursor: '' } };
    const map = {
      addSource: (id: string) => sources.add(id),
      addLayer: (layer: { id: string }) => layers.add(layer.id),
      getSource: (id: string) => sources.has(id) ? source : undefined,
      getLayer: (id: string) => layers.has(id) ? {} : undefined,
      removeLayer: (id: string) => layers.delete(id),
      removeSource: (id: string) => sources.delete(id),
      queryRenderedFeatures: vi.fn(() => renderedPointIndex === undefined ? [] : [{ properties: { pointIndex: renderedPointIndex } }]),
      getCanvas: () => canvas,
      on: (event: string, layerOrListener: string | ((event: unknown) => void)) => {
        if (event === 'click' && typeof layerOrListener === 'function') click = layerOrListener;
      },
      off: vi.fn(),
    };
    const changed = vi.fn();
    const controller = new DistanceMeasurementController(map as never, [0, 0], changed);

    expect(changed).toHaveBeenLastCalledWith({ points: [[0, 0]], metres: 0 });
    click?.({ point: { x: 10, y: 10 }, lngLat: { lng: 1, lat: 0 } });
    click?.({ point: { x: 20, y: 20 }, lngLat: { lng: 1, lat: 1 } });
    expect(changed).toHaveBeenLastCalledWith({
      points: [[0, 0], [1, 0], [1, 1]],
      metres: expect.closeTo(pathDistance([[0, 0], [1, 0], [1, 1]])),
    });

    controller.undo();
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ points: [[0, 0], [1, 0]] }));

    renderedPointIndex = 0;
    click?.({ point: { x: 0, y: 0 }, lngLat: { lng: 0, lat: 0 } });
    expect(changed).toHaveBeenLastCalledWith({ points: [[1, 0]], metres: 0 });
    expect(source.setData).toHaveBeenCalledTimes(4);

    controller.dispose();
    expect(map.off).toHaveBeenCalledWith('click', expect.any(Function));
    expect(sources.has(MEASUREMENT_SOURCE_ID)).toBe(false);
    expect(MEASUREMENT_LAYER_IDS.some((id) => layers.has(id))).toBe(false);
  });
});
