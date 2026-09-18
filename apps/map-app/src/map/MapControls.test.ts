import { describe, expect, it } from 'vitest';
import { defaultMapLayerState, is3dModeEnabled, set2dModeLayers, set3dStyleLayers, toggle3dModeLayers } from './MapControls';

describe('map layer 3D mode', () => {
  it('uses simple 3D layers by default', () => {
    const layers = defaultMapLayerState();
    expect(layers.buildingColors).toBe(false);
    expect(layers.proceduralBuildingDetails).toBe(false);
    expect(is3dModeEnabled(layers)).toBe(true);
    expect(layers.locationIcons).toBe(true);
    expect(layers.labels).toBe(true);
  });

  it('turns building extras on with the 3D mode toggle and off again', () => {
    const disabled = toggle3dModeLayers(defaultMapLayerState());
    expect(disabled.buildingColors).toBe(false);
    expect(disabled.proceduralBuildingDetails).toBe(false);
    expect(is3dModeEnabled(disabled)).toBe(false);

    const enabled = toggle3dModeLayers(disabled);
    expect(enabled.buildingColors).toBe(true);
    expect(enabled.proceduralBuildingDetails).toBe(true);
    expect(is3dModeEnabled(enabled)).toBe(true);
  });

  it('supports simple and detailed 3D presets', () => {
    const simple = set3dStyleLayers(defaultMapLayerState(), 'simple');
    expect(is3dModeEnabled(simple)).toBe(true);
    expect(simple.buildingColors).toBe(false);
    expect(simple.proceduralBuildingDetails).toBe(false);

    const detailed = set3dStyleLayers(simple, 'detailed');
    expect(detailed.buildingColors).toBe(true);
    expect(detailed.proceduralBuildingDetails).toBe(true);
  });

  it('disables all 3D layers for the 2D preset', () => {
    const layers = set2dModeLayers(defaultMapLayerState());
    expect(is3dModeEnabled(layers)).toBe(false);
    expect(layers.buildings).toBe(false);
    expect(layers.terrain).toBe(false);
    expect(layers.proceduralBuildingDetails).toBe(false);
  });
});
