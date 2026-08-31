import { describe, expect, it } from 'vitest';
import { setMapLayerVisibility } from './useMapLayerVisibility';

describe('map layer visibility', () => {
  it('updates existing layers and ignores missing layers', () => {
    const updates: Array<[string, string, string]> = [];
    const map = {
      getLayer: (id: string) => id === 'roads' ? {} : undefined,
      setLayoutProperty: (id: string, property: 'visibility', value: 'visible' | 'none') => { updates.push([id, property, value]); },
    };
    setMapLayerVisibility(map, ['roads', 'missing'], false);
    setMapLayerVisibility(map, ['roads'], true);
    expect(updates).toEqual([
      ['roads', 'visibility', 'none'],
      ['roads', 'visibility', 'visible'],
    ]);
  });
});
