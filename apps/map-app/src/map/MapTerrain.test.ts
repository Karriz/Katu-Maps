import { describe, expect, it, vi } from 'vitest';
import {
  shouldEnableTerrain3d,
  syncTerrain3d,
  TERRAIN_3D_DISABLE_ZOOM,
  TERRAIN_3D_ENABLE_ZOOM,
} from './MapTerrain';

describe('terrain 3d zoom gating', () => {
  it('keeps the mesh off at globe through mid-regional zooms', () => {
    expect(shouldEnableTerrain3d(true, 2.2, false)).toBe(false);
    expect(shouldEnableTerrain3d(true, 5.5, false)).toBe(false);
    expect(shouldEnableTerrain3d(true, 8, false)).toBe(false);
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_ENABLE_ZOOM - 0.01, false)).toBe(false);
  });

  it('turns the mesh on once the camera reaches city-region zooms', () => {
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_ENABLE_ZOOM, false)).toBe(true);
    expect(shouldEnableTerrain3d(true, 14, false)).toBe(true);
  });

  it('uses hysteresis so a zoom gesture does not toggle around the cutoff', () => {
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_ENABLE_ZOOM - 0.25, true)).toBe(true);
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_DISABLE_ZOOM, true)).toBe(true);
    expect(shouldEnableTerrain3d(true, TERRAIN_3D_DISABLE_ZOOM - 0.01, true)).toBe(false);
  });

  it('honours the user terrain toggle', () => {
    expect(shouldEnableTerrain3d(false, 16, true)).toBe(false);
  });

  it('does not call setTerrain when the mesh already matches the view', () => {
    const map = {
      getZoom: () => 2.2,
      getTerrain: () => null,
      setTerrain: vi.fn(),
    };
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(false);
    expect(map.setTerrain).not.toHaveBeenCalled();
  });

  it('enables and disables the mesh only when crossing the zoom gate', () => {
    const setTerrain = vi.fn();
    const map = {
      getZoom: () => 12,
      getTerrain: () => null as { source?: string } | null,
      setTerrain,
    };
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(true);
    expect(setTerrain).toHaveBeenCalledWith({ source: 'terrain', exaggeration: 1 });

    map.getTerrain = () => ({ source: 'terrain' });
    setTerrain.mockClear();
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(true);
    expect(setTerrain).not.toHaveBeenCalled();

    map.getZoom = () => 2.2;
    expect(syncTerrain3d(map, { userEnabled: true, source: 'terrain' })).toBe(false);
    expect(setTerrain).toHaveBeenCalledWith(null);
  });
});
