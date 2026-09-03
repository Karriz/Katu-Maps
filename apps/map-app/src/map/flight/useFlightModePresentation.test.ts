import { describe, expect, it, vi } from 'vitest';
import { restoreTransitOverlay, shouldHideLayerInFlight } from './useFlightModePresentation';

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
