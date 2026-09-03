import { describe, expect, it, vi } from 'vitest';
import { restoreFlightPresentation, restoreTransitOverlay, shouldHideLayerInFlight } from './useFlightModePresentation';

describe('flight presentation', () => {
  it('hides map POIs, transit, and application overlays', () => {
    expect(shouldHideLayerInFlight({ id: 'global-poi-labels', type: 'symbol' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'transit-stop-icons', type: 'symbol' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'favorite-icons', type: 'symbol' } as any)).toBe(true);
  });

  it('keeps the aircraft, trees, and ordinary cartography visible', () => {
    expect(shouldHideLayerInFlight({ id: 'flight-aircraft-model-3d', type: 'custom' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'tree-models-3d', type: 'custom' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'tree-points', type: 'circle' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'global-road-labels', type: 'symbol' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'global-buildings-3d', type: 'fill-extrusion' } as any)).toBe(false);
  });

  it('restores remaining hidden layers when one restore step fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const map = {
      getLayer: (id: string) => id === 'global-poi-labels' || id === 'favorite-icons' ? {} : undefined,
      setLayoutProperty: vi.fn((id: string) => {
        if (id === 'global-poi-labels') throw new Error('poi restore failed');
      }),
      triggerRepaint: vi.fn(),
      getBounds: () => ({ west: 23, south: 61, east: 24, north: 62 }),
      getZoom: () => 14,
    };
    const overlay = {
      setVisibility: vi.fn(),
      update: vi.fn(),
    };

    restoreFlightPresentation(
      map as any,
      new Map([['global-poi-labels', true], ['favorite-icons', true]]),
      overlay as any,
      true,
    );

    expect(map.setLayoutProperty).toHaveBeenCalledWith('favorite-icons', 'visibility', 'visible');
    expect(overlay.setVisibility).toHaveBeenCalledWith(true);
    expect(map.triggerRepaint).toHaveBeenCalled();
    error.mockRestore();
  });

  it('refreshes enabled transit lines after flight mode', () => {
    const overlay = {
      setVisibility: vi.fn(),
      update: vi.fn(),
    };
    const bounds = { west: 23, south: 61, east: 24, north: 62 };
    const map = {
      getBounds: () => bounds,
      getZoom: () => 14,
    };

    restoreTransitOverlay(overlay as any, map as any, true);

    expect(overlay.setVisibility).toHaveBeenCalledWith(true);
    expect(overlay.update).toHaveBeenCalledWith(bounds, 14);
  });
});
