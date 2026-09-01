import { describe, expect, it } from 'vitest';
import { shouldHideLayerInFlight } from './useFlightModePresentation';

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
});
