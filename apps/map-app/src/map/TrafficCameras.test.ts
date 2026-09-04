import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchTrafficCameraDetails,
  fetchTrafficCameraStations,
  formatCameraMeasuredTime,
  formatTrafficCameraName,
  localizedTrafficCameraName,
  parseTrafficCameraDetails,
  parseTrafficCameraStations,
  resetTrafficCameraCaches,
  weathercamImageUrl,
} from './TrafficCameras';

const stationsPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'C04507',
      geometry: { type: 'Point', coordinates: [23.769505, 61.462733, 0] },
      properties: {
        id: 'C04507',
        name: 'vt3_Tampere_Lakalaiva',
        collectionStatus: 'GATHERING',
        presets: [{ id: 'C0450701', inCollection: true }, { id: 'C0450702', inCollection: false }],
      },
    },
    {
      type: 'Feature',
      id: 'C00000',
      geometry: { type: 'Point', coordinates: [24, 60] },
      properties: {
        id: 'C00000',
        name: 'vt1_Removed',
        collectionStatus: 'REMOVED_TEMPORARILY',
        presets: [{ id: 'C0000001', inCollection: true }],
      },
    },
    {
      type: 'Feature',
      id: 'bad',
      geometry: { type: 'Point', coordinates: [181, 91] },
      properties: { id: 'bad', collectionStatus: 'GATHERING', presets: [{ id: 'x', inCollection: true }] },
    },
  ],
};

const detailsPayload = {
  type: 'Feature',
  id: 'C04507',
  geometry: { type: 'Point', coordinates: [23.769505, 61.462733, 0] },
  properties: {
    id: 'C04507',
    name: 'vt3_Tampere_Lakalaiva',
    collectionStatus: 'GATHERING',
    municipality: 'Tampere',
    province: 'Pirkanmaa',
    names: { fi: 'Tie 3 Tampere Lakalaiva', en: 'Road 3 Tampere Lakalaiva' },
    roadAddress: { roadNumber: 3 },
    presets: [
      {
        id: 'C0450701',
        presentationName: 'Helsinkiin',
        inCollection: true,
        direction: 'INCREASING_DIRECTION',
        imageUrl: 'https://weathercam.digitraffic.fi/C0450701.jpg',
      },
      {
        id: 'C0450709',
        presentationName: 'Tienpinta',
        inCollection: true,
        direction: 'SPECIAL_DIRECTION',
        imageUrl: 'https://weathercam.digitraffic.fi/C0450709.jpg',
      },
    ],
  },
};

const dataPayload = {
  id: 'C04507',
  dataUpdatedTime: '2026-09-04T21:48:42Z',
  presets: [
    { id: 'C0450701', measuredTime: '2026-09-04T21:47:52Z' },
    { id: 'C0450709', measuredTime: '2026-09-04T21:48:05Z' },
  ],
};

afterEach(() => {
  resetTrafficCameraCaches();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('traffic camera parsing', () => {
  it('keeps gathering stations and formats road names', () => {
    const stations = parseTrafficCameraStations(stationsPayload);
    expect(stations).toEqual([
      {
        id: 'C04507',
        name: 'VT 3 Tampere Lakalaiva',
        coordinates: [23.769505, 61.462733],
        municipality: undefined,
        province: undefined,
        roadNumber: undefined,
        collectionStatus: 'GATHERING',
        presetCount: 1,
      },
    ]);
  });

  it('prefers localized names and attaches cache-busted image URLs', () => {
    const details = parseTrafficCameraDetails(detailsPayload, dataPayload);
    expect(details?.name).toBe('Road 3 Tampere Lakalaiva');
    expect(details?.municipality).toBe('Tampere');
    expect(details?.roadNumber).toBe(3);
    expect(details?.presets.map((preset) => preset.name)).toEqual(['Helsinkiin', 'Tienpinta']);
    expect(details?.presets[0].imageUrl).toContain('C0450701.jpg');
    expect(details?.presets[0].imageUrl).toContain(`t=${Date.parse('2026-09-04T21:47:52Z')}`);
    expect(details?.presets[0].thumbnailUrl).toContain('thumbnail=true');
  });

  it('formats compact road names and measured times', () => {
    expect(formatTrafficCameraName('kt51_Inkoo')).toBe('KT 51 Inkoo');
    expect(formatTrafficCameraName('yt3495_Tampere_Rautaharkko')).toBe('YT 3495 Tampere Rautaharkko');
    expect(localizedTrafficCameraName({ fi: 'Tie 12 Tampere' }, 'vt12_Tampere')).toBe('Tie 12 Tampere');
    expect(weathercamImageUrl('C0450701', { thumbnail: true, cacheKey: 'abc' }))
      .toBe('https://weathercam.digitraffic.fi/C0450701.jpg?thumbnail=true&t=abc');
    expect(formatCameraMeasuredTime('2026-09-04T21:47:52Z', Date.parse('2026-09-04T21:50:52Z')))
      .toContain('3 min ago');
  });
});

describe('traffic camera requests', () => {
  it('identifies the app and caches the station list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(stationsPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchTrafficCameraStations();
    const second = await fetchTrafficCameraStations();

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://tie.digitraffic.fi/api/weathercam/v1/stations');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Digitraffic-User': 'katu-maps',
      }),
    }));
  });

  it('loads station details and image timestamps together', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/data') ? dataPayload : detailsPayload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const details = await fetchTrafficCameraDetails('C04507');
    expect(details.presets).toHaveLength(2);
    expect(details.dataUpdatedTime).toBe('2026-09-04T21:48:42Z');
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://tie.digitraffic.fi/api/weathercam/v1/stations/C04507',
      'https://tie.digitraffic.fi/api/weathercam/v1/stations/C04507/data',
    ]);
  });
});
