import { describe, expect, it, vi } from 'vitest';
import { restoreFlightPresentation, restoreTransitOverlay, shouldHideLayerInFlight } from './useFlightModePresentation';
import { GLOBAL_CYCLING_LAYER_IDS, GLOBAL_HIKING_LAYER_IDS } from '../GlobalMapStyle';
import { TRAFFIC_CAMERA_LAYER_IDS } from '../TrafficCamerasLayer';
import { CHARGING_STATION_LAYER_IDS } from '../ChargingStationsLayer';
import { ROAD_WEATHER_LAYER_IDS } from '../RoadWeatherLayer';
import { ROAD_TRAFFIC_LAYER_IDS } from '../RoadTrafficLayer';

describe('flight presentation', () => {
  it('hides map POIs, transit, and application overlays', () => {
    expect(shouldHideLayerInFlight({ id: 'global-poi-labels', type: 'symbol' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'transit-stop-icons', type: 'symbol' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'favorite-icons', type: 'symbol' } as any)).toBe(true);
  });

  it('hides enabled transit, driving, and bike-and-walk overlays', () => {
    expect(shouldHideLayerInFlight({ id: 'transit-bus-stop-icons', type: 'symbol' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'transit-route-overlay-lines', type: 'line' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'transit-vehicle-model-3d', type: 'custom' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'traffic-cameras-icons', type: 'symbol' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'charging-stations-dots', type: 'circle' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'road-weather-icons', type: 'symbol' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'road-traffic-message-lines', type: 'line' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'global-cycling-routes', type: 'line' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'global-hiking-routes', type: 'line' } as any)).toBe(true);
    expect(shouldHideLayerInFlight({ id: 'day-night-shade', type: 'custom' } as any)).toBe(true);
    for (const id of [
      ...TRAFFIC_CAMERA_LAYER_IDS,
      ...CHARGING_STATION_LAYER_IDS,
      ...ROAD_WEATHER_LAYER_IDS,
      ...ROAD_TRAFFIC_LAYER_IDS,
      ...GLOBAL_CYCLING_LAYER_IDS,
      ...GLOBAL_HIKING_LAYER_IDS,
    ]) {
      expect(shouldHideLayerInFlight({ id, type: 'line' } as any), id).toBe(true);
    }
  });

  it('keeps the aircraft, trees, and ordinary cartography visible', () => {
    expect(shouldHideLayerInFlight({ id: 'flight-aircraft-model-3d', type: 'custom' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'tree-models-3d', type: 'custom' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'tree-points', type: 'circle' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'global-road-labels', type: 'symbol' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'global-buildings-3d', type: 'fill-extrusion' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'global-local-transit-lines', type: 'line' } as any)).toBe(false);
    expect(shouldHideLayerInFlight({ id: 'global-roads', type: 'line' } as any)).toBe(false);
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
