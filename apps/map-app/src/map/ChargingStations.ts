import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';

export type ChargingStatusKind = 'operational' | 'limited' | 'unavailable' | 'unknown';

export type ChargingConnector = {
  id: string;
  type: string;
  quantity: number;
  powerKw?: number;
  current?: string;
  level?: string;
  status: string;
  statusKind: ChargingStatusKind;
};

export type ChargingStationSelection = {
  id: string;
  name: string;
  coordinates: [number, number];
};

export type ChargingStation = ChargingStationSelection & {
  address?: string;
  town?: string;
  postcode?: string;
  country?: string;
  operator?: string;
  operatorUrl?: string;
  usage?: string;
  usageCost?: string;
  accessComments?: string;
  comments?: string;
  phone?: string;
  relatedUrl?: string;
  numberOfPoints?: number;
  status: string;
  statusKind: ChargingStatusKind;
  statusUpdated?: string;
  dataProvider?: string;
  connectors: ChargingConnector[];
};

export class ChargingStationsConfigError extends Error {
  constructor(message = 'Open Charge Map is not configured. Set VITE_OPENCHARGEMAP_API_KEY.') {
    super(message);
    this.name = 'ChargingStationsConfigError';
  }
}

type JsonRecord = Record<string, unknown>;

const LIST_TTL_MS = 5 * 60_000;
const MAX_RESULTS = 250;
const listCache = new Map<string, { stations: ChargingStation[]; fetchedAt: number }>();

