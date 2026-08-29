import { describe, expect, it, vi } from 'vitest';
import { DistanceMeasurement, formatMeasuredDistance, geodesicDistanceMetres } from './DistanceMeasurement';

describe('distance measurement', () => {
  it('calculates known great-circle distances', () => {
    expect(geodesicDistanceMetres([0, 0], [1, 0])).toBeCloseTo(111_195, -1);
    expect(geodesicDistanceMetres([23.7609, 61.4981], [24.9384, 60.1699])).toBeCloseTo(160_900, -3);
  });

  it('formats metres and kilometres with useful precision', () => {
    expect(formatMeasuredDistance(42.4)).toBe('42 m');
    expect(formatMeasuredDistance(999.6)).toBe('1000 m');
    expect(formatMeasuredDistance(1_234)).toBe('1.23 km');
    expect(formatMeasuredDistance(12_340)).toBe('12.3 km');
    expect(formatMeasuredDistance(123_400)).toBe('123 km');
  });

  it('enters and leaves measurement mode without orphaning resources', () => {
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const layers = new Set<string>();
    const listeners = new Set<() => void>();
    const map = {
      addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
      addLayer: (layer: unknown) => layers.add((layer as { id: string }).id),
      getSource: (id: string) => sources.get(id),
      getLayer: (id: string) => layers.has(id),
      removeLayer: (id: string) => layers.delete(id),
      removeSource: (id: string) => sources.delete(id),
      on: (_event: 'move', listener: () => void) => listeners.add(listener),
      off: (_event: 'move', listener: () => void) => listeners.delete(listener),
      getCanvas: () => ({ clientWidth: 400, clientHeight: 200 }),
      unproject: () => ({ lng: 24, lat: 61 }),
    };
    const onUpdate = vi.fn();
    const measurement = new DistanceMeasurement(map, [23, 60], onUpdate);

    measurement.startMode();
    expect(sources.has('distance-measurement')).toBe(true);
    expect(layers.size).toBe(2);
    expect(listeners.size).toBe(1);
    expect(onUpdate).toHaveBeenCalledOnce();

    measurement.stop();
    expect(sources.size).toBe(0);
    expect(layers.size).toBe(0);
    expect(listeners.size).toBe(0);
  });
});
