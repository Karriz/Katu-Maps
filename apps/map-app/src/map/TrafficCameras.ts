import { serviceConfig } from './ServiceConfig';
import {
  digitrafficJson,
  finiteNumber,
  formatMeasuredTime,
  formatRoadStationName,
  isRecord,
  localizedRoadStationName,
  pointCoordinates,
  text,
  type JsonRecord,
} from './Digitraffic';

export type TrafficCameraSelection = {
  id: string;
  name: string;
  coordinates: [number, number];
};

export type TrafficCameraPreset = {
  id: string;
  name: string;
  imageUrl: string;
  thumbnailUrl: string;
  direction?: string;
  measuredTime?: string;
};

export type TrafficCameraStation = TrafficCameraSelection & {
  municipality?: string;
  province?: string;
  roadNumber?: number;
  collectionStatus: string;
  presetCount: number;
};

export type TrafficCameraDetails = TrafficCameraStation & {
  dataUpdatedTime?: string;
  presets: TrafficCameraPreset[];
};

const STATIONS_TTL_MS = 30 * 60_000;
const DETAILS_TTL_MS = 5 * 60_000;

let stationsCache: { stations: TrafficCameraStation[]; fetchedAt: number } | null = null;
const detailsCache = new Map<string, { details: TrafficCameraDetails; fetchedAt: number }>();

export const formatTrafficCameraName = formatRoadStationName;
export const localizedTrafficCameraName = localizedRoadStationName;
export const formatCameraMeasuredTime = formatMeasuredTime;

export function weathercamImageUrl(presetId: string, options?: { thumbnail?: boolean; cacheKey?: string }) {
  const url = new URL(`${serviceConfig.digitrafficWeathercamEndpoint}/${encodeURIComponent(presetId)}.jpg`);
  if (options?.thumbnail) url.searchParams.set('thumbnail', 'true');
  if (options?.cacheKey) url.searchParams.set('t', options.cacheKey);
  return url.href;
}

function cacheKeyFromTime(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? String(time) : undefined;
}

function presetName(raw: JsonRecord, fallbackId: string) {
  return text(raw.presentationName) ?? text(raw.direction)?.replaceAll('_', ' ').toLowerCase() ?? fallbackId;
}

function imageUrls(presetId: string, imageUrl: string | undefined, cacheKey?: string) {
  const full = imageUrl ?? weathercamImageUrl(presetId);
  const parsed = new URL(full);
  if (cacheKey) parsed.searchParams.set('t', cacheKey);
  const thumbnail = new URL(parsed.href);
  thumbnail.searchParams.set('thumbnail', 'true');
  return { imageUrl: parsed.href, thumbnailUrl: thumbnail.href };
}

export function parseTrafficCameraStations(payload: unknown): TrafficCameraStation[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return [];
  const stations: TrafficCameraStation[] = [];
  for (const feature of payload.features) {
    if (!isRecord(feature)) continue;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const id = text(properties.id) ?? text(feature.id);
    const coordinates = pointCoordinates(isRecord(feature.geometry) ? feature.geometry.coordinates : undefined);
    if (!id || !coordinates) continue;
    if (text(properties.collectionStatus) !== 'GATHERING') continue;
    const presets = Array.isArray(properties.presets) ? properties.presets : [];
    const presetCount = presets.filter((preset) => isRecord(preset) && preset.inCollection !== false).length;
    if (!presetCount) continue;
    stations.push({
      id,
      name: localizedTrafficCameraName(properties.names, text(properties.name) ?? id),
      coordinates,
      municipality: text(properties.municipality),
      province: text(properties.province),
      roadNumber: finiteNumber(isRecord(properties.roadAddress) ? properties.roadAddress.roadNumber : properties.roadNumber),
      collectionStatus: 'GATHERING',
      presetCount,
    });
  }
  return stations;
}

export function parseTrafficCameraDetails(stationPayload: unknown, dataPayload?: unknown): TrafficCameraDetails | undefined {
  if (!isRecord(stationPayload)) return undefined;
  const properties = isRecord(stationPayload.properties) ? stationPayload.properties : stationPayload;
  const id = text(properties.id) ?? text(stationPayload.id);
  const coordinates = pointCoordinates(
    isRecord(stationPayload.geometry) ? stationPayload.geometry.coordinates : undefined,
  ) ?? (Array.isArray(stationPayload.coordinates) ? pointCoordinates(stationPayload.coordinates) : undefined);
  if (!id || !coordinates) return undefined;

  const measuredTimes = new Map<string, string>();
  if (isRecord(dataPayload) && Array.isArray(dataPayload.presets)) {
    for (const preset of dataPayload.presets) {
      if (!isRecord(preset)) continue;
      const presetId = text(preset.id);
      const measuredTime = text(preset.measuredTime);
      if (presetId && measuredTime) measuredTimes.set(presetId, measuredTime);
    }
  }

  const presets: TrafficCameraPreset[] = [];
  const rawPresets = Array.isArray(properties.presets) ? properties.presets : [];
  for (const raw of rawPresets) {
    if (!isRecord(raw) || raw.inCollection === false) continue;
    const presetId = text(raw.id);
    if (!presetId) continue;
    const measuredTime = measuredTimes.get(presetId) ?? text(raw.measuredTime);
    const urls = imageUrls(presetId, text(raw.imageUrl), cacheKeyFromTime(measuredTime));
    presets.push({
      id: presetId,
      name: presetName(raw, presetId),
      direction: text(raw.direction),
      measuredTime,
      ...urls,
    });
  }
  if (!presets.length) return undefined;

  const fallbackName = text(properties.name) ?? id;
  return {
    id,
    name: localizedTrafficCameraName(properties.names, fallbackName),
    coordinates,
    municipality: text(properties.municipality),
    province: text(properties.province),
    roadNumber: finiteNumber(isRecord(properties.roadAddress) ? properties.roadAddress.roadNumber : undefined),
    collectionStatus: text(properties.collectionStatus) ?? 'GATHERING',
    presetCount: presets.length,
    dataUpdatedTime: text(isRecord(dataPayload) ? dataPayload.dataUpdatedTime : undefined)
      ?? text(properties.dataUpdatedTime),
    presets,
  };
}

export function resetTrafficCameraCaches() {
  stationsCache = null;
  detailsCache.clear();
}

export async function fetchTrafficCameraStations(signal?: AbortSignal) {
  const now = Date.now();
  if (stationsCache && now - stationsCache.fetchedAt < STATIONS_TTL_MS) {
    return stationsCache.stations;
  }
  const payload = await digitrafficJson('/api/weathercam/v1/stations', signal);
  const stations = parseTrafficCameraStations(payload);
  stationsCache = { stations, fetchedAt: now };
  return stations;
}

export async function fetchTrafficCameraDetails(
  stationId: string,
  signal?: AbortSignal,
  options?: { bypassCache?: boolean },
) {
  const now = Date.now();
  const cached = detailsCache.get(stationId);
  if (!options?.bypassCache && cached && now - cached.fetchedAt < DETAILS_TTL_MS) {
    return cached.details;
  }
  const [stationPayload, dataPayload] = await Promise.all([
    digitrafficJson(`/api/weathercam/v1/stations/${encodeURIComponent(stationId)}`, signal),
    digitrafficJson(`/api/weathercam/v1/stations/${encodeURIComponent(stationId)}/data`, signal),
  ]);
  const details = parseTrafficCameraDetails(stationPayload, dataPayload);
  if (!details) throw new Error('Traffic camera details were incomplete.');
  detailsCache.set(stationId, { details, fetchedAt: now });
  return details;
}
