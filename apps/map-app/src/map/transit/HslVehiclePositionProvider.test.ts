import { describe, expect, it } from 'vitest';
import { normalizeHslPosition } from './HslVehiclePositionProvider';

const identity = {
  provider: 'digitransit' as const, tripId: 'HSL:trip', routeId: 'HSL:4711K', directionId: '0',
  serviceDate: '2026-09-20', scheduledStartTime: '2026-09-20T20:15:00Z',
};
const payload = { VP: {
  route: '4711K', dir: '1', start: '23:15', oday: '2026-09-20',
  tst: '2026-09-20T20:26:06.750Z', lat: 60.202036, long: 24.963843, hdg: 33, veh: 2619,
} };

describe('HSL vehicle positions', () => {
  it('normalizes an exact HFP journey position', () => {
    expect(normalizeHslPosition(payload, identity)).toEqual([{
      provider: 'digitransit', tripId: 'HSL:trip', serviceDate: '2026-09-20',
      coordinates: [24.963843, 60.202036], recordedAt: Date.parse('2026-09-20T20:26:06.750Z'),
      heading: 33, vehicleId: '2619',
    }]);
  });

  it('rejects a wrong direction, operating day, or scheduled start', () => {
    expect(normalizeHslPosition({ VP: { ...payload.VP, dir: '2' } }, identity)).toEqual([]);
    expect(normalizeHslPosition({ VP: { ...payload.VP, oday: '2026-09-19' } }, identity)).toEqual([]);
    expect(normalizeHslPosition({ VP: { ...payload.VP, start: '23:16' } }, identity)).toEqual([]);
  });
});
