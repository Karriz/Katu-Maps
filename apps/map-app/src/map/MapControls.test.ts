import { describe, expect, it } from 'vitest';
import { defaultMapLayerState, is3dModeEnabled, toggle3dModeLayers } from './MapControls';

describe('map layer 3D mode', () => {
  it('enables building colors and procedural details by default on desktop', () => {
    const layers = defaultMapLayerState(false);
    expect(layers.buildingColors).toBe(true);
    expect(layers.proceduralBuildingDetails).toBe(true);
    expect(is3dModeEnabled(layers)).toBe(true);
    expect(layers.locationIcons).toBe(true);
    expect(layers.labels).toBe(true);
  });

  it('disables building colors and procedural details by default on mobile', () => {
    const layers = defaultMapLayerState(true);
    expect(layers.buildingColors).toBe(false);
    expect(layers.proceduralBuildingDetails).toBe(false);
    expect(is3dModeEnabled(layers)).toBe(false);
  });

  it('turns building extras on with the 3D mode toggle and off again', () => {
    const enabled = toggle3dModeLayers(defaultMapLayerState(true));
    expect(enabled.buildingColors).toBe(true);
    expect(enabled.proceduralBuildingDetails).toBe(true);
    expect(is3dModeEnabled(enabled)).toBe(true);

    const disabled = toggle3dModeLayers(enabled);
    expect(disabled.buildingColors).toBe(false);
    expect(disabled.proceduralBuildingDetails).toBe(false);
    expect(is3dModeEnabled(disabled)).toBe(false);
  });
});
