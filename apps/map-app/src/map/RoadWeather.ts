import {
  digitrafficJson,
  finiteNumber,
  idText,
  isRecord,
  localizedRoadStationName,
  pointCoordinates,
  text,
} from './Digitraffic';

export type RoadConditionKind = 'dry' | 'damp' | 'wet' | 'frost' | 'snow' | 'ice' | 'unknown';

export type RoadWeatherSelection = {
  id: string;
  name: string;
  coordinates: [number, number];
};

export type RoadWeatherReading = {
  name: string;
  value: number;
  unit?: string;
  measuredTime?: string;
};

export type RoadWeatherStation = RoadWeatherSelection & {
  municipality?: string;
  province?: string;
  roadNumber?: number;
  collectionStatus: string;
  dataUpdatedTime?: string;
  airTemperature?: number;
  roadTemperature?: number;
  humidity?: number;
  windSpeed?: number;
  windDirection?: number;
  precipitationMmH?: number;
  visibilityKm?: number;
  friction?: number;
  iceMm?: number;
  waterMm?: number;
  snowMm?: number;
  roadCondition?: RoadConditionKind;
  roadConditionLabel?: string;
  icy: boolean;
  measuredTime?: string;
};

const STATIONS_TTL_MS = 30 * 60_000;
const OBSERVATIONS_TTL_MS = 90_000;

const NEEDED_SENSORS = new Set([
  'ILMA',
  'TIE_1',
  'KELI_1',
  'TIENPINNAN_TILA_1',
  'ILMAN_KOSTEUS',
  'KESKITUULI',
  'TUULENSUUNTA',
  'SADE_INTENSITEETTI',
  'NÄKYVYYS_KM',
  'KITKA1',
  'JÄÄN_MÄÄRÄ1',
  'VEDEN_MÄÄRÄ1',
  'LUMEN_MÄÄRÄ1',
]);

const ROAD_CONDITIONS: Record<number, { kind: RoadConditionKind; label: string; icy: boolean }> = {
  1: { kind: 'dry', label: 'Dry', icy: false },
  2: { kind: 'damp', label: 'Damp', icy: false },
  3: { kind: 'wet', label: 'Wet', icy: false },
  4: { kind: 'wet', label: 'Wet and salted', icy: false },
  5: { kind: 'frost', label: 'Frost', icy: true },
  6: { kind: 'snow', label: 'Snow', icy: true },
  7: { kind: 'ice', label: 'Ice', icy: true },
  8: { kind: 'wet', label: 'Probably wet and salted', icy: false },
};

let stationsCache: { stations: RoadWeatherStation[]; fetchedAt: number } | null = null;
let observationsCache: { byId: Map<string, Partial<RoadWeatherStation>>; fetchedAt: number } | null = null;

function sensorValue(values: Map<string, RoadWeatherReading>, name: string) {
  return values.get(name)?.value;
}

export function parseRoadCondition(value: number | undefined) {
  if (value === undefined) return undefined;
  return ROAD_CONDITIONS[Math.round(value)];
}

export function formatTemperature(value: number | undefined) {
  if (value === undefined) return undefined;
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}°`;
}

export function formatWeatherValue(value: number | undefined, unit: string, digits = 1) {
  if (value === undefined) return undefined;
  const rounded = digits === 0 ? Math.round(value) : Math.round(value * (10 ** digits)) / (10 ** digits);
  return `${rounded} ${unit}`;
}

export function compassFromDegrees(degrees: number | undefined) {
  if (degrees === undefined) return undefined;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  return directions[index];
}

export function parseRoadWeatherStations(payload: unknown): RoadWeatherStation[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return [];
  const stations: RoadWeatherStation[] = [];
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
      collectionStatus: 'GATHERING',
      icy: false,
    });
  }
  return stations;
}

export function parseRoadWeatherObservations(payload: unknown) {
  const stations = isRecord(payload) && Array.isArray(payload.stations) ? payload.stations : [];
  const byId = new Map<string, Partial<RoadWeatherStation>>();
  for (const raw of stations) {
    if (!isRecord(raw)) continue;
    const id = idText(raw.id);
    if (!id) continue;
    const values = new Map<string, RoadWeatherReading>();
    const sensors = Array.isArray(raw.sensorValues) ? raw.sensorValues : [];
    for (const sensor of sensors) {
      if (!isRecord(sensor)) continue;
      const name = text(sensor.name);
      const value = finiteNumber(sensor.value);
      if (!name || value === undefined || !NEEDED_SENSORS.has(name)) continue;
      values.set(name, {
        name,
        value,
        unit: text(sensor.unit),
        measuredTime: text(sensor.measuredTime),
      });
    }
    const condition = parseRoadCondition(sensorValue(values, 'KELI_1') ?? sensorValue(values, 'TIENPINNAN_TILA_1'));
    const iceMm = sensorValue(values, 'JÄÄN_MÄÄRÄ1');
    const icy = Boolean(condition?.icy || (iceMm !== undefined && iceMm > 0));
    byId.set(id, {
      dataUpdatedTime: text(raw.dataUpdatedTime),
      airTemperature: sensorValue(values, 'ILMA'),
      roadTemperature: sensorValue(values, 'TIE_1'),
      humidity: sensorValue(values, 'ILMAN_KOSTEUS'),
      windSpeed: sensorValue(values, 'KESKITUULI'),
      windDirection: sensorValue(values, 'TUULENSUUNTA'),
      precipitationMmH: sensorValue(values, 'SADE_INTENSITEETTI'),
      visibilityKm: sensorValue(values, 'NÄKYVYYS_KM'),
      friction: sensorValue(values, 'KITKA1'),
      iceMm,
      waterMm: sensorValue(values, 'VEDEN_MÄÄRÄ1'),
      snowMm: sensorValue(values, 'LUMEN_MÄÄRÄ1'),
      roadCondition: condition?.kind ?? 'unknown',
      roadConditionLabel: condition?.label,
      icy,
      measuredTime: values.get('ILMA')?.measuredTime ?? values.get('TIE_1')?.measuredTime ?? values.get('KELI_1')?.measuredTime,
    });
  }
  return byId;
}

export function mergeRoadWeatherStations(
  stations: RoadWeatherStation[],
  observations: Map<string, Partial<RoadWeatherStation>>,
): RoadWeatherStation[] {
  return stations.map((station) => ({ ...station, ...observations.get(station.id) }));
}

export function resetRoadWeatherCaches() {
  stationsCache = null;
  observationsCache = null;
}

async function fetchStationList(signal?: AbortSignal) {
  const now = Date.now();
  if (stationsCache && now - stationsCache.fetchedAt < STATIONS_TTL_MS) return stationsCache.stations;
  const stations = parseRoadWeatherStations(await digitrafficJson('/api/weather/v1/stations', signal));
  stationsCache = { stations, fetchedAt: now };
  return stations;
}

async function fetchObservations(signal?: AbortSignal, bypassCache = false) {
  const now = Date.now();
  if (!bypassCache && observationsCache && now - observationsCache.fetchedAt < OBSERVATIONS_TTL_MS) {
    return observationsCache.byId;
  }
  const byId = parseRoadWeatherObservations(await digitrafficJson('/api/weather/v1/stations/data', signal));
  observationsCache = { byId, fetchedAt: now };
  return byId;
}

export async function fetchRoadWeatherStations(signal?: AbortSignal, options?: { bypassCache?: boolean }) {
  const [stations, observations] = await Promise.all([
    fetchStationList(signal),
    fetchObservations(signal, options?.bypassCache),
  ]);
  return mergeRoadWeatherStations(stations, observations);
}
