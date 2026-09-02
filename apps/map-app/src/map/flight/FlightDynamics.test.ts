import { describe, expect, it } from 'vitest';
import {
  FLIGHT_MIN_CLEARANCE_METERS,
  FLIGHT_CRUISE_SPEED_METERS_PER_SECOND,
  FLIGHT_STALL_SPEED_METERS_PER_SECOND,
  advanceFlight,
  createInitialFlightState,
  flightCameraPose,
  offsetCoordinate,
  wrapSignedRadians,
} from './FlightDynamics';

describe('flight dynamics', () => {
  it('moves north at cruise speed with neutral controls', () => {
    const initial = createInitialFlightState([23.7609, 61.4981], 100, 0);
    const next = advanceFlight(initial, { pitch: 0, roll: 0, throttle: 0 }, 0.05, 100);
    expect(initial.speed).toBe(FLIGHT_CRUISE_SPEED_METERS_PER_SECOND);
    expect(initial.throttle).toBe(0.75);
    expect(next.latitude).toBeGreaterThan(initial.latitude);
    expect(next.longitude).toBeCloseTo(initial.longitude, 8);
    expect(next.altitude).toBeCloseTo(initial.altitude, 8);
  });

  it('banks into a turn and climbs when commanded', () => {
    let state = createInitialFlightState([0, 0], 0, 0);
    for (let index = 0; index < 10; index += 1) {
      state = advanceFlight(state, { pitch: 1, roll: 1, throttle: 0 }, 0.05, 0);
    }
    expect(state.heading).toBeGreaterThan(0);
    expect(state.longitude).toBeGreaterThan(0);
    expect(state.altitude).toBeGreaterThan(180);
    expect(state.pitch).toBeGreaterThan(0);
    expect(state.roll).toBeGreaterThan(0);
  });

  it('pitches horizontally along heading when banked 90 degrees sideways', () => {
    const sidewaysState = {
      ...createInitialFlightState([0, 0], 0, 0),
      heading: Math.PI,
      roll: Math.PI / 2, // 90 degrees right wing down
    };
    const pitchedRight = advanceFlight(sidewaysState, { pitch: 1, roll: 0, throttle: 0 }, 0.05, 0);
    expect(pitchedRight.heading).toBeGreaterThan(Math.PI);

    const pitchedLeft = advanceFlight(sidewaysState, { pitch: -1, roll: 0, throttle: 0 }, 0.05, 0);
    expect(pitchedLeft.heading).toBeLessThan(Math.PI);
  });

  it('adjusts throttle and airspeed accordingly', () => {
    const initial = createInitialFlightState([0, 0], 0, 0);
    let fullThrottleState = initial;
    for (let index = 0; index < 20; index += 1) {
      fullThrottleState = advanceFlight(fullThrottleState, { pitch: 0, roll: 0, throttle: 1 }, 0.05, 0);
    }
    expect(fullThrottleState.throttle).toBeGreaterThan(0.75);
    expect(fullThrottleState.speed).toBeGreaterThan(initial.speed);

    let idleThrottleState = initial;
    for (let index = 0; index < 20; index += 1) {
      idleThrottleState = advanceFlight(idleThrottleState, { pitch: 0, roll: 0, throttle: -1 }, 0.05, 0);
    }
    expect(idleThrottleState.throttle).toBeLessThan(0.75);
    expect(idleThrottleState.speed).toBeLessThan(initial.speed);
  });

  it('decelerates in steep climbs and accelerates in dives', () => {
    const initial = createInitialFlightState([0, 0], 0, 0);
    let climbingState = initial;
    for (let index = 0; index < 10; index += 1) {
      climbingState = advanceFlight(climbingState, { pitch: 1, roll: 0, throttle: 0 }, 0.05, 0);
    }
    expect(climbingState.speed).toBeLessThan(initial.speed);

    let divingState = initial;
    for (let index = 0; index < 10; index += 1) {
      divingState = advanceFlight(divingState, { pitch: -1, roll: 0, throttle: 0 }, 0.05, 0);
    }
    expect(divingState.speed).toBeGreaterThan(initial.speed);
  });

  it('triggers stall warning and sinks at low airspeed', () => {
    const lowSpeedState = {
      ...createInitialFlightState([0, 0], 0, 0),
      speed: FLIGHT_STALL_SPEED_METERS_PER_SECOND - 5,
      throttle: 0.1,
    };
    const next = advanceFlight(lowSpeedState, { pitch: 0, roll: 0, throttle: 0 }, 0.05, 0);
    expect(next.isStalling).toBe(true);
    expect(next.altitude).toBeLessThan(lowSpeedState.altitude);
  });

  it('holds pitch and roll after controls are released', () => {
    let state = createInitialFlightState([0, 0], 0, 0);
    for (let index = 0; index < 20; index += 1) {
      state = advanceFlight(state, { pitch: 1, roll: 0, throttle: 0 }, 0.05, 0);
    }
    const controlledPitch = state.pitch;
    for (let index = 0; index < 40; index += 1) {
      state = advanceFlight(state, { pitch: 0, roll: 0, throttle: 0 }, 0.05, 0);
    }
    expect(state.pitch).toBeCloseTo(controlledPitch, 10);
    expect(state.roll).toBeCloseTo(0, 10);
  });

  it('can complete a full loop', () => {
    const initial = createInitialFlightState([0, 0], 0, 0);
    let state = initial;
    let maximumAltitude = state.altitude;
    for (let index = 0; index < 200; index += 1) {
      state = advanceFlight(state, { pitch: 1, roll: 0, throttle: 0 }, 0.05, 0);
      maximumAltitude = Math.max(maximumAltitude, state.altitude);
    }
    expect(state.pitch).toBeCloseTo(0, 10);
    expect(state.latitude).toBeCloseTo(initial.latitude, 2);
    expect(maximumAltitude).toBeGreaterThan(initial.altitude + 100);
  });

  it('can pass through inverted flight and complete a barrel roll', () => {
    let state = createInitialFlightState([0, 0], 0, 0);
    let maximumAbsoluteRoll = 0;
    for (let index = 0; index < 60; index += 1) {
      state = advanceFlight(state, { pitch: 0, roll: 1, throttle: 0 }, 0.05, 0);
      maximumAbsoluteRoll = Math.max(maximumAbsoluteRoll, Math.abs(state.roll));
    }
    expect(maximumAbsoluteRoll).toBeGreaterThan(Math.PI * 0.95);
    expect(state.roll).toBeCloseTo(0, 1);
    expect(wrapSignedRadians(state.heading)).toBeCloseTo(0, 2);
  });

  it('clamps clearance and unusually large frame intervals', () => {
    const initial = { ...createInitialFlightState([0, 0], 0, 0), altitude: 1 };
    const longFrame = advanceFlight(initial, { pitch: -1, roll: 0, throttle: 0 }, 10, 250);
    const normalFrame = advanceFlight(initial, { pitch: -1, roll: 0, throttle: 0 }, 0.05, 250);
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

