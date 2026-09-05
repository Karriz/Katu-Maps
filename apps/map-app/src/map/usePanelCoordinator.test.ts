import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldPreserveRouteVehicleForInfoPanel, usePanelCoordinator } from './usePanelCoordinator';

describe('panel coordinator route preservation', () => {
  it('preserves routed vehicles only for visible desktop routes', () => {
    expect(shouldPreserveRouteVehicleForInfoPanel(1280, true)).toBe(true);
    expect(shouldPreserveRouteVehicleForInfoPanel(760, true)).toBe(false);
    expect(shouldPreserveRouteVehicleForInfoPanel(1280, false)).toBe(false);
  });
});

describe('position information marker lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the marker at the coordinates owned by the open position panel', () => {
    vi.stubGlobal('window', { innerWidth: 1280 });
    const setContextMenuMarker = vi.fn();
    const closeWeatherPanel = vi.fn();
    const coordinator = usePanelCoordinator({
      routeVehicleViewRef: { current: false },
      routeResultRef: { current: null },
      vehicleFollowEnabledRef: { current: true },
      vehicleFollowingRef: { current: false },
      setVehicleFollowing: vi.fn(),
      setVehicleFollowAvailable: vi.fn(),
      transitStopsLayerRef: { current: null },
      setContextMenuMarker,
      closePositionInformation: vi.fn(),
      setPositionInformation: vi.fn(),
      clearLocationSelection: vi.fn(),
      setSelectedTransitStop: vi.fn(),
      trafficCamerasLayerRef: { current: null },
      setSelectedTrafficCamera: vi.fn(),
      chargingStationsLayerRef: { current: null },
      setSelectedChargingStation: vi.fn(),
      roadWeatherLayerRef: { current: null },
      setSelectedRoadWeather: vi.fn(),
      roadTrafficLayerRef: { current: null },
      setSelectedRoadTraffic: vi.fn(),
      setSelectedRoadTrafficMessage: vi.fn(),
      closeWeatherPanel,
      cancelRoute: vi.fn(),
      rememberRouteVehicle: vi.fn(),
    });

    coordinator.openPositionInformation({
      coordinates: [23.1, 61.2],
      elevation: { status: 'loading' },
      address: { status: 'loading' },
    });
    expect(setContextMenuMarker).toHaveBeenLastCalledWith([23.1, 61.2]);

    coordinator.openPositionInformation({
      coordinates: [24.3, 62.4],
      elevation: { status: 'loading' },
      address: { status: 'loading' },
    });
    expect(setContextMenuMarker).toHaveBeenLastCalledWith([24.3, 62.4]);
    expect(closeWeatherPanel).toHaveBeenCalled();
  });
});
