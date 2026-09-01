import OpeningHours from 'opening_hours';
import tzLookup from 'tz-lookup';

export type LocationOpenState = 'open' | 'closed';

/**
 * opening_hours evaluates a Date in the runtime's local time zone. Convert the
 * current instant to a Date whose local fields match the place's local fields
 * so visitors see the place's state rather than the state in their own zone.
 */
function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);

  return new Date(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
    date.getMilliseconds(),
  );
}

export function locationOpenState(
  value: string,
  coordinates: [number, number],
  now = new Date(),
): LocationOpenState | null {
  try {
    const [longitude, latitude] = coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const localNow = dateInTimeZone(now, tzLookup(latitude, longitude));
    const hours = new OpeningHours(value);
    if (hours.getUnknown(localNow)) return null;
    return hours.getState(localNow) ? 'open' : 'closed';
  } catch {
    // OSM values are user supplied and may be incomplete or use unsupported syntax.
    return null;
  }
}
