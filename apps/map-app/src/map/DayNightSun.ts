import tzLookup from 'tz-lookup';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export type SubsolarPoint = {
  latitude: number;
  longitude: number;
};

export type SunPosition = SubsolarPoint & {
  elevation: number;
  azimuth: number;
  declination: number;
  subsolarLongitude: number;
};

function wrapDegrees(value: number, min = -180, max = 180) {
  const span = max - min;
  return ((value - min) % span + span) % span + min;
}

export function julianDay(date: Date) {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/** Mean solar coordinates after NOAA's low-precision SPA, in degrees. */
function solarCoordinates(date: Date) {
  const day = julianDay(date) - 2_451_545;
  const meanLongitude = wrapDegrees(280.46 + 0.9856474 * day, 0, 360);
  const meanAnomaly = wrapDegrees(357.528 + 0.9856003 * day, 0, 360);
  const eclipticLongitude = wrapDegrees(
    meanLongitude
    + 1.915 * Math.sin(meanAnomaly * DEG)
    + 0.02 * Math.sin(2 * meanAnomaly * DEG),
    0,
    360,
  );
  const obliquity = 23.439 - 0.0000004 * day;
  const declination = Math.asin(Math.sin(obliquity * DEG) * Math.sin(eclipticLongitude * DEG)) * RAD;
  const rightAscension = Math.atan2(
    Math.cos(obliquity * DEG) * Math.sin(eclipticLongitude * DEG),
    Math.cos(eclipticLongitude * DEG),
  ) * RAD;
  let equationOfTimeMinutes = 4 * (meanLongitude - wrapDegrees(rightAscension, 0, 360));
  if (equationOfTimeMinutes > 20) equationOfTimeMinutes -= 1440;
  if (equationOfTimeMinutes < -20) equationOfTimeMinutes += 1440;
  return { declination, equationOfTimeMinutes };
}

export function subsolarPoint(date: Date): SubsolarPoint {
  const { declination, equationOfTimeMinutes } = solarCoordinates(date);
  const utcHours = date.getUTCHours()
    + date.getUTCMinutes() / 60
    + date.getUTCSeconds() / 3600
    + date.getUTCMilliseconds() / 3_600_000;
  return {
    latitude: declination,
    longitude: wrapDegrees((12 - utcHours - equationOfTimeMinutes / 60) * 15),
  };
}

export function sunEcefDirection(date: Date): [number, number, number] {
  const { latitude, longitude } = subsolarPoint(date);
  const lat = latitude * DEG;
  const lng = longitude * DEG;
  return [
    Math.cos(lat) * Math.cos(lng),
    Math.cos(lat) * Math.sin(lng),
    Math.sin(lat),
  ];
}

export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const subsolar = subsolarPoint(date);
  const lat = latitude * DEG;
  const dec = subsolar.latitude * DEG;
  const hourAngle = (longitude - subsolar.longitude) * DEG;
  const sinElevation = Math.sin(lat) * Math.sin(dec)
    + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinElevation))) * RAD;
  const azimuth = wrapDegrees(
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
    ) * RAD + 180,
    0,
    360,
  );
  return {
    latitude,
    longitude,
    elevation,
    azimuth,
    declination: subsolar.latitude,
    subsolarLongitude: subsolar.longitude,
  };
}

export type DayNightPhase =
  | 'day'
  | 'golden'
  | 'sunset'
  | 'civil'
  | 'nautical'
  | 'night';

export function dayNightPhase(elevation: number): DayNightPhase {
  if (elevation >= 12) return 'day';
  if (elevation >= 6) return 'golden';
  if (elevation >= 0) return 'sunset';
  if (elevation >= -6) return 'civil';
  if (elevation >= -12) return 'nautical';
  return 'night';
}

export function dayNightPhaseLabel(phase: DayNightPhase) {
  if (phase === 'day') return 'Daylight';
  if (phase === 'golden') return 'Golden hour';
  if (phase === 'sunset') return 'Sunrise / sunset';
  if (phase === 'civil') return 'Civil twilight';
  if (phase === 'nautical') return 'Nautical twilight';
  return 'Night';
}

export function localMinutesAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function utcMsFromLocalMinutes(referenceUtcMs: number, timeZone: string, minutes: number) {
  const current = localMinutesAt(new Date(referenceUtcMs), timeZone);
  let delta = minutes - current;
  if (delta > 720) delta -= 1440;
  if (delta < -720) delta += 1440;
  return referenceUtcMs + delta * 60_000;
}

export function timeZoneAt(latitude: number, longitude: number) {
  try {
    return tzLookup(latitude, longitude);
  } catch {
    return 'UTC';
  }
}
