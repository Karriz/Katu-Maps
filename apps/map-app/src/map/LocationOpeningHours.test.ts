import { describe, expect, it } from 'vitest';
import { locationOpenState } from './LocationOpeningHours';

describe('locationOpenState', () => {
  it('parses common OSM opening_hours values', () => {
    const helsinki: [number, number] = [24.94, 60.17];
    expect(locationOpenState('24/7', helsinki, new Date('2026-01-05T12:00:00Z'))).toBe('open');
    expect(locationOpenState('Mo-Fr 09:00-17:00', helsinki, new Date('2026-01-05T18:00:00Z'))).toBe('closed');
  });

  it("uses the location's time zone rather than the viewer's", () => {
    const now = new Date('2026-01-05T12:00:00Z');
    expect(locationOpenState('Mo 13:00-15:00', [24.94, 60.17], now)).toBe('open');
    expect(locationOpenState('Mo 13:00-15:00', [-74.01, 40.71], now)).toBe('closed');
  });

  it('does not claim a state for invalid or unknown values', () => {
    expect(locationOpenState('not valid opening hours', [24.94, 60.17])).toBeNull();
    expect(locationOpenState('Mo 09:00-17:00 unknown', [24.94, 60.17], new Date('2026-01-05T12:00:00Z'))).toBeNull();
  });
});
