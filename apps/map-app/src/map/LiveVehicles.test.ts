import { describe, expect, it } from 'vitest';
import { distanceToSegment, interpolateOnRoute, interpolatedCoordinates, normalizeDigitrafficFleet, normalizeFoliFleet, normalizeHslMessage, normalizeNysseFleet, routeSectionPoses, selectedLiveVehicleRoute, snapToGeometry, type LiveVehicle } from './LiveVehicles';

describe('live fleet normalization', () => {
  it('hit-tests along a detailed vehicle, not only at its GPS centre', () => {
    expect(distanceToSegment({ x: 90, y: 6 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(6);
    expect(distanceToSegment({ x: 130, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(30);
  });
  it('snaps only nearby GPS observations and bounds smoothing', () => {
    const route: [number, number][] = [[23, 61], [23.01, 61]];
    expect(snapToGeometry([23.005, 61.0001], route)?.[1]).toBeCloseTo(61);
    expect(snapToGeometry([23.005, 61.01], route)).toBeUndefined();
    expect(interpolatedCoordinates([23, 61], [24, 62], 0.5)).toEqual([23.5, 61.5]);
    expect(interpolatedCoordinates([23, 61], [24, 62], 2)).toEqual([24, 62]);
    expect(interpolateOnRoute([23, 61], [23.01, 61.01], [[23, 61], [23.01, 61], [23.01, 61.01]], 0.5)[0]).toBeCloseTo(23.01);
  });
  it('articulates sections around a route bend', () => {
    const geometry: [number, number][] = [[23, 61], [23.001, 61], [23.001, 61.001]];
    const poses = routeSectionPoses([23.001, 61], geometry, 3, 20);
    expect(poses[0].heading).toBeCloseTo(90);
    expect(poses[2].heading).toBeCloseTo(0);
  });
  it('shows only the selected trip geometry with its route color', () => {
    const vehicle: LiveVehicle = { id: 'hsl:1:2', provider: 'hsl', coordinates: [24.9, 60.2],
      recordedAt: 1, route: '1', kind: 'bus', color: '#123456', geometry: [[24.9, 60.2], [25, 60.3]] };
    expect(selectedLiveVehicleRoute(vehicle).features[0]).toMatchObject({
      geometry: { type: 'LineString', coordinates: vehicle.geometry }, properties: { color: '#123456' },
    });
    expect(selectedLiveVehicleRoute({ ...vehicle, geometry: undefined }).features).toEqual([]);
    expect(selectedLiveVehicleRoute(undefined).features).toEqual([]);
  });
  it('keeps Nysse vehicle identity, route, and destination', () => {
    const vehicles = normalizeNysseFleet({ Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{ VehicleActivity: [{
      RecordedAtTime: 1_790_014_501_219,
      MonitoredVehicleJourney: {
        LineRef: { value: '3' }, OperatorRef: { value: '56920' }, DestinationName: { value: 'Hervantajärvi' },
        VehicleLocation: { Longitude: 23.76, Latitude: 61.5 }, VehicleRef: { value: '56920_11' },
      },
    }] }] } } });
    expect(vehicles[0]).toMatchObject({ id: 'nysse:56920_11', route: '3', destination: 'Hervantajärvi', kind: 'tram' });
  });

  it('uses Föli onward calls for a selected vehicle', () => {
    const vehicles = normalizeFoliFleet({ result: { vehicles: { '221315': {
      longitude: 22.267, latitude: 60.451, recordedattime: 1_790_014_497,
      publishedlinename: '3', destinationname: 'Varissuo',
      onwardcalls: [{ stoppointname: 'Kauppatori', expectedarrivaltime: 1_790_014_620 }],
    } } } });
    expect(vehicles[0]).toMatchObject({ id: 'foli:221315', route: '3', stops: [{ name: 'Kauppatori' }] });
  });

  it('requires GPS coordinates for Digitraffic trains', () => {
    const feature = { geometry: { coordinates: [25, 61] }, properties: {
      trainNumber: 9, departureDate: '2026-09-21', timestamp: '2026-09-21T18:14:52Z', isGpsLocation: true,
    } };
    expect(normalizeDigitrafficFleet({ features: [feature] })[0]).toMatchObject({ id: 'digitraffic:2026-09-21:9', route: '9' });
    expect(normalizeDigitrafficFleet({ features: [{ ...feature, properties: { ...feature.properties, isGpsLocation: false } }] })).toEqual([]);
  });

  it('normalizes HSL positions and rejects malformed messages', () => {
    expect(normalizeHslMessage({ VP: { oper: 6, veh: 42, route: '550', long: 25, lat: 60, tst: '2026-09-21T18:14:52Z' } }))
      .toMatchObject({ id: 'hsl:6:42', route: '550' });
    expect(normalizeHslMessage({ VP: { route: '550' } })).toBeUndefined();
  });
});
