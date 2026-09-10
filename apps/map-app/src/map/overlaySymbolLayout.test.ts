import { describe, expect, it } from 'vitest';
import { overlayIconCollisionLayout, setLayerTextVisible, syncIconLabelZoomBands } from './overlaySymbolLayout';

describe('overlay symbol decluttering', () => {
  it('keeps overlay icons from overlapping while tightening padding at street scale', () => {
    const layout = overlayIconCollisionLayout();
    expect(layout['icon-allow-overlap']).toBe(false);
    expect(layout['icon-ignore-placement']).toBe(false);
    expect(layout['icon-padding']).toEqual([
      'interpolate', ['linear'], ['zoom'],
      8, 18,
      13, 14,
      15, 6,
      16.5, 1.5,
      17.5, 0.5,
    ]);
  });

  it('extends icon zoom when labels are hidden and restores text fields', () => {
    const zoomRanges: Array<[string, number, number]> = [];
    const textFields: Record<string, unknown> = { 'favorite-icons': ['get', 'name'] };
    const map = {
      getLayer: (id: string) => id === 'location-poi-icons' || id === 'favorite-icons' ? {} : undefined,
      setLayerZoomRange: (id: string, minzoom: number, maxzoom: number) => { zoomRanges.push([id, minzoom, maxzoom]); },
      getLayoutProperty: (id: string, property: string) => property === 'text-field' ? textFields[id] : undefined,
      setLayoutProperty: (id: string, property: string, value: unknown) => {
        if (property === 'text-field') textFields[id] = value;
      },
    };
    syncIconLabelZoomBands(map as never, false);
    expect(zoomRanges).toContainEqual(['location-poi-icons', 14, 24]);
    setLayerTextVisible(map as never, ['favorite-icons'], false);
    expect(textFields['favorite-icons']).toBe('');
    setLayerTextVisible(map as never, ['favorite-icons'], true);
    expect(textFields['favorite-icons']).toEqual(['get', 'name']);
  });
});
