import { describe, expect, it } from 'vitest';
import { applyDayNightStyle } from './DayNightStyle';
import { dayNightAppearance } from './DayNightAppearance';
import { GLOBAL_MAP_STYLE } from './GlobalMapStyle';

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
      expect.arrayContaining(['case']),
    );
  });
});