const CONNECTION_TYPE_NAMES: Record<number, string> = {
  1: 'Type 1 (J1772)',
  2: 'CHAdeMO',
  25: 'Type 2',
  27: 'Tesla Supercharger',
  30: 'Tesla',
  32: 'CCS (Type 1)',
  33: 'CCS (Type 2)',
  1036: 'Type 2 (Tethered)',
  1040: 'CCS (Type 2)',
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pick(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function titled(value: unknown) {
  const direct = text(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  return text(value.Title) ?? text(value.title) ?? text(value.description);
}

function bool(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function idText(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

export function chargingStationDetailsUrl(id: string) {
  return `https://openchargemap.org/site/poi/details/${encodeURIComponent(id)}`;
}

export function chargingStatusKind(
  statusId: number | undefined,
  isOperational: boolean | undefined,
  title?: string,
): ChargingStatusKind {
  if (statusId === 50 || isOperational === true) return 'operational';
  if (statusId === 75 || /partly|partial|mixed/i.test(title ?? '')) return 'limited';
  if (statusId === 100 || statusId === 200 || isOperational === false) return 'unavailable';
  return 'unknown';
}

export function formatChargingPower(powerKw: number | undefined) {
  if (powerKw === undefined) return undefined;
  const rounded = powerKw >= 10 ? Math.round(powerKw) : Math.round(powerKw * 10) / 10;
  return `${rounded} kW`;
}

export function formatChargingUpdatedTime(value: string | undefined, now = Date.now()) {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time));
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return `${formatted} · just now`;
  if (minutes === 1) return `${formatted} · 1 min ago`;
  if (minutes < 60) return `${formatted} · ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${formatted} · ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return formatted;
}

export function chargingStationAddress(station: Pick<ChargingStation, 'address' | 'town' | 'postcode' | 'country'>) {
  return [station.address, [station.postcode, station.town].filter(Boolean).join(' '), station.country]
    .filter(Boolean)
    .join(', ');
}

export type ChargingConnectorGroup = {
  type: string;
  quantity: number;
  powerKw?: number;
  current?: string;
  status: string;
  statusKind: ChargingStatusKind;
};

export function groupChargingConnectors(connectors: ChargingConnector[]): ChargingConnectorGroup[] {
  const groups = new Map<string, ChargingConnectorGroup>();
  for (const connector of connectors) {
    const key = [connector.type, connector.powerKw ?? '', connector.statusKind].join(':');
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += connector.quantity;
      continue;
    }
    groups.set(key, {
      type: connector.type,
      quantity: connector.quantity,
      powerKw: connector.powerKw,
      current: connector.current,
      status: connector.status,
      statusKind: connector.statusKind,
    });
  }
  return [...groups.values()].sort((left, right) => {
    const powerDelta = (right.powerKw ?? 0) - (left.powerKw ?? 0);
    if (powerDelta) return powerDelta;
    return left.type.localeCompare(right.type);
  });
}

export function chargingStationBoundingBox(bounds: {
  getNorth(): number;
  getSouth(): number;
  getWest(): number;
  getEast(): number;
}) {
  return `(${bounds.getNorth()},${bounds.getWest()}),(${bounds.getSouth()},${bounds.getEast()})`;
}

function parseStatus(raw: JsonRecord | undefined, fallbackId: unknown) {
  const title = titled(raw) ?? (fallbackId === 50 ? 'Operational' : fallbackId === 75 ? 'Partly operational' : fallbackId === 100 ? 'Not operational' : fallbackId === 200 ? 'Temporarily unavailable' : 'Unknown');
  const statusId = finiteNumber(raw ? pick(raw, 'ID', 'id') : fallbackId) ?? finiteNumber(fallbackId);
  const kind = chargingStatusKind(statusId, bool(raw ? pick(raw, 'IsOperational', 'isOperational') : undefined), title);
  return { status: title, statusKind: kind };
}

function parseConnector(raw: unknown, index: number): ChargingConnector | undefined {
  if (!isRecord(raw)) return undefined;
  const typeId = finiteNumber(pick(raw, 'ConnectionTypeID', 'connectionTypeID', 'connectionTypeId'));
  const typeObject = pick(raw, 'ConnectionType', 'connectionType');
  const type = titled(typeObject) ?? (typeId !== undefined ? CONNECTION_TYPE_NAMES[typeId] : undefined) ?? 'Connector';
  const status = parseStatus(
    isRecord(pick(raw, 'StatusType', 'statusType')) ? pick(raw, 'StatusType', 'statusType') as JsonRecord : undefined,
    pick(raw, 'StatusTypeID', 'statusTypeID', 'statusTypeId'),
  );
  const quantity = Math.max(1, Math.round(finiteNumber(pick(raw, 'Quantity', 'quantity')) ?? 1));
  return {
    id: idText(pick(raw, 'ID', 'id')) ?? `${type}:${index}`,
    type,
    quantity,
    powerKw: finiteNumber(pick(raw, 'PowerKW', 'powerKW', 'powerKw')),
    current: titled(pick(raw, 'CurrentType', 'currentType')),
    level: titled(pick(raw, 'Level', 'level')),
    ...status,
  };
}

export function parseChargingStations(payload: unknown): ChargingStation[] {
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.poi)
      ? payload.poi
      : [];
  const stations: ChargingStation[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const address = isRecord(pick(item, 'AddressInfo', 'addressInfo'))
      ? pick(item, 'AddressInfo', 'addressInfo') as JsonRecord
      : {};
    const id = idText(pick(item, 'ID', 'id')) ?? idText(pick(item, 'UUID', 'uuid'));
    const longitude = finiteNumber(pick(address, 'Longitude', 'longitude'));
    const latitude = finiteNumber(pick(address, 'Latitude', 'latitude'));
    if (!id || longitude === undefined || latitude === undefined) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    const status = parseStatus(
      isRecord(pick(item, 'StatusType', 'statusType')) ? pick(item, 'StatusType', 'statusType') as JsonRecord : undefined,
      pick(item, 'StatusTypeID', 'statusTypeID', 'statusTypeId'),
    );
    const connectors = (Array.isArray(pick(item, 'Connections', 'connections'))
      ? pick(item, 'Connections', 'connections') as unknown[]
      : [])
      .flatMap((connector, index) => {
        const parsed = parseConnector(connector, index);
        return parsed ? [parsed] : [];
      });
    const operator = isRecord(pick(item, 'OperatorInfo', 'operatorInfo'))
      ? pick(item, 'OperatorInfo', 'operatorInfo') as JsonRecord
      : undefined;
    const usage = isRecord(pick(item, 'UsageType', 'usageType'))
      ? pick(item, 'UsageType', 'usageType') as JsonRecord
      : undefined;
    const provider = isRecord(pick(item, 'DataProvider', 'dataProvider'))
      ? pick(item, 'DataProvider', 'dataProvider') as JsonRecord
      : undefined;
    stations.push({
      id,
      name: titled(pick(address, 'Title', 'title')) ?? titled(pick(item, 'UUID', 'uuid')) ?? `Charging station ${id}`,
      coordinates: [longitude, latitude],
      address: text(pick(address, 'AddressLine1', 'addressLine1')),
      town: text(pick(address, 'Town', 'town')),
      postcode: text(pick(address, 'Postcode', 'postcode')),
      country: titled(pick(address, 'Country', 'country')),
      operator: titled(operator),
      operatorUrl: text(operator ? pick(operator, 'WebsiteURL', 'websiteURL', 'websiteUrl') : undefined),
      usage: titled(usage),
      usageCost: text(pick(item, 'UsageCost', 'usageCost')),
      accessComments: text(pick(address, 'AccessComments', 'accessComments')),
      comments: text(pick(item, 'GeneralComments', 'generalComments')),
      phone: text(pick(address, 'ContactTelephone1', 'contactTelephone1')),
      relatedUrl: text(pick(address, 'RelatedURL', 'relatedURL', 'relatedUrl')),
      numberOfPoints: finiteNumber(pick(item, 'NumberOfPoints', 'numberOfPoints')),
      statusUpdated: text(pick(item, 'DateLastStatusUpdate', 'dateLastStatusUpdate')),
      dataProvider: titled(provider),
      connectors,
      ...status,
    });
  }
  return stations;
}

export function resetChargingStationCaches() {
  listCache.clear();
}

export function chargingStationsConfigured() {
  return Boolean(serviceConfig.openChargeMapApiKey);
}

export async function fetchChargingStations(
  bounds: { getNorth(): number; getSouth(): number; getWest(): number; getEast(): number },
  zoom: number,
  signal?: AbortSignal,
) {
  if (!serviceConfig.openChargeMapApiKey) throw new ChargingStationsConfigError();
  const zoomBucket = Math.max(9, Math.floor(zoom));
  const key = [
    zoomBucket,
    bounds.getSouth().toFixed(3),
    bounds.getWest().toFixed(3),
    bounds.getNorth().toFixed(3),
    bounds.getEast().toFixed(3),
  ].join(':');
  const now = Date.now();
  const cached = listCache.get(key);
  if (cached && now - cached.fetchedAt < LIST_TTL_MS) return cached.stations;

  const params = new URLSearchParams({
    output: 'json',
    compact: 'false',
    verbose: 'false',
    includecomments: 'false',
    maxresults: String(MAX_RESULTS),
    client: serviceConfig.clientId,
    boundingbox: chargingStationBoundingBox(bounds),
  });
  const response = await fetchWithTimeout(`${serviceConfig.openChargeMapEndpoint}/poi/?${params}`, {
    signal,
    headers: {
      Accept: 'application/json',
      'X-API-Key': serviceConfig.openChargeMapApiKey,
    },
  }, 20_000);
  if (!response.ok) throw apiHttpError(response, 'Open Charge Map');
  const stations = parseChargingStations(await response.json());
  listCache.set(key, { stations, fetchedAt: now });
  return stations;
}
