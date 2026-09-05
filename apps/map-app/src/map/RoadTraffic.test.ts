import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRoadTrafficStations,
  mergeRoadTrafficStations,
  offsetPoint,
  parseRoadTrafficObservations,
  parseRoadTrafficStations,
  resetRoadTrafficCaches,
  stationCongestion,
  trafficCongestion,
  trafficSegmentCoordinates,
} from './RoadTraffic';

const stationsPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 23001,
      geometry: { type: 'Point', coordinates: [25.689529, 60.417002, 0] },
      properties: {
        id: 23001,
        name: 'vt7_Rita',
        collectionStatus: 'GATHERING',
        municipality: 'Porvoo',
        names: { en: 'Road 7 Porvoo, Rita' },
        roadAddress: { roadNumber: 7 },
        bearing: 60,
        freeFlowSpeed1: 105,
        freeFlowSpeed2: 95,
        direction1Municipality: 'Kotka',
        direction2Municipality: 'Helsinki',
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
  dataUpdatedTime: '2026-09-05T11:58:05Z',
  stations: [
    {
      id: 23001,
      dataUpdatedTime: '2026-09-05T11:58:05Z',
      sensorValues: [
        { name: 'KESKINOPEUS_5MIN_LIUKUVA_SUUNTA1', value: 28, unit: 'km/h', measuredTime: '2026-09-05T11:57:39Z' },
        { name: 'OHITUKSET_5MIN_LIUKUVA_SUUNTA1', value: 1640, unit: 'kpl/h' },
        { name: 'KESKINOPEUS_5MIN_LIUKUVA_SUUNTA2', value: 92, unit: 'km/h' },
        { name: 'OHITUKSET_5MIN_LIUKUVA_SUUNTA2', value: 210, unit: 'kpl/h' },
      ],
    },
  ],
};

afterEach(() => {
  resetRoadTrafficCaches();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('road traffic parsing', () => {
  it('keeps gathering stations and colours congested directions red', () => {
    const stations = parseRoadTrafficStations(stationsPayload);
    const observations = parseRoadTrafficObservations(dataPayload);
    const merged = mergeRoadTrafficStations(stations, observations);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Road 7 Porvoo, Rita');
    expect(merged[0].roadNumber).toBe(7);
    expect(merged[0].direction1).toEqual(expect.objectContaining({
      municipality: 'Kotka',
      speedKmh: 28,
      volumePerHour: 1640,
      freeFlowKmh: 105,
      congestion: 'severe',
    }));
    expect(merged[0].direction2.congestion).toBe('free');
    expect(stationCongestion(merged[0])).toBe('severe');
  });

  it('classifies congestion from speed, free-flow and volume', () => {
    expect(trafficCongestion(100, 105)).toBe('free');
    expect(trafficCongestion(60, 100)).toBe('slow');
    expect(trafficCongestion(40, 100)).toBe('heavy');
    expect(trafficCongestion(20, 100)).toBe('severe');
    expect(trafficCongestion(undefined, undefined, 1500)).toBe('severe');
  });

  it('draws a short directional segment from a station point', () => {
    const north = offsetPoint(24, 60, 0, 1000);
    expect(north[0]).toBeCloseTo(24, 4);
    expect(north[1]).toBeGreaterThan(60);
    const segment = trafficSegmentCoordinates(25.689529, 60.417002, 60, 1);
    expect(segment).toHaveLength(2);
    expect(segment[0][0]).not.toBeCloseTo(segment[1][0], 5);
  });

  it('reads the road number from a Finnish station id when metadata omits roadAddress', () => {
    const stations = parseRoadTrafficStations({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [25.029364, 60.241347] },
        properties: { id: 23149, name: 'st101_Malmi', collectionStatus: 'GATHERING', bearing: 90 },
      }],
    });
    expect(stations[0].roadNumber).toBe(101);
  });
});

describe('road traffic requests', () => {
  it('identifies the app and caches the station list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/data') ? dataPayload : stationsPayload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchRoadTrafficStations();
    const second = await fetchRoadTrafficStations();

    expect(first).toHaveLength(1);
    expect(first[0].direction1.congestion).toBe('severe');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://tie.digitraffic.fi/api/tms/v1/stations',
      'https://tie.digitraffic.fi/api/tms/v1/stations/data',
    ]);
  });
});
