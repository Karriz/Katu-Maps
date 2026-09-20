import { describe, expect, it } from 'vitest';
import {
  normalizeNysseVehicleObservations,
  nysseJourneyReference,
} from './NysseVehiclePositionProvider';

const identity = {
  provider: 'digitransit' as const,
  tripId: 'tampere:131_20801_18494554',
  serviceDate: '2026-09-20',
  routeId: 'tampere:13',
  directionId: '0',
  scheduledStartTime: '2026-09-20T16:30:00Z',
};

function activity(overrides: Record<string, unknown> = {}) {
  return {
    RecordedAtTime: Date.parse('2026-09-20T17:11:55Z'),
    MonitoredVehicleJourney: {
      LineRef: { value: '13' },
      DirectionRef: { value: '0' },
      FramedVehicleJourneyRef: {
        DataFrameRef: { value: '2026-09-20' },
        DatedVehicleJourneyRef: '1930',
      },
      VehicleLocation: { Longitude: 23.7713833, Latitude: 61.4996986 },
      Bearing: 344,
      VehicleRef: { value: 'fixture-vehicle' },
      ...overrides,
    },
  };
}

function payload(activities: ReturnType<typeof activity>[]) {
  return {
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [{ VehicleActivity: activities }],
      },
    },
  };
}

describe('Nysse vehicle positions', () => {
  it('converts scheduled instants to Helsinki service-day journey references', () => {
    expect(nysseJourneyReference('2026-09-20T16:30:00Z', '2026-09-20')).toBe('1930');
    expect(nysseJourneyReference('2026-09-20T21:30:00Z', '2026-09-20')).toBe('2430');
  });

  it('normalizes one exact dated journey observation', () => {
    expect(normalizeNysseVehicleObservations(payload([activity()]), identity)).toEqual([{
      provider: 'digitransit',
      tripId: identity.tripId,
      serviceDate: identity.serviceDate,
      coordinates: [23.7713833, 61.4996986],
      recordedAt: Date.parse('2026-09-20T17:11:55Z'),
      heading: 344,
      vehicleId: 'fixture-vehicle',
    }]);
  });

  it('rejects wrong-direction and ambiguous journeys', () => {
    expect(normalizeNysseVehicleObservations(payload([
      activity({ DirectionRef: { value: '1' } }),
    ]), identity)).toEqual([]);
    expect(normalizeNysseVehicleObservations(payload([activity(), activity()]), identity)).toEqual([]);
  });

  it('requires the complete cross-feed identity', () => {
    expect(normalizeNysseVehicleObservations(payload([activity()]), {
      ...identity,
      directionId: undefined,
    })).toEqual([]);
  });
});
