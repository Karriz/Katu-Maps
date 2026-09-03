import { describe, expect, it } from 'vitest';
import {
  flightInputForControlSources,
  flightSkyForTheme,
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

describe('flight sky', () => {
  it('replaces the night sky instead of keeping dark-mode colors in light mode', () => {
    const night = flightSkyForTheme('dark');
    const day = flightSkyForTheme('light');

    expect(night['sky-color']).toBe('#071525');
    expect(day['sky-color']).toBe('#7ec8ea');
    expect(day['horizon-color']).not.toBe(night['horizon-color']);
    expect(day['fog-color']).not.toBe(night['fog-color']);
  });
});
