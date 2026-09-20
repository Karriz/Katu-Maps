import { describe, expect, it } from 'vitest';
import {
  digitrafficTrainNumber,
  normalizeDigitrafficTrainLocations,
} from './DigitrafficTrainPositionProvider';

const identity = {
  provider: 'digitransit' as const,
  mode: 'RAIL',
  tripId: 'digitraffic:11_20260920',
  serviceDate: '2026-09-20',
};

const location = {
  accuracy: 0,
  isGpsLocation: true,
  location: { type: 'Point', coordinates: [29.773321, 62.588159] },
  speed: 48,
  trainNumber: 11,
  departureDate: '2026-09-20',
  timestamp: '2026-09-20T20:15:43.000Z',
};

describe('Digitraffic train positions', () => {
  it('resolves the train number only from a matching dated rail trip', () => {
    expect(digitrafficTrainNumber(identity)).toBe(11);
    expect(digitrafficTrainNumber({ ...identity, mode: 'BUS' })).toBeUndefined();
    expect(digitrafficTrainNumber({ ...identity, serviceDate: '2026-09-21' })).toBeUndefined();
    expect(digitrafficTrainNumber({ ...identity, tripId: 'other:opaque-trip' })).toBeUndefined();
  });

  it('normalizes the matching GPS point', () => {
    expect(normalizeDigitrafficTrainLocations([location], identity)).toEqual([{
      provider: 'digitransit',
      tripId: identity.tripId,
      serviceDate: identity.serviceDate,
      coordinates: [29.773321, 62.588159],
      recordedAt: Date.parse('2026-09-20T20:15:43.000Z'),
      vehicleId: '11',
    }]);
  });

  it('rejects another departure date, train, or non-GPS point', () => {
    expect(normalizeDigitrafficTrainLocations([
      { ...location, departureDate: '2026-09-19' },
      { ...location, trainNumber: 12 },
      { ...location, isGpsLocation: false },
    ], identity)).toEqual([]);
  });
});
