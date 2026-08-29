import { describe, expect, it, vi } from 'vitest';
import { DistanceMeasurementController, formatDistance, geodesicDistance, MEASUREMENT_LAYER_IDS, MEASUREMENT_SOURCE_ID } from './DistanceMeasurement';

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

  it('updates from the map centre and removes every temporary resource', () => {
    let center: [number, number] = [0, 0];
    let move: (() => void) | undefined;
    const source = { setData: vi.fn() };
    const layers = new Set<string>();
    const sources = new Set<string>();
    const map = {
      getCenter: () => ({ toArray: () => center }),
      addSource: (id: string) => sources.add(id),
      addLayer: (layer: { id: string }) => layers.add(layer.id),
      getSource: (id: string) => sources.has(id) ? source : undefined,
      getLayer: (id: string) => layers.has(id) ? {} : undefined,
      removeLayer: (id: string) => layers.delete(id),
      removeSource: (id: string) => sources.delete(id),
      on: (_event: string, listener: () => void) => { move = listener; },
      off: vi.fn(),
    };
    const changed = vi.fn();
    const controller = new DistanceMeasurementController(map as never, [1, 1], changed);
    center = [2, 2];
    move?.();
    expect(source.setData).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ end: [2, 2] }));
    controller.dispose();
    expect(map.off).toHaveBeenCalledWith('move', expect.any(Function));
    expect(sources.has(MEASUREMENT_SOURCE_ID)).toBe(false);
    expect(MEASUREMENT_LAYER_IDS.some((id) => layers.has(id))).toBe(false);
  });
});
