import { describe, expect, it } from 'vitest';
import {
  FLIGHT_MIN_CLEARANCE_METERS,
  advanceFlight,
  createInitialFlightState,
  flightCameraPose,
  offsetCoordinate,
} from './FlightDynamics';

describe('flight dynamics', () => {
  it('moves north at a fixed cruise speed with neutral controls', () => {
    const initial = createInitialFlightState([23.7609, 61.4981], 100, 0);
    const next = advanceFlight(initial, { pitch: 0, roll: 0 }, 0.05, 100);
    expect(next.latitude).toBeGreaterThan(initial.latitude);
    expect(next.longitude).toBeCloseTo(initial.longitude, 8);
    expect(next.altitude).toBeCloseTo(initial.altitude, 8);
  });

  it('banks into a turn and climbs when commanded', () => {
    let state = createInitialFlightState([0, 0], 0, 0);
    for (let index = 0; index < 80; index += 1) {
      state = advanceFlight(state, { pitch: 1, roll: 1 }, 0.05, 0);
    }
    expect(state.heading).toBeGreaterThan(0);
    expect(state.longitude).toBeGreaterThan(0);
    expect(state.altitude).toBeGreaterThan(180);
    expect(state.pitch).toBeGreaterThan(0);
    expect(state.roll).toBeGreaterThan(0);
  });

  it('auto-levels pitch and roll after controls are released', () => {
    let state = createInitialFlightState([0, 0], 0, 0);
    for (let index = 0; index < 20; index += 1) {
      state = advanceFlight(state, { pitch: 1, roll: -1 }, 0.05, 0);
    }
    const controlledPitch = Math.abs(state.pitch);
    const controlledRoll = Math.abs(state.roll);
    for (let index = 0; index < 40; index += 1) {
      state = advanceFlight(state, { pitch: 0, roll: 0 }, 0.05, 0);
    }
    expect(Math.abs(state.pitch)).toBeLessThan(controlledPitch);
    expect(Math.abs(state.roll)).toBeLessThan(controlledRoll);
  });

  it('clamps clearance and unusually large frame intervals', () => {
    const initial = { ...createInitialFlightState([0, 0], 0, 0), altitude: 1 };
    const longFrame = advanceFlight(initial, { pitch: -1, roll: 0 }, 10, 250);
    const normalFrame = advanceFlight(initial, { pitch: -1, roll: 0 }, 0.05, 250);
    expect(longFrame).toEqual(normalFrame);
    expect(longFrame.altitude).toBe(250 + FLIGHT_MIN_CLEARANCE_METERS);
  });

  it('places the chase camera behind and above the aircraft', () => {
    const state = createInitialFlightState([0, 0], 0, 0);
    const camera = flightCameraPose(state);
    expect(camera.from[1]).toBeLessThan(state.latitude);
    expect(camera.target[1]).toBeGreaterThan(state.latitude);
    expect(camera.fromAltitude).toBeGreaterThan(state.altitude);
  });

  it('wraps coordinates across the antimeridian', () => {
    const moved = offsetCoordinate([179.9999, 0], 100, 0);
    expect(moved[0]).toBeLessThan(0);
  });
});
