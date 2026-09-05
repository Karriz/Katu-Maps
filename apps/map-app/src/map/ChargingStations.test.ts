import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chargingStationAddress,
  chargingStationBoundingBox,
  chargingStationDetailsUrl,
  chargingStatusKind,
  fetchChargingStations,
  formatChargingPower,
  formatChargingUpdatedTime,
  groupChargingConnectors,
  parseChargingStations,
  resetChargingStationCaches,
} from './ChargingStations';

vi.mock('./ServiceConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ServiceConfig')>();
  return {
    serviceConfig: {
      ...actual.serviceConfig,
      openChargeMapApiKey: 'test-ocm-key',
    },
  };
});

const poiPayload = [
  {
    ID: 189853,
    UUID: '1686CE5C-95E8-450B-93C3-95D1B1AF98D4',
    UsageTypeID: 4,
    UsageCost: '€0.30/kWh',
    AddressInfo: {
      Title: 'Koskipuisto charging',
      AddressLine1: 'Koskikatu 1',
      Town: 'Tampere',
      Postcode: '33100',
      Country: { Title: 'Finland' },
      Latitude: 61.4981,
      Longitude: 23.7609,
      AccessComments: 'Public parking garage',
      ContactTelephone1: '+358 3 123 4567',
      RelatedURL: 'https://example.invalid/station',
    },
    OperatorInfo: { Title: 'Virta', WebsiteURL: 'https://virta.global' },
    UsageType: { Title: 'Public - Membership Required' },
    StatusTypeID: 50,
    StatusType: { Title: 'Operational', IsOperational: true },
    DateLastStatusUpdate: '2026-09-05T09:00:00Z',
    NumberOfPoints: 4,
    DataProvider: { Title: 'Open Charge Map Contributors' },
    Connections: [
      {
        ID: 1,
        ConnectionTypeID: 33,
        ConnectionType: { Title: 'CCS (Type 2)' },
        StatusType: { Title: 'Operational', IsOperational: true },
        PowerKW: 150,
        CurrentType: { Title: 'DC' },
        Quantity: 2,
      },
      {
        ID: 2,
        ConnectionTypeID: 25,
        ConnectionType: { Title: 'Type 2 (Socket Only)' },
        StatusTypeID: 50,
        PowerKW: 22,
        CurrentType: { Title: 'AC (Three-Phase)' },
        Quantity: 2,
      },
      {
        ID: 3,
        ConnectionTypeID: 2,
        StatusType: { Title: 'Temporarily Unavailable', IsOperational: false },
        PowerKW: 50,
        Quantity: 1,
      },
    ],
  },
  {
    ID: 'bad',
    AddressInfo: { Title: 'Off the map', Latitude: 91, Longitude: 181 },
    Connections: [],
  },
];

afterEach(() => {
  resetChargingStationCaches();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('charging station parsing', () => {
  it('keeps valid stations and groups charger types', () => {
    const stations = parseChargingStations(poiPayload);
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({
      id: '189853',
      name: 'Koskipuisto charging',
      coordinates: [23.7609, 61.4981],
      operator: 'Virta',
      usage: 'Public - Membership Required',
      status: 'Operational',
      statusKind: 'operational',
      numberOfPoints: 4,
    });
    expect(groupChargingConnectors(stations[0].connectors)).toEqual([
      {
        type: 'CCS (Type 2)',
        quantity: 2,
        powerKw: 150,
        current: 'DC',
        status: 'Operational',
        statusKind: 'operational',
      },
      {
        type: 'CHAdeMO',
        quantity: 1,
        powerKw: 50,
        current: undefined,
        status: 'Temporarily Unavailable',
        statusKind: 'unavailable',
      },
      {
        type: 'Type 2 (Socket Only)',
        quantity: 2,
        powerKw: 22,
        current: 'AC (Three-Phase)',
        status: 'Operational',
        statusKind: 'operational',
      },
    ]);
    expect(chargingStationAddress(stations[0])).toBe('Koskikatu 1, 33100 Tampere, Finland');
    expect(chargingStationDetailsUrl(stations[0].id)).toBe('https://openchargemap.org/site/poi/details/189853');
  });

  it('classifies status, power and relative update times', () => {
    expect(chargingStatusKind(50, true)).toBe('operational');
    expect(chargingStatusKind(75, undefined, 'Partly Operational (Mixed)')).toBe('limited');
    expect(chargingStatusKind(200, false)).toBe('unavailable');
    expect(chargingStatusKind(undefined, undefined)).toBe('unknown');
    expect(formatChargingPower(7.4)).toBe('7.4 kW');
    expect(formatChargingPower(150.4)).toBe('150 kW');
    expect(formatChargingUpdatedTime('2026-09-05T09:00:00Z', Date.parse('2026-09-05T09:03:00Z')))
      .toContain('3 min ago');
  });

  it('formats the Open Charge Map bounding box as top-left then bottom-right', () => {
    expect(chargingStationBoundingBox({
      getNorth: () => 61.51,
      getSouth: () => 61.49,
      getWest: () => 23.74,
      getEast: () => 23.78,
    })).toBe('(61.51,23.74),(61.49,23.78)');
  });
});

describe('charging station requests', () => {
  it('identifies the app, sends the API key and caches viewport results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(poiPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const bounds = {
      getNorth: () => 61.51,
      getSouth: () => 61.49,
      getWest: () => 23.74,
      getEast: () => 23.78,
    };

    const first = await fetchChargingStations(bounds, 14);
    const second = await fetchChargingStations(bounds, 14.4);

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain('https://api.openchargemap.io/v3/poi/');
    expect(url).toContain('boundingbox=(61.51,23.74),(61.49,23.78)');
    expect(url).toContain('client=katu-maps');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json',
        'X-API-Key': 'test-ocm-key',
      }),
    }));
  });
});
