import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRoadTrafficMessages,
  formatTrafficMessageFeature,
  formatTrafficMessageTitle,
  parseRoadTrafficMessages,
  representativePoint,
  resetRoadTrafficMessageCaches,
  situationKind,
} from './RoadTrafficMessages';

const now = Date.parse('2026-09-05T12:00:00Z');

const roadworksPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [23.826203, 61.504722] },
      properties: {
        situationId: 'GUID-ROADWORK',
        situationType: 'road work',
        contact: { phone: '02002100', email: 'tampere.liikennekeskus@fintraffic.fi' },
        announcements: [{
          language: 'fi',
          title: 'Tie 12, Tampere. Tietyö. ',
          location: { description: 'Tie 12 välillä Tampere - Lahti, Tampere.' },
          locationDetails: {
            roadAddressLocation: {
              primaryPoint: {
                municipality: 'Tampere',
                province: 'Pirkanmaa',
                roadAddress: { road: 12 },
                roadName: 'Teiskontie',
              },
              direction: 'both',
            },
          },
          features: [
            { name: 'Ajokaista suljettu liikenteeltä' },
            { name: 'Nopeusrajoitus', quantity: 50, unit: 'km/h' },
          ],
          roadWorkPhases: [{
            workTypes: [
              { type: 'resurfacing', description: 'Päällystys- tai paikkaustyö' },
              { type: 'other', description: '' },
            ],
            workingHours: [
              { weekday: 'Monday', startTime: '22:00', endTime: '06:00' },
              { weekday: 'Wednesday', startTime: '22:00', endTime: '06:00' },
            ],
          }],
          timeAndDuration: { startTime: '2026-08-31T21:00:00.000Z', endTime: '2026-09-11T20:59:59.999Z' },
          sender: 'Fintraffic Tieliikennekeskus',
        }],
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24, 60] },
      properties: {
        situationId: 'GUID-PAST',
        situationType: 'road work',
        announcements: [{
          language: 'fi',
          title: 'Expired',
          timeAndDuration: { startTime: '2026-08-01T00:00:00.000Z', endTime: '2026-08-02T00:00:00.000Z' },
        }],
      },
    },
  ],
};

const announcementsPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[23.771694, 61.498527], [23.77585, 61.498877]],
      },
      properties: {
        situationId: 'GUID-INCIDENT',
        situationType: 'traffic announcement',
        trafficAnnouncementType: 'general',
        announcements: [{
          language: 'fi',
          title: 'Itsenäisyydenkatu, Tampere. Liikennetiedote. ',
          location: { description: 'Itsenäisyydenkatu, Tampere.\nTarkempi paikka: Välillä Rautatienkatu - Murtokatu.' },
          locationDetails: {
            roadAddressLocation: {
              primaryPoint: { municipality: 'Tampere', province: 'Pirkanmaa', roadName: 'Itsenäisyydenkatu', roadAddress: {} },
              direction: 'unknown',
            },
          },
          features: [{ name: 'Tie on suljettu liikenteeltä' }, { name: 'Liikenne saattaa ruuhkautua' }],
          roadWorkPhases: [],
          comment: 'Itsenäisyydenkadun alikulku on suljettu liikenteeltä.',
          timeAndDuration: { startTime: '2026-06-01T03:00:00.000Z' },
          sender: 'Tampereen kaupunki',
        }],
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [25, 60] },
      properties: {
        situationId: 'GUID-ENDED',
        situationType: 'traffic announcement',
        trafficAnnouncementType: 'ended',
        announcements: [{
          language: 'fi',
          title: 'Kehä I. Tilanne ohi.',
          timeAndDuration: { startTime: '2026-09-05T11:00:00.000Z' },
        }],
      },
    },
  ],
};

afterEach(() => {
  resetRoadTrafficMessageCaches();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('road traffic messages', () => {
  it('parses active roadworks and incidents and skips ended or expired ones', () => {
    const roadworks = parseRoadTrafficMessages(roadworksPayload, 'roadwork', now);
    const incidents = parseRoadTrafficMessages(announcementsPayload, 'incident', now);
    expect(roadworks).toHaveLength(1);
    expect(roadworks[0]).toEqual(expect.objectContaining({
      id: 'GUID-ROADWORK',
      kind: 'roadwork',
      name: 'Road 12, Tampere',
      municipality: 'Tampere',
      roadNumber: 12,
      direction: 'Both directions',
      scheduled: false,
      workTypes: ['Resurfacing'],
      workingHours: ['Mon 22:00–06:00', 'Wed 22:00–06:00'],
    }));
    expect(roadworks[0].features.map(formatTrafficMessageFeature)).toEqual([
      'Lane closed',
      'Speed limit 50 km/h',
    ]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toEqual(expect.objectContaining({
      id: 'GUID-INCIDENT',
      kind: 'incident',
      name: 'Itsenäisyydenkatu, Tampere',
      comment: 'Itsenäisyydenkadun alikulku on suljettu liikenteeltä.',
      features: [
        { name: 'Road closed' },
        { name: 'Traffic may queue' },
      ],
    }));
    expect(incidents[0].coordinates[0]).toBeCloseTo(23.771694, 5);
  });

  it('formats titles and line midpoints', () => {
    expect(formatTrafficMessageTitle('Tie 7, Hamina. Tietyö. ', 'roadwork')).toBe('Road 7, Hamina');
    expect(situationKind('TRAFFIC_ANNOUNCEMENT')).toBe('incident');
    const point = representativePoint({
      type: 'LineString',
      coordinates: [[23.771694, 61.498527], [23.77585, 61.498877]],
    });
    expect(point?.[0]).toBeCloseTo(23.771694, 5);
  });

  it('fetches roadworks and announcements together and caches the result', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('roadworks') ? roadworksPayload : announcementsPayload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchRoadTrafficMessages();
    const second = await fetchRoadTrafficMessages();
    expect(first.some((message) => message.id === 'GUID-ROADWORK')).toBe(true);
    expect(first.some((message) => message.id === 'GUID-INCIDENT')).toBe(true);
    expect(first.some((message) => message.id === 'GUID-ENDED' || message.id === 'GUID-PAST')).toBe(false);
    expect(second).toEqual(first);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://tie.digitraffic.fi/api/traffic-message/v2/roadworks',
      'https://tie.digitraffic.fi/api/traffic-message/v2/traffic-announcements',
    ]);
  });
});
