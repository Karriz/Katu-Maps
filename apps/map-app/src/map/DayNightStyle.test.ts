import { describe, expect, it } from 'vitest';
import { applyDayNightStyle } from './DayNightStyle';
import { dayNightAppearance } from './DayNightAppearance';
import { applyMapTheme, GLOBAL_MAP_STYLE, pastelBuildingColor } from './GlobalMapStyle';

describe('day/night building colors', () => {
  it('reapplies OSM colors when toggled back on in the daylight palette', () => {
    const style = structuredClone(GLOBAL_MAP_STYLE);
    const map = {
      getStyle: () => style,
      getLayer: (id: string) => style.layers.find((layer) => layer.id === id),
      setPaintProperty: (id: string, property: string, value: unknown) => {
        const layer = map.getLayer(id)!;
        layer.paint = { ...layer.paint, [property]: value } as never;
      },
      setLayoutProperty: () => undefined,
      getZoom: () => 16,
      getSky: () => style.sky,
      getLight: () => style.light,
      setSky: () => undefined,
      setLight: () => undefined,
    };
    const appearance = dayNightAppearance(new Date('2026-06-21T10:00:00Z'), 61.5, 23.76, 16);

    applyDayNightStyle(map as never, appearance, false);
    expect((map.getLayer('global-buildings')?.paint as any)['fill-extrusion-color']).toBe('#fffdf8');

    applyDayNightStyle(map as never, appearance, true);
    expect((map.getLayer('global-buildings')?.paint as any)['fill-extrusion-color']).toEqual(
      pastelBuildingColor('#fffdf8'),
    );
  });

  it('dims roads and bike paths at night without changing their day colors', () => {
    const style = structuredClone(GLOBAL_MAP_STYLE);
    const map = {
      getStyle: () => style,
      getLayer: (id: string) => style.layers.find((layer) => layer.id === id),
      setPaintProperty: (id: string, property: string, value: unknown) => {
        const layer = map.getLayer(id)!;
        layer.paint = { ...layer.paint, [property]: value } as never;
      },
      setLayoutProperty: () => undefined,
      getZoom: () => 16,
      getSky: () => style.sky,
      getLight: () => style.light,
      setSky: () => undefined,
      setLight: () => undefined,
    };
    applyMapTheme(map as never, 'light', { refresh: false });
    const paint = (id: string) => (map.getLayer(id)?.paint as Record<string, unknown>)?.['line-color'];
    const dayRoad = paint('global-roads');
    const dayCycleway = paint('global-cycleways');

    applyDayNightStyle(map as never, dayNightAppearance(new Date('2026-12-21T21:00:00Z'), 61.5, 23.76, 16), false);
    expect(paint('global-roads')).toBe('#a99a75');
    expect(paint('global-cycleways')).toBe('#a58a82');
    expect(paint('global-cycling-path-casing')).toBe('#d8dfe1');

    applyMapTheme(map as never, 'light', { refresh: false });
    expect(paint('global-roads')).toEqual(dayRoad);
    expect(paint('global-cycleways')).toEqual(dayCycleway);
    applyMapTheme(map as never, 'dark', { refresh: false });
    expect(paint('global-roads')).toBe('#a99a75');
    expect(paint('global-cycleways')).toBe('#a58a82');
  });
});
