import { describe, expect, it } from 'vitest';
import { normalizeFoliVehicleObservations } from './FoliVehiclePositionProvider';

const identity = {
  provider: 'digitransit' as const, tripId: 'FOLI:trip', routeId: 'FOLI:6', directionId: '0',
  serviceDate: '2026-09-20', scheduledStartTime: '2026-09-20T00:00:00.000Z',
};
const vehicle = {
  recordedattime: 1789866768, originaimeddeparturetime: 1789862400,
  __routeref: '6', __directionid: '0', longitude: 22.20475, latitude: 60.44878,
  vehicleref: '221308',
};

describe('Föli vehicle positions', () => {
  it('normalizes one exact SIRI journey position', () => {
    expect(normalizeFoliVehicleObservations({ result: { vehicles: { '221308': vehicle } } }, identity)).toEqual([{
      provider: 'digitransit', tripId: 'FOLI:trip', serviceDate: '2026-09-20',
      coordinates: [22.20475, 60.44878], recordedAt: 1789866768000, vehicleId: '221308',
    }]);
  });

  it('rejects mismatches and ambiguity', () => {
    expect(normalizeFoliVehicleObservations({ result: { vehicles: {
      one: vehicle, two: { ...vehicle, vehicleref: 'other' },
    } } }, identity)).toEqual([]);
    expect(normalizeFoliVehicleObservations({ result: { vehicles: {
      one: { ...vehicle, __directionid: '1' },
    } } }, identity)).toEqual([]);
  });
});
