import { describe, expect, it } from 'vitest';
import type { TransitTrip } from './types';
import { BOARDING_TIME_TOLERANCE_MS, resolveSelectedTrip, tripIsDisplayableAt } from './tripTimeline';

const serviceDate = '2026-08-28';
const tripId = 'tampere:30:trip';
const iso = (minute: number) => new Date(Date.UTC(2026, 7, 28, 20, minute)).toISOString();

function trip(stops: Array<{ id: string; time: string }>, date = serviceDate): TransitTrip {
  const places = stops.map(({ id, time }) => ({ stopId: id, name: id, arrival: time, departure: time }));
  return { legs: [{
    tripId,
    serviceDate: date,
    from: places[0],
    intermediateStops: places.slice(1, -1),
    to: places.at(-1),
    coordinates: [[23.7, 61.4], [23.8, 61.5]],
  }] };
}

const context = {
  tripId,
  provider: 'digitransit' as const,
  serviceDate,
  boardingStopId: 'board',
  selectedDeparture: iso(12),
};

describe('selected trip timeline validation', () => {
  it('keeps every downstream stop after a future boarding stop', () => {
    const resolved = resolveSelectedTrip(trip([
      { id: 'previous', time: iso(5) }, { id: 'board', time: iso(12) }, { id: 'next', time: iso(18) },
    ]), context);
    expect(resolved?.boardingStopIndex).toBe(1);
    expect(resolved?.times[2]).toBeGreaterThan(resolved!.times[1]);
  });

  it('rejects a mixed realtime/scheduled timeline which moves backwards', () => {
    expect(resolveSelectedTrip(trip([
      { id: 'previous', time: iso(5) }, { id: 'board', time: iso(12) }, { id: 'next', time: iso(9) },
    ]), context)).toBeUndefined();
  });

  it('selects the matching occurrence when a loop visits a stop twice', () => {
    const resolved = resolveSelectedTrip(trip([
      { id: 'board', time: iso(2) }, { id: 'middle', time: iso(8) }, { id: 'board', time: iso(12) },
    ]), context);
    expect(resolved?.boardingStopIndex).toBe(2);
  });

  it('rejects departure and service-instance mismatches', () => {
    expect(resolveSelectedTrip(trip([{ id: 'board', time: iso(8) }, { id: 'next', time: iso(18) }]), context)).toBeUndefined();
    expect(resolveSelectedTrip(trip([
      { id: 'board', time: iso(12) }, { id: 'next', time: iso(18) },
    ], '2026-08-29'), context)).toBeUndefined();
  });

  it('accepts midnight rollover and the documented boarding tolerance', () => {
    const selected = new Date(Date.parse('2026-08-28T23:59:00+03:00') + BOARDING_TIME_TOLERANCE_MS).toISOString();
    const resolved = resolveSelectedTrip(trip([
      { id: 'board', time: '2026-08-28T23:59:00+03:00' },
      { id: 'next', time: '2026-08-29T00:08:00+03:00' },
    ]), { ...context, selectedDeparture: selected });
    expect(resolved).toBeDefined();
  });

  it('does not resolve an ambiguous Transitous service instance', () => {
    expect(resolveSelectedTrip(trip([
      { id: 'board', time: iso(12) }, { id: 'next', time: iso(18) },
    ]), { ...context, provider: 'transitous', serviceDate: undefined })).toBeUndefined();
  });

  it('removes a completed marker after its short grace period', () => {
    const end = Date.parse(iso(18));
    expect(tripIsDisplayableAt([Date.parse(iso(12)), end], end + 30_000)).toBe(true);
    expect(tripIsDisplayableAt([Date.parse(iso(12)), end], end + 61_000)).toBe(false);
  });
});
