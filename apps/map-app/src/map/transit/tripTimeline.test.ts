import { describe, expect, it } from 'vitest';
import digitransit from './__fixtures__/digitransit-trip.json';
import transitous from './__fixtures__/transitous-trip.json';
import type { TransitProviderId, TransitTrip } from './types';
import { resolveSelectedTripResult, tripIsDisplayableAt } from './tripTimeline';

function resolve(fixture: typeof digitransit | typeof transitous, provider: TransitProviderId, overrides = {}) {
  return resolveSelectedTripResult(fixture.trip as TransitTrip, { tripId: fixture.selection.tripId, provider,
    serviceDate: fixture.selection.serviceDate, boardingStopId: fixture.selection.stopId,
    scheduledDeparture: fixture.selection.scheduledDeparture, ...overrides });
}

describe('selected trip identity resolution', () => {
  it('resolves delayed Digitransit by scheduled call rather than realtime clock', () => {
    const result = resolve(digitransit, 'digitransit');
    expect(result.ok && result.trip.boardingStopIndex).toBe(1);
  });
  it('rejects a previous same-line service through exact trip identity', () => {
    expect(resolve(digitransit, 'digitransit', { tripId: 'tampere:previous-trip' }))
      .toEqual({ ok: false, reason: 'trip-id-mismatch' });
  });
  it('matches a station selection to its child platform', () => {
    expect(resolve(digitransit, 'digitransit', { boardingStopId: 'tampere:station' }).ok).toBe(true);
  });
  it('selects a repeated occurrence by schedule and rejects ambiguity without it', () => {
    const loop = structuredClone(transitous);
    loop.trip.legs[0].intermediateStops.push({ ...loop.trip.legs[0].intermediateStops[0],
      scheduledArrival: '2026-08-29T09:10:00Z', scheduledDeparture: '2026-08-29T09:10:00Z' });
    expect(resolve(loop, 'transitous').ok).toBe(true);
    expect(resolve(loop, 'transitous', { scheduledDeparture: undefined }))
      .toEqual({ ok: false, reason: 'boarding-occurrence-ambiguous' });
  });
  it('supports schedule-only Transitous without inventing a service-date requirement', () => {
    const result = resolve(transitous, 'transitous', { serviceDate: undefined });
    expect(result.ok && result.trip.vehicleTimelineUsable).toBe(true);
  });
  it('keeps route calls when inconsistent realtime makes only vehicle estimation unsafe', () => {
    const partial = structuredClone(digitransit);
    partial.trip.legs[0].intermediateStops[0].departure = '2026-08-29T06:40:00Z';
    partial.trip.legs[0].intermediateStops[0].arrival = '2026-08-29T06:40:00Z';
    const result = resolve(partial, 'digitransit');
    expect(result.ok && result.trip.stops).toHaveLength(3);
    expect(result.ok && result.trip.vehicleTimelineUsable).toBe(false);
  });
  it('handles midnight and expires completed markers', () => {
    const end = Date.parse('2026-08-30T00:08:00Z');
    expect(tripIsDisplayableAt([Date.parse('2026-08-29T23:59:00Z'), end], end + 30_000)).toBe(true);
    expect(tripIsDisplayableAt([Date.parse('2026-08-29T23:59:00Z'), end], end + 61_000)).toBe(false);
  });
});
