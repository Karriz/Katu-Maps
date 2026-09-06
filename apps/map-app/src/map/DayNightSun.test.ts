import { describe, expect, it } from 'vitest';
import {
  dayNightPhase,
  julianDay,
  localMinutesAt,
  subsolarPoint,
  sunEcefDirection,
  sunPosition,
  utcMsFromLocalMinutes,
} from './DayNightSun';

describe('day/night sun model', () => {
  it('uses the Unix epoch as Julian day 2440587.5', () => {
    expect(julianDay(new Date(Date.UTC(1970, 0, 1)))).toBe(2_440_587.5);
  });

  it('places the subsolar point near the equator at the March equinox', () => {
    const point = subsolarPoint(new Date(Date.UTC(2024, 2, 20, 3, 6)));
    expect(point.latitude).toBeGreaterThan(-1.5);
    expect(point.latitude).toBeLessThan(1.5);
  });

  it('places the subsolar point near the tropic at the June solstice', () => {
    const point = subsolarPoint(new Date(Date.UTC(2024, 5, 20, 20, 51)));
    expect(point.latitude).toBeGreaterThan(22);
    expect(point.latitude).toBeLessThan(24.5);
  });

  it('puts Greenwich in daylight near 12:00 UTC at the equinox', () => {
    const noon = sunPosition(new Date(Date.UTC(2024, 2, 20, 12, 0)), 51.5, 0);
    expect(noon.elevation).toBeGreaterThan(35);
    expect(noon.azimuth).toBeGreaterThan(160);
    expect(noon.azimuth).toBeLessThan(200);
    expect(dayNightPhase(noon.elevation)).toBe('day');
  });

  it('puts Greenwich in night near 00:00 UTC at the equinox', () => {
    const midnight = sunPosition(new Date(Date.UTC(2024, 2, 20, 0, 0)), 51.5, 0);
    expect(midnight.elevation).toBeLessThan(-12);
    expect(dayNightPhase(midnight.elevation)).toBe('night');
  });

  it('keeps the ECEF sun vector on the unit sphere', () => {
    const [x, y, z] = sunEcefDirection(new Date(Date.UTC(2024, 5, 21, 12)));
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
  });

  it('moves UTC by the local-minute slider delta and wraps midnight', () => {
    const noon = Date.UTC(2024, 5, 21, 12, 0);
    expect(utcMsFromLocalMinutes(noon, 'UTC', 13 * 60)).toBe(noon + 60 * 60_000);
    expect(utcMsFromLocalMinutes(noon, 'UTC', 30)).toBe(noon - 11.5 * 60 * 60_000);
    expect(localMinutesAt(new Date(noon), 'UTC')).toBe(12 * 60);
  });
});
