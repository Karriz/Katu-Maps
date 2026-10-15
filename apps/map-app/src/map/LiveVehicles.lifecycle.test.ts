import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MaplibreMap, Point } from 'maplibre-gl';
import { fetchWithTimeout } from './ApiRequest';
import { fetchLiveVehicles, LiveVehiclesLayer, type LiveVehicle } from './LiveVehicles';

const mqtt = vi.hoisted(() => ({ connectAsync: vi.fn() }));
vi.mock('mqtt', () => ({ default: mqtt }));
vi.mock('./ApiRequest', async (importOriginal) => ({
  ...await importOriginal<typeof import('./ApiRequest')>(),
  fetchWithTimeout: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('performance', { now: () => 1_000 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('live fleet lifecycle', () => {
  it('closes an HSL client whose subscription finishes after the layer is disabled', async () => {
    let finishSubscription!: () => void;
    const client = {
      on: vi.fn(),
      subscribeAsync: vi.fn(() => new Promise<void>((resolve) => { finishSubscription = resolve; })),
      endAsync: vi.fn().mockResolvedValue(undefined),
    };
    mqtt.connectAsync.mockResolvedValue(client);
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('Other providers unavailable'));
    const layer = new LiveVehiclesLayer(vi.fn());
    const request = fetchLiveVehicles({ west: 24.8, south: 60.1, east: 25, north: 60.3 }, 9);
    await vi.waitFor(() => expect(client.subscribeAsync).toHaveBeenCalledOnce());
    layer.setVisibility(false);
    finishSubscription();
    await request;
    expect(client.endAsync).toHaveBeenCalledOnce();
    layer.dispose();
    expect(client.endAsync).toHaveBeenCalledOnce();
  });

  it('clears the selected route and notifies the UI when its observation expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const payload = { Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{ VehicleActivity: [{
      RecordedAtTime: Date.now(),
      MonitoredVehicleJourney: {
        VehicleRef: { value: 'bus' }, PublishedLineName: { value: '10' },
        VehicleLocation: { Longitude: 23.8, Latitude: 61.5 },
      },
    }] }] } } };
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: true, json: async () => payload } as Response);
    const handlers = new Map<string, (event: { point: Point }) => void>();
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const map = {
      addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
      getSource: (id: string) => sources.get(id),
      getLayer: () => undefined,
      addLayer: vi.fn(),
      on: (event: string, callback: unknown) => {
        if (typeof callback === 'function') handlers.set(event, callback as (event: { point: Point }) => void);
      },
      getCenter: () => ({ lng: 23.8, lat: 61.5 }),
      getZoom: () => 9,
      project: () => ({ x: 100, y: 100 }),
    } as unknown as MaplibreMap;
    const onSelect = vi.fn((vehicle: LiveVehicle | null) => {
      if (vehicle) vehicle.geometry = [[23.8, 61.5], [23.81, 61.51]];
    });
    const layer = new LiveVehiclesLayer(onSelect);
    const routeDeck = { setFeatures: vi.fn(), setVisible: vi.fn() };
    layer.setRouteDeckLayer(routeDeck as unknown as Parameters<typeof layer.setRouteDeckLayer>[0]);
    layer.install(map);
    layer.setVisibility(true);
    const bounds = { west: 23.7, south: 61.4, east: 23.9, north: 61.6 };
    await layer.update(bounds, 9);
    handlers.get('click')!({ point: { x: 100, y: 100 } as Point });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'nysse:bus' }));
    expect(routeDeck.setVisible).toHaveBeenLastCalledWith(true);

    vi.setSystemTime(new Date('2026-10-15T12:01:31Z'));
    await layer.update(bounds, 9);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(sources.get('live-vehicle-selected-route')!.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    expect(routeDeck.setVisible).toHaveBeenLastCalledWith(false);
    layer.dispose();
  });
});
