import {
  digitrafficJson,
  finiteNumber,
  idText,
  isRecord,
  localizedRoadStationName,
  pointCoordinates,
  text,
} from './Digitraffic';

export type TrafficCongestion = 'free' | 'slow' | 'heavy' | 'severe' | 'unknown';

export type RoadTrafficSelection = {
  id: string;
  name: string;
  coordinates: [number, number];
};

export type RoadTrafficDirection = {
  municipality?: string;
  speedKmh?: number;
  volumePerHour?: number;
  freeFlowKmh?: number;
  congestion: TrafficCongestion;
};

export type RoadTrafficStation = RoadTrafficSelection & {
  municipality?: string;
  province?: string;
  roadNumber?: number;
  bearing?: number;
  collectionStatus: string;
  dataUpdatedTime?: string;
  measuredTime?: string;
  direction1: RoadTrafficDirection;
  direction2: RoadTrafficDirection;
};

const STATIONS_TTL_MS = 30 * 60_000;
const OBSERVATIONS_TTL_MS = 90_000;
const EARTH_RADIUS_M = 6_371_000;

let stationsCache: { stations: RoadTrafficStation[]; fetchedAt: number } | null = null;
let observationsCache: { byId: Map<string, Partial<RoadTrafficStation>>; fetchedAt: number } | null = null;

export const TRAFFIC_CONGESTION_COLORS: Record<TrafficCongestion, string> = {
  free: '#22c55e',
  slow: '#eab308',
  heavy: '#f97316',
  severe: '#dc2626',
  unknown: '#94a3b8',
};

export const TRAFFIC_CONGESTION_LABELS: Record<TrafficCongestion, string> = {
  free: 'Free flowing',
  slow: 'Slowing',
  heavy: 'Heavy traffic',
  severe: 'Congested',
  unknown: 'No data',
};

export function trafficCongestion(speedKmh?: number, freeFlowKmh?: number, volumePerHour?: number): TrafficCongestion {
  if (speedKmh !== undefined && freeFlowKmh && freeFlowKmh > 0) {
    const ratio = speedKmh / freeFlowKmh;
    if (ratio >= 0.8) return 'free';
    if (ratio >= 0.55) return 'slow';
    if (ratio >= 0.35) return 'heavy';
    return 'severe';
  }
  if (speedKmh !== undefined) {
    if (speedKmh >= 80) return 'free';
    if (speedKmh >= 50) return 'slow';
    if (speedKmh >= 30) return 'heavy';
    return 'severe';
  }
  if (volumePerHour !== undefined) {
    if (volumePerHour >= 1400) return 'severe';
    if (volumePerHour >= 900) return 'heavy';
    if (volumePerHour >= 400) return 'slow';
    return 'free';
  }
  return 'unknown';
}

export function offsetPoint(longitude: number, latitude: number, bearingDegrees: number, distanceMeters: number): [number, number] {
  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const bearing = bearingDegrees * Math.PI / 180;
  const fromLat = latitude * Math.PI / 180;
  const fromLng = longitude * Math.PI / 180;
  const toLat = Math.asin(
    Math.sin(fromLat) * Math.cos(angularDistance)
    + Math.cos(fromLat) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const toLng = fromLng + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(fromLat),
    Math.cos(angularDistance) - Math.sin(fromLat) * Math.sin(toLat),
  );
  return [(toLng * 180 / Math.PI + 540) % 360 - 180, toLat * 180 / Math.PI];
}

export function trafficSegmentCoordinates(
  longitude: number,
  latitude: number,
  bearing: number | undefined,
  direction: 1 | 2,
  lengthMeters = 520,
  offsetMeters = 9,
): [number, number][] {
  const travel = ((bearing ?? 90) + (direction === 2 ? 180 : 0) + 360) % 360;
  const side = (travel + 90) % 360;
  const origin = offsetPoint(longitude, latitude, side, offsetMeters);
  return [
    offsetPoint(origin[0], origin[1], travel, -lengthMeters / 2),
    offsetPoint(origin[0], origin[1], travel, lengthMeters / 2),
  ];
}

function sensorMap(raw: unknown) {
  const values = new Map<string, { value: number; measuredTime?: string }>();
  if (!Array.isArray(raw)) return values;
  for (const sensor of raw) {
    if (!isRecord(sensor)) continue;
    const name = text(sensor.name);
    const value = finiteNumber(sensor.value);
    if (!name || value === undefined) continue;
    values.set(name, { value, measuredTime: text(sensor.measuredTime) });
  }
  return values;
}

function firstSensor(values: Map<string, { value: number; measuredTime?: string }>, names: string[]) {
  for (const name of names) {
    const reading = values.get(name);
    if (reading) return reading;
  }
  return undefined;
}

