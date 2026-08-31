import { describe, expect, it } from 'vitest';
import type { TransitRouteResult } from './types';
import { resolveJourneyVehicleLegs } from './journeyVehicles';

type Leg = TransitRouteResult['transitLegs'][number];
const at = (minutes: number) => new Date(Date.UTC(2026, 7, 31, 12, minutes)).toISOString();
const leg = (mode: string, start: number, end: number, tripId?: string, provider: Leg['provider'] = 'digitransit'): Leg => ({
  mode, tripId, provider, startTime: at(start), endTime: at(end),
});

describe('routed journey vehicle resolution', () => {
  const legs = [
    leg('WALK', 0, 5),
    leg('TRAM', 7, 20, 'tram-1'),
    leg('WALK', 20, 25),
    leg('BUS', 28, 45, 'bus-2', 'transitous'),
  ];

  it('shows the first transit leg as current and the following leg as subdued at journey start', () => {
    expect(resolveJourneyVehicleLegs(legs, Date.parse(at(3)))).toMatchObject({
      current: { tripId: 'tram-1' },
      next: { tripId: 'bus-2' },
    });
    expect(resolveJourneyVehicleLegs(legs, Date.parse(at(6)))).toMatchObject({
      current: { tripId: 'tram-1' },
      next: { tripId: 'bus-2' },
    });
  });

  it('resolves current and next across multiple transit legs and providers', () => {
    const result = resolveJourneyVehicleLegs(legs, Date.parse(at(10)));
    expect(result.current?.tripId).toBe('tram-1');
    expect(result.current?.provider).toBe('digitransit');
    expect(result.next?.tripId).toBe('bus-2');
    expect(result.next?.provider).toBe('transitous');
  });

  it('moves through the transfer walk without retaining the previous vehicle', () => {
    const result = resolveJourneyVehicleLegs(legs, Date.parse(at(23)));
    expect(result.current).toBeUndefined();
    expect(result.next?.tripId).toBe('bus-2');
  });

  it('returns no vehicle after the journey', () => {
    expect(resolveJourneyVehicleLegs(legs, Date.parse(at(50)))).toEqual({ next: undefined });
  });
});
