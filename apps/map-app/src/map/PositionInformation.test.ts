import { describe, expect, it } from 'vitest';
import { defaultPositionName, elevationResult, formatCoordinates, formatElevation, formatNominatimAddress, hasDisplayableElevation, parseCoordinates } from './PositionInformation';

describe('position information', () => {
  it('formats latitude and longitude with sensible precision', () => {
    expect(formatCoordinates([23.76087654, 61.49812345])).toBe('61.498123, 23.760877');
  });

  it('prefers an address as a saved position name and keeps coordinates as the fallback', () => {
    expect(defaultPositionName([23.76087654, 61.49812345], '  Yliopistonkatu 55  ')).toBe('Yliopistonkatu 55');
    expect(defaultPositionName([23.76087654, 61.49812345])).toBe('61.49812, 23.76088');
  });

  it.each([
    ['61.4981, 23.7609', [23.7609, 61.4981]],
    ['61.4981 23.7609', [23.7609, 61.4981]],
    ['geo:61.4981,23.7609', [23.7609, 61.4981]],
    ['61,4981 23,7609', [23.7609, 61.4981]],
    ['61.4981° N, 23.7609° E', [23.7609, 61.4981]],
    ['N 61.4981 E 23.7609', [23.7609, 61.4981]],
    ['23.7609, 121.4981', [121.4981, 23.7609]],
    ['121.4981, 23.7609', [121.4981, 23.7609]],
    [`61°29'53.16"N 23°45'39.24"E`, [23.7609, 61.4981]],
    [`61°29.886'N 23°45.654'E`, [23.7609, 61.4981]],
  ])('parses the common coordinate format %s', (input, expected) => {
    const coordinates = parseCoordinates(input);
    expect(coordinates?.[0]).toBeCloseTo(expected[0], 5);
    expect(coordinates?.[1]).toBeCloseTo(expected[1], 5);
  });

  it.each(['', 'Tampere', '181, 91', '61, 181', '61.5 N, 23.7 N', '61.5, 23.7, 10'])
  ('rejects non-coordinate or out-of-range input %s', (input) => {
    expect(parseCoordinates(input)).toBeUndefined();
  });

  it('formats a concise reverse-geocoded street address', () => {
    expect(formatNominatimAddress({
      address: { house_number: '55', road: 'Yliopistonkatu', postcode: '33100', city: 'Tampere' },
      display_name: 'A much longer fallback address',
    })).toBe('Yliopistonkatu 55, 33100 Tampere');
  });

  it('falls back to the geocoder display name when structured address parts are absent', () => {
    expect(formatNominatimAddress({ display_name: 'Pyynikinharju, Tampere, Finland' }))
      .toBe('Pyynikinharju, Tampere, Finland');
    expect(formatNominatimAddress(undefined)).toBeUndefined();
  });

  it('represents missing and invalid elevation as unavailable', () => {
    expect(elevationResult(null)).toEqual({ status: 'unavailable' });
    expect(elevationResult(Number.NaN)).toEqual({ status: 'unavailable' });
    expect(elevationResult(Number.POSITIVE_INFINITY)).toEqual({ status: 'unavailable' });
  });

  it('keeps valid zero and negative elevations', () => {
    expect(elevationResult(0)).toEqual({ status: 'available', metres: 0 });
    expect(elevationResult(-12.4)).toEqual({ status: 'available', metres: -12.4 });
    expect(formatElevation(-12.4)).toBe('-12 m above mean sea level');
  });

  it('only displays trustworthy elevation outside 2D mode', () => {
    expect(hasDisplayableElevation({ status: 'available', metres: 0 }, false)).toBe(false);
    expect(hasDisplayableElevation({ status: 'loading' }, true)).toBe(false);
    expect(hasDisplayableElevation({ status: 'unavailable' }, true)).toBe(false);
    expect(hasDisplayableElevation({ status: 'available', metres: 0 }, true)).toBe(true);
  });

  it('allows request identity to reject a stale asynchronous result', async () => {
    let activeRequest = 2;
    let elevation = elevationResult(null);
    const apply = (request: number, value: number) => {
      if (request === activeRequest) elevation = elevationResult(value);
    };
    await Promise.resolve().then(() => apply(1, 100));
    expect(elevation).toEqual({ status: 'unavailable' });
    apply(activeRequest, 25);
    expect(elevation).toEqual({ status: 'available', metres: 25 });
    activeRequest += 1;
  });
});
