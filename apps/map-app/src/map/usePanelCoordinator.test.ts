import { describe, expect, it } from 'vitest';
import { shouldPreserveRouteVehicleForInfoPanel } from './usePanelCoordinator';

describe('panel coordinator route preservation', () => {
  it('preserves routed vehicles only for visible desktop routes', () => {
    expect(shouldPreserveRouteVehicleForInfoPanel(1280, true)).toBe(true);
    expect(shouldPreserveRouteVehicleForInfoPanel(760, true)).toBe(false);
    expect(shouldPreserveRouteVehicleForInfoPanel(1280, false)).toBe(false);
  });
});
