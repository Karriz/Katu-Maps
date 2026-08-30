import { describe, expect, it } from 'vitest';
import { isDirectDigitransitItinerary, normalizeDigitransitRouteResults } from './DigitransitProvider';
import { normalizeTransitousRouteResults } from './TransitousProvider';

describe('transit route provider normalization', () => {
  it('rejects direct itineraries that contain a transit vehicle leg', () => {
    expect(isDirectDigitransitItinerary({ legs: [{ mode: 'WALK', transitLeg: false }] })).toBe(true);
    expect(isDirectDigitransitItinerary({ legs: [{ mode: 'BUS', transitLeg: true }] })).toBe(false);
  });

  it('retains Digitransit vehicle, walking, and route presentation fields', () => {
    const [result] = normalizeDigitransitRouteResults([{
      duration: 900,
      start: '2026-08-30T09:00:00Z',
      end: '2026-08-30T09:15:00Z',
      numberOfTransfers: 0,
      legs: [
        {
          mode: 'TRAM', transitLeg: true,
          distance: 4_200,
          from: { name: 'Start', lat: 61.49, lon: 23.76, stop: { gtfsId: 'digi:start' } },
          to: { name: 'Stop', lat: 61.50, lon: 23.77, stop: { gtfsId: 'digi:stop', parentStation: { gtfsId: 'digi:station' } } },
          route: { shortName: '3', color: '1769E8', textColor: 'FFFFFF' },
        },
        {
          mode: 'WALK', transitLeg: false,
          distance: 320,
          from: { name: 'Stop', lat: 61.50, lon: 23.77, stop: { gtfsId: 'digi:stop' } },
          to: { name: 'End', lat: 61.51, lon: 23.78 },
        },
      ],
    }]);

    expect(result.provider).toBe('digitransit');
    expect(result.transfers).toBe(0);
    expect(result.transitLegs).toMatchObject([
      {
        mode: 'TRAM', route: '3', routeColor: '1769E8', routeTextColor: 'FFFFFF', distanceMeters: 4_200,
        from: { name: 'Start', stopId: 'digi:start', coordinates: [23.76, 61.49] },
        to: { name: 'Stop', stopId: 'digi:stop', parentStopId: 'digi:station', coordinates: [23.77, 61.50] },
        provider: 'digitransit',
      },
      {
        mode: 'WALK', distanceMeters: 320,
        from: { name: 'Stop', stopId: 'digi:stop', coordinates: [23.77, 61.50] },
        to: { name: 'End', coordinates: [23.78, 61.51] },
        provider: 'digitransit',
      },
    ]);
  });

  it('retains Transitous vehicle, walking, and route presentation fields', () => {
    const [result] = normalizeTransitousRouteResults([{
      startTime: '2026-08-30T09:00:00Z',
      endTime: '2026-08-30T09:20:00Z',
      legs: [
        {
          mode: 'FOOT',
          distance: 275,
          from: { name: 'Start', lat: 52.5, lon: 13.4 },
          to: { name: 'Stop', stopId: 'transitous:stop', parentId: 'transitous:station', lat: 52.51, lon: 13.41 },
        },
        {
          mode: 'BUS', routeShortName: 'M4', routeColor: '#167052', routeTextColor: '#FFFFFF',
          from: { name: 'Stop', stopId: 'transitous:stop', lat: 52.51, lon: 13.41 },
          to: { name: 'End', stopId: 'transitous:end', lat: 52.52, lon: 13.42 },
        },
      ],
    }]);

    expect(result.provider).toBe('transitous');
    expect(result.transfers).toBe(0);
    expect(result.transitLegs).toMatchObject([
      {
        mode: 'FOOT', distanceMeters: 275,
        from: { name: 'Start', coordinates: [13.4, 52.5] },
        to: { name: 'Stop', stopId: 'transitous:stop', parentStopId: 'transitous:station', coordinates: [13.41, 52.51] },
        provider: 'transitous',
      },
      {
        mode: 'BUS', route: 'M4', routeColor: '#167052', routeTextColor: '#FFFFFF',
        from: { name: 'Stop', stopId: 'transitous:stop', coordinates: [13.41, 52.51] },
        to: { name: 'End', stopId: 'transitous:end', coordinates: [13.42, 52.52] },
        provider: 'transitous',
      },
    ]);
  });

  it('omits missing or invalid optional leg distances', () => {
    const [result] = normalizeTransitousRouteResults([{
      legs: [
        { mode: 'FOOT', distance: -1, from: { name: 'A', lat: 1, lon: 1 }, to: { name: 'B', lat: 2, lon: 2 } },
        { mode: 'BUS', from: { name: 'B', lat: 2, lon: 2 }, to: { name: 'C', lat: 3, lon: 3 } },
      ],
    }]);

    expect(result.transitLegs.map((leg) => leg.distanceMeters)).toEqual([undefined, undefined]);
  });
});
