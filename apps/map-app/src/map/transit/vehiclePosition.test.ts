import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/digitransit-vehicle-positions.json';
import { normalizeDigitransitVehicleObservations } from './DigitransitProvider';
import {
  beginObservedPositionTransition,
  LIVE_OBSERVATION_MAX_AGE_MS,
  matchLiveObservation,
  observedPositionAt,
  vehicleResponseIsCurrent,
  type VehiclePositionContext,
} from './vehiclePosition';

const now = Date.parse('2026-08-31T15:00:20Z');
const context: VehiclePositionContext = { ...fixture.selection, provider: 'digitransit' };

describe('normalized live vehicle observations', () => {
  it('matches one fresh Digitransit observation to the exact dated trip', () => {
    const observations = normalizeDigitransitVehicleObservations(fixture.positions);
    expect(matchLiveObservation(observations, context, now)).toMatchObject({
      tripId: 'tampere:exact-trip',
      serviceDate: '2026-08-31',
      coordinates: [23.7712, 61.4991],
    });
  });

  it('rejects stale, wrong-trip, wrong-date, and ambiguous observations', () => {
    const [live] = normalizeDigitransitVehicleObservations(fixture.positions);
    expect(matchLiveObservation([{ ...live, recordedAt: now - LIVE_OBSERVATION_MAX_AGE_MS - 1 }], context, now))
      .toBeUndefined();
    expect(matchLiveObservation([{ ...live, tripId: 'tampere:other-trip' }], context, now)).toBeUndefined();
    expect(matchLiveObservation([{ ...live, serviceDate: '2026-08-30' }], context, now)).toBeUndefined();
    expect(matchLiveObservation([live, { ...live, vehicleId: 'tampere:duplicate' }], context, now))
      .toBeUndefined();
    expect(matchLiveObservation([live], { ...context, serviceDate: undefined }, now)).toBeUndefined();
  });

  it('smooths to an observation and never extrapolates beyond it', () => {
    const [observation] = normalizeDigitransitVehicleObservations(fixture.positions);
    const transition = beginObservedPositionTransition([23.7, 61.4], observation, now, 5_000);
    expect(observedPositionAt(transition, now + 2_500)).toEqual([
      (23.7 + 23.7712) / 2,
      (61.4 + 61.4991) / 2,
    ]);
    expect(observedPositionAt(transition, now + 60_000)).toEqual(observation.coordinates);
  });

  it('rejects late responses from a previous departure or provider generation', () => {
    const current = { generation: 4, key: 'current:digitransit:tampere:new:2026-08-31:15:10' };
    expect(vehicleResponseIsCurrent(current, current)).toBe(true);
    expect(vehicleResponseIsCurrent({ ...current, key: 'current:digitransit:tampere:old:2026-08-31:15:00' }, current))
      .toBe(false);
    expect(vehicleResponseIsCurrent({ ...current, generation: 3 }, current)).toBe(false);
  });
});
