import { describe, expect, it } from 'vitest';
import {
  flightInputForControlSources,
  setFlightControlSource,
  type FlightControlSources,
} from './useFlightSimulator';

describe('flight control sources', () => {
  it('keeps a control pressed until every physical source releases it', () => {
    const controls: FlightControlSources = new Map();
    setFlightControlSource(controls, 'throttleUp', 'keyboard:KeyR', true);
    setFlightControlSource(controls, 'throttleUp', 'pointer:1', true);

    setFlightControlSource(controls, 'throttleUp', 'keyboard:KeyR', false);
    expect(flightInputForControlSources(controls).throttle).toBe(1);

    setFlightControlSource(controls, 'throttleUp', 'pointer:1', false);
    expect(flightInputForControlSources(controls).throttle).toBe(0);
  });
});