export function parseRoadTrafficStations(payload: unknown): RoadTrafficStation[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return [];
  const stations: RoadTrafficStation[] = [];
  for (const feature of payload.features) {
    if (!isRecord(feature)) continue;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const id = idText(properties.id) ?? idText(feature.id);
    const coordinates = pointCoordinates(isRecord(feature.geometry) ? feature.geometry.coordinates : undefined);
    if (!id || !coordinates) continue;
    if (text(properties.collectionStatus) !== 'GATHERING') continue;
    const fallbackName = text(properties.name) ?? id;
    stations.push({
      id,
      name: localizedRoadStationName(properties.names, fallbackName),
      coordinates,
      municipality: text(properties.municipality),
      province: text(properties.province),
      roadNumber: finiteNumber(isRecord(properties.roadAddress) ? properties.roadAddress.roadNumber : properties.roadNumber),
      bearing: finiteNumber(properties.bearing),
      collectionStatus: 'GATHERING',
      direction1: {
        municipality: text(properties.direction1Municipality),
        freeFlowKmh: finiteNumber(properties.freeFlowSpeed1),
        congestion: 'unknown',
      },
      direction2: {
        municipality: text(properties.direction2Municipality),
        freeFlowKmh: finiteNumber(properties.freeFlowSpeed2),
        congestion: 'unknown',
      },
    });
  }
  return stations;
}

export function parseRoadTrafficObservations(payload: unknown) {
  const stations = isRecord(payload) && Array.isArray(payload.stations) ? payload.stations : [];
  const byId = new Map<string, Partial<RoadTrafficStation>>();
  for (const raw of stations) {
    if (!isRecord(raw)) continue;
    const id = idText(raw.id);
    if (!id) continue;
    const values = sensorMap(raw.sensorValues);
    const speed1 = firstSensor(values, ['KESKINOPEUS_5MIN_LIUKUVA_SUUNTA1', 'KESKINOPEUS_60MIN_KIINTEA_SUUNTA1']);
    const speed2 = firstSensor(values, ['KESKINOPEUS_5MIN_LIUKUVA_SUUNTA2', 'KESKINOPEUS_60MIN_KIINTEA_SUUNTA2']);
    const volume1 = firstSensor(values, ['OHITUKSET_5MIN_LIUKUVA_SUUNTA1', 'OHITUKSET_60MIN_KIINTEA_SUUNTA1']);
    const volume2 = firstSensor(values, ['OHITUKSET_5MIN_LIUKUVA_SUUNTA2', 'OHITUKSET_60MIN_KIINTEA_SUUNTA2']);
    byId.set(id, {
      dataUpdatedTime: text(raw.dataUpdatedTime),
      measuredTime: speed1?.measuredTime ?? volume1?.measuredTime ?? speed2?.measuredTime,
      direction1: {
        speedKmh: speed1?.value,
        volumePerHour: volume1?.value,
        congestion: 'unknown',
      },
      direction2: {
        speedKmh: speed2?.value,
        volumePerHour: volume2?.value,
        congestion: 'unknown',
      },
    });
  }
  return byId;
}

export function mergeRoadTrafficStations(
  stations: RoadTrafficStation[],
  observations: Map<string, Partial<RoadTrafficStation>>,
): RoadTrafficStation[] {
  return stations.map((station) => {
    const observation = observations.get(station.id);
    const direction1 = {
      ...station.direction1,
      ...observation?.direction1,
      municipality: station.direction1.municipality,
      freeFlowKmh: station.direction1.freeFlowKmh,
    };
    const direction2 = {
      ...station.direction2,
      ...observation?.direction2,
      municipality: station.direction2.municipality,
      freeFlowKmh: station.direction2.freeFlowKmh,
    };
    direction1.congestion = trafficCongestion(direction1.speedKmh, direction1.freeFlowKmh, direction1.volumePerHour);
    direction2.congestion = trafficCongestion(direction2.speedKmh, direction2.freeFlowKmh, direction2.volumePerHour);
    return {
      ...station,
      dataUpdatedTime: observation?.dataUpdatedTime,
      measuredTime: observation?.measuredTime,
      direction1,
      direction2,
    };
  });
}

export function stationCongestion(station: RoadTrafficStation): TrafficCongestion {
  const order: TrafficCongestion[] = ['severe', 'heavy', 'slow', 'free', 'unknown'];
  return order.find((kind) => station.direction1.congestion === kind || station.direction2.congestion === kind) ?? 'unknown';
}

export function resetRoadTrafficCaches() {
  stationsCache = null;
  observationsCache = null;
}

async function fetchStationList(signal?: AbortSignal) {
  const now = Date.now();
  if (stationsCache && now - stationsCache.fetchedAt < STATIONS_TTL_MS) return stationsCache.stations;
  const stations = parseRoadTrafficStations(await digitrafficJson('/api/tms/v1/stations', signal));
  stationsCache = { stations, fetchedAt: now };
  return stations;
}

async function fetchObservations(signal?: AbortSignal, bypassCache = false) {
  const now = Date.now();
  if (!bypassCache && observationsCache && now - observationsCache.fetchedAt < OBSERVATIONS_TTL_MS) {
    return observationsCache.byId;
  }
  const byId = parseRoadTrafficObservations(await digitrafficJson('/api/tms/v1/stations/data', signal));
  observationsCache = { byId, fetchedAt: now };
  return byId;
}

export async function fetchRoadTrafficStations(signal?: AbortSignal, options?: { bypassCache?: boolean }) {
  const [stations, observations] = await Promise.all([
    fetchStationList(signal),
    fetchObservations(signal, options?.bypassCache),
  ]);
  return mergeRoadTrafficStations(stations, observations);
}
