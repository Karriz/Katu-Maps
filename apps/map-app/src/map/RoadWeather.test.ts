import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compassFromDegrees,
  fetchRoadWeatherStations,
  formatTemperature,
  mergeRoadWeatherStations,
  parseRoadCondition,
  parseRoadWeatherObservations,
  parseRoadWeatherStations,
  resetRoadWeatherCaches,
} from './RoadWeather';

const stationsPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 1012,
      geometry: { type: 'Point', coordinates: [24.667305, 60.153507, 0] },
      properties: {
        id: 1012,
        name: 'kt51_Espoo_Kivenlahti',
        collectionStatus: 'GATHERING',
        municipality: 'Espoo',
        province: 'Uusimaa',
        names: { en: 'Road 51 Espoo, Kivenlahti', fi: 'Tie 51 Espoo, Kivenlahti' },
        roadAddress: { roadNumber: 51 },
      },
    },
    {
      type: 'Feature',
      id: 1,
      geometry: { type: 'Point', coordinates: [24, 60] },
      properties: { id: 1, name: 'removed', collectionStatus: 'REMOVED_TEMPORARILY' },
    },
  ],
};

const dataPayload = {
  dataUpdatedTime: '2026-09-05T11:56:25Z',
  stations: [
    {
      id: 1012,
      dataUpdatedTime: '2026-09-05T11:56:25Z',
      sensorValues: [
        { name: 'ILMA', value: 17.1, unit: '°C', measuredTime: '2026-09-05T11:55:45Z' },
        { name: 'TIE_1', value: 1.2, unit: '°C' },
        { name: 'KELI_1', value: 7 },
        { name: 'JÄÄN_MÄÄRÄ1', value: 0.4, unit: 'mm' },
        { name: 'KITKA1', value: 0.28, unit: 'µ' },
        { name: 'ILMA_DERIVAATTA', value: -0.4 },
      ],
    },
  ],
};

afterEach(() => {
  resetRoadWeatherCaches();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('road weather parsing', () => {
  it('keeps gathering stations and merges temperature and ice readings', () => {
    const stations = parseRoadWeatherStations(stationsPayload);
    const observations = parseRoadWeatherObservations(dataPayload);
    const merged = mergeRoadWeatherStations(stations, observations);
    expect(merged).toEqual([expect.objectContaining({
      id: '1012',
      name: 'Road 51 Espoo, Kivenlahti',
      coordinates: [24.667305, 60.153507],
      municipality: 'Espoo',
      roadNumber: 51,
      airTemperature: 17.1,
      roadTemperature: 1.2,
      roadCondition: 'ice',
      roadConditionLabel: 'Ice',
      iceMm: 0.4,
      friction: 0.28,
      icy: true,
    })]);
  });

  it('maps road-condition codes and compact temperatures', () => {
    expect(parseRoadCondition(1)).toEqual({ kind: 'dry', label: 'Dry', icy: false });
    expect(parseRoadCondition(6)?.icy).toBe(true);
    expect(formatTemperature(17.1)).toBe('17°');
    expect(formatTemperature(-3.4)).toBe('-3.4°');
    expect(compassFromDegrees(323)).toBe('NW');
  });
});

describe('road weather requests', () => {
  it('identifies the app and caches the station list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const body = url.endsWith('/data') ? dataPayload : stationsPayload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchRoadWeatherStations();
    const second = await fetchRoadWeatherStations();

    expect(first).toHaveLength(1);
    expect(first[0].airTemperature).toBe(17.1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://tie.digitraffic.fi/api/weather/v1/stations',
      'https://tie.digitraffic.fi/api/weather/v1/stations/data',
    ]);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Digitraffic-User': 'katu-maps',
      }),
    }));
  });
});
