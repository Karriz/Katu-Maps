import { describe, expect, it } from 'vitest';
import { elevationResult, formatCoordinates, formatElevation } from './PositionInformation';

describe('position information', () => {
  it('formats latitude and longitude with sensible precision', () => {
    expect(formatCoordinates([23.76087654, 61.49812345])).toBe('61.498123, 23.760877');
  });

  it('represents missing and invalid elevation as unavailable', () => {
    expect(elevationResult(null)).toEqual({ status: 'unavailable' });
    expect(elevationResult(Number.NaN)).toEqual({ status: 'unavailable' });
  });

  it('keeps valid zero and negative elevations', () => {
    expect(elevationResult(0)).toEqual({ status: 'available', metres: 0 });
    expect(elevationResult(-12.4)).toEqual({ status: 'available', metres: -12.4 });
    expect(formatElevation(-12.4)).toBe('-12 m above mean sea level');
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
