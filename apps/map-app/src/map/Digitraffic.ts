import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';

export type JsonRecord = Record<string, unknown>;

export function digitrafficHeaders() {
  return {
    Accept: 'application/json',
    'Digitraffic-User': serviceConfig.clientId,
  };
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function idText(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

export function pointCoordinates(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const longitude = finiteNumber(value[0]);
  const latitude = finiteNumber(value[1]);
  if (longitude === undefined || latitude === undefined) return undefined;
  if (latitude < -90 || latitude > 90) return undefined;
  return [longitude, latitude];
}

/** Formats Digitraffic station ids such as `vt3_Tampere_Lakalaiva`. */
export function formatRoadStationName(raw: string) {
  const match = /^(vt|kt|st|yt|mt)(\d+)_(.+)$/i.exec(raw.trim());
  if (!match) return raw.replaceAll('_', ' ').trim();
  return `${match[1].toUpperCase()} ${match[2]} ${match[3].replaceAll('_', ' ')}`.trim();
}

export function localizedRoadStationName(names: unknown, fallback: string) {
  if (!isRecord(names)) return formatRoadStationName(fallback);
  return text(names.en) ?? text(names.fi) ?? text(names.sv) ?? formatRoadStationName(fallback);
}

export function formatMeasuredTime(value: string | undefined, now = Date.now()) {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time));
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return `${formatted} · just now`;
  if (minutes === 1) return `${formatted} · 1 min ago`;
  if (minutes < 60) return `${formatted} · ${minutes} min ago`;
  return formatted;
}

export async function digitrafficJson(path: string, signal?: AbortSignal) {
  const response = await fetchWithTimeout(`${serviceConfig.digitrafficRoadEndpoint}${path}`, {
    signal,
    headers: digitrafficHeaders(),
  });
  if (!response.ok) throw apiHttpError(response, 'Digitraffic');
  return response.json() as Promise<unknown>;
}
