import type { Page, Route } from '@playwright/test';

const DIGITRANSIT_ENDPOINT = 'https://api.digitransit.fi/routing/v2/finland/gtfs/v1';
const TRANSITOUS_API = 'https://api.transitous.org/api/v6';
const TRANSITOUS_ROUTES = 'https://api.transitous.org/api/experimental/map/routes';
const VALHALLA_ENDPOINT = 'https://valhalla1.openstreetmap.de/route';
const OPENCHARGEMAP_ENDPOINT = 'https://api.openchargemap.io/v3/poi';

export const visualFixture = {
  id: 'tampere-ui-v1',
  stopId: 'visual:Keskustori',
  tripId: 'visual:tram-3-trip',
  origin: [23.7609, 61.4981] as [number, number],
  destination: [23.7812, 61.4957] as [number, number],
};

const stationStop = {
  gtfsId: 'visual:TampereStation',
  name: 'Tampere railway station',
  lat: 61.4984,
  lon: 23.7730,
  vehicleMode: 'RAIL',
  locationType: 'STATION',
};

const stops = [
  { gtfsId: 'visual:Pyynikintori', name: 'Pyynikintori', lat: 61.4974, lon: 23.7429, vehicleMode: 'TRAM', locationType: 'STOP' },
  { gtfsId: visualFixture.stopId, name: 'Keskustori', lat: 61.4981, lon: 23.7609, vehicleMode: 'TRAM', locationType: 'STOP' },
  { gtfsId: 'visual:Koskipuisto', name: 'Koskipuisto', lat: 61.4990, lon: 23.7678, vehicleMode: 'TRAM', locationType: 'STOP' },
  { gtfsId: 'visual:Tulli', name: 'Tulli', lat: 61.4980, lon: 23.7775, vehicleMode: 'TRAM', locationType: 'STOP' },
  { gtfsId: 'visual:Sammonaukio', name: 'Sammonaukio', lat: 61.4955, lon: 23.7895, vehicleMode: 'TRAM', locationType: 'STOP' },
  { gtfsId: 'visual:Kaleva', name: 'Kaleva', lat: 61.4945, lon: 23.8060, vehicleMode: 'TRAM', locationType: 'STOP' },
  { gtfsId: 'visual:Hervanta', name: 'Hervantakeskus', lat: 61.4498, lon: 23.8457, vehicleMode: 'TRAM', locationType: 'STOP' },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function fixtureClock() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const serviceDay = Math.floor(nowSeconds / 86_400) * 86_400;
  const secondsOfDay = nowSeconds - serviceDay;
  const scheduled = secondsOfDay + 5 * 60;
  return {
    serviceDay,
    scheduled,
    iso: (offsetMinutes: number) => new Date((serviceDay + scheduled + offsetMinutes * 60) * 1000).toISOString(),
  };
}

function departureStopTime(
  clock: ReturnType<typeof fixtureClock>,
  offsetMinutes: number,
  options: {
    route: string;
    mode: string;
    headsign: string;
    tripId: string;
    color: string;
    delayMinutes?: number;
    cancelled?: boolean;
  },
) {
  const scheduledDeparture = clock.scheduled + offsetMinutes * 60;
  return {
    serviceDay: clock.serviceDay,
    scheduledDeparture,
    realtimeDeparture: scheduledDeparture + (options.delayMinutes ?? 0) * 60,
    realtime: options.delayMinutes !== undefined,
    realtimeState: options.cancelled ? 'CANCELED' : 'UPDATED',
    headsign: options.headsign,
    trip: {
      gtfsId: options.tripId,
      route: {
        gtfsId: `visual:route:${options.route}`,
        shortName: options.route,
        longName: `${options.route} to ${options.headsign}`,
        mode: options.mode,
        color: options.color,
        textColor: 'FFFFFF',
      },
    },
  };
}

function tripCalls(clock: ReturnType<typeof fixtureClock>) {
  return stops.map((stop, index) => {
    const scheduledTime = clock.iso((index - 1) * 4);
    const realtimeTime = clock.iso((index - 1) * 4 + 2);
    return {
      stopLocation: {
        gtfsId: stop.gtfsId,
        name: stop.name,
        lat: stop.lat,
        lon: stop.lon,
        parentStation: null,
      },
      schedule: { time: { arrival: scheduledTime, departure: scheduledTime } },
      realTime: {
        arrival: { time: realtimeTime, delay: 'PT2M' },
        departure: { time: realtimeTime, delay: 'PT2M' },
      },
    };
  });
}

function place(name: string, lat: number, lon: number) {
  return {
    name,
    lat,
    lon,
    stop: {
      gtfsId: `visual:${name.replaceAll(' ', '')}`,
      parentStation: null,
    },
  };
}

function planLeg({
  mode,
  route,
  headsign,
  from,
  to,
  start,
  end,
  transit = true,
  tripId,
  delay = 'PT0S',
}: {
  mode: string;
  route?: string;
  headsign?: string;
  from: ReturnType<typeof place>;
  to: ReturnType<typeof place>;
  start: string;
  end: string;
  transit?: boolean;
  tripId?: string;
  delay?: string;
}) {
  return {
    mode,
    transitLeg: transit,
    realTime: transit,
    realtimeState: 'UPDATED',
    distance: 900,
    serviceDate: start.slice(0, 10),
    start: { scheduledTime: start, estimated: { time: start, delay } },
    end: { scheduledTime: end, estimated: { time: end, delay } },
    from,
    to,
    headsign,
    trip: tripId ? { gtfsId: tripId } : null,
    route: route ? {
      shortName: route,
      longName: route,
      color: mode === 'BUS' ? '167052' : mode === 'TRAM' ? '1769E8' : '7146A0',
      textColor: 'FFFFFF',
    } : null,
    legGeometry: null,
  };
}

function planFixture(clock: ReturnType<typeof fixtureClock>) {
  const kesk = place('Keskustori', 61.4981, 23.7609);
  const koski = place('Koskipuisto', 61.4990, 23.7678);
  const tulli = place('Tulli', 61.4980, 23.7775);
  const hall = place('Tampere-talo', 61.4957, 23.7812);
  const station = place('Tampere railway station', 61.4984, 23.7730);

  const directStart = clock.iso(0);
  const directEnd = clock.iso(12);
  return {
    planConnection: {
      edges: [
        {
          node: {
            duration: 720,
            start: directStart,
            end: directEnd,
            numberOfTransfers: 0,
            legs: [
              planLeg({ mode: 'TRAM', route: '3', headsign: 'Hervanta', from: kesk, to: tulli, start: directStart, end: clock.iso(9), tripId: visualFixture.tripId, delay: 'PT2M' }),
              planLeg({ mode: 'WALK', from: tulli, to: hall, start: clock.iso(9), end: directEnd, transit: false }),
            ],
          },
        },
        {
          node: {
            duration: 1080,
            start: clock.iso(3),
            end: clock.iso(21),
            numberOfTransfers: 1,
            legs: [
              planLeg({ mode: 'BUS', route: '7', headsign: 'Linnainmaa', from: kesk, to: koski, start: clock.iso(3), end: clock.iso(9), tripId: 'visual:bus-7-trip' }),
              planLeg({ mode: 'TRAM', route: '1', headsign: 'Kaupin kampus', from: koski, to: tulli, start: clock.iso(11), end: clock.iso(17), tripId: 'visual:tram-1-trip' }),
              planLeg({ mode: 'WALK', from: tulli, to: hall, start: clock.iso(17), end: clock.iso(21), transit: false }),
            ],
          },
        },
        {
          node: {
            duration: 1320,
            start: clock.iso(6),
            end: clock.iso(28),
            numberOfTransfers: 0,
            legs: [
              planLeg({ mode: 'WALK', from: kesk, to: station, start: clock.iso(6), end: clock.iso(13), transit: false }),
              planLeg({ mode: 'RAIL', route: 'M', headsign: 'Nokia', from: station, to: hall, start: clock.iso(16), end: clock.iso(28), tripId: 'visual:train-m-trip' }),
            ],
          },
        },
      ],
    },
  };
}

function photonFixture(query: string) {
  const normalized = query.toLocaleLowerCase();
  const features = [];
  if ('keskustori'.includes(normalized) || normalized.includes('keskustori')) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: visualFixture.origin },
      properties: {
        name: 'Keskustori',
        city: 'Tampere',
        country: 'Finland',
        osm_type: 'N',
        osm_id: 1001,
        osm_value: 'square',
      },
    });
  }
  if (
    'tampere-talo'.includes(normalized)
    || 'tampere hall'.includes(normalized)
    || normalized === 'tampere'
  ) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: visualFixture.destination },
      properties: {
        name: 'Tampere-talo',
        street: 'Yliopistonkatu 55',
        city: 'Tampere',
        country: 'Finland',
        osm_type: 'W',
        osm_id: 2002,
        osm_value: 'arts_centre',
        opening_hours: 'Mo-Su 08:00-22:00',
        website: 'https://www.tampere-talo.fi',
      },
    });
  }
  return { features };
}

async function handleDigitransit(route: Route, clock: ReturnType<typeof fixtureClock>) {
  const requestBody = route.request().postDataJSON() as { query?: string } | null;
  const query = requestBody?.query ?? '';

  if (query.includes('StopsByBounds')) {
    return json(route, { data: { stopsByBbox: [...stops, stationStop] } });
  }
  if (query.includes('Departures')) {
    return json(route, {
      data: {
        stop: {
          stoptimesWithoutPatterns: [
            departureStopTime(clock, 0, { route: '3', mode: 'TRAM', headsign: 'Hervanta', tripId: visualFixture.tripId, color: '8554C7', delayMinutes: 2 }),
            departureStopTime(clock, 6, { route: '7', mode: 'BUS', headsign: 'Linnainmaa', tripId: 'visual:bus-7-trip', color: '2F6FB0' }),
            departureStopTime(clock, 12, { route: '1', mode: 'TRAM', headsign: 'Kaupin kampus', tripId: 'visual:tram-1-trip', color: 'D33A2C' }),
            departureStopTime(clock, 18, { route: '6', mode: 'BUS', headsign: 'Pirkkala', tripId: 'visual:bus-6-trip', color: '4F9B70', cancelled: true }),
          ],
        },
        station: null,
      },
    });
  }
  if (query.includes('TripDetails')) {
    return json(route, {
      data: {
        trip: {
          gtfsId: visualFixture.tripId,
          tripGeometry: null,
          onServiceDate: { stopCalls: tripCalls(clock) },
        },
      },
    });
  }
  if (query.includes('Plan')) {
    return json(route, { data: planFixture(clock) });
  }
  return json(route, { data: {} });
}

function openMeteoFixture(url: URL, clock: ReturnType<typeof fixtureClock>) {
  const latitudes = (url.searchParams.get('latitude') ?? '61.5').split(',').filter(Boolean);
  const times = Array.from({ length: 12 }, (_, index) => clock.iso(index * 60).slice(0, 16));
  const dates = [times[0].slice(0, 10), clock.iso(24 * 60).slice(0, 10)];
  if (latitudes.length > 1) {
    return latitudes.map((_, index) => ({
      hourly: {
        time: times,
        cloud_cover: times.map(() => 35 + (index % 5) * 8),
        precipitation: times.map((__, hour) => (hour > 5 ? 0.3 + (index % 4) * 0.2 : 0)),
      },
    }));
  }
  return {
    timezone: 'Europe/Helsinki',
    current: {
      time: times[0],
      temperature_2m: 16,
      weather_code: 2,
      cloud_cover: 44,
      precipitation: 0,
      wind_speed_10m: 9,
      wind_direction_10m: 210,
      relative_humidity_2m: 62,
      snowfall: 0,
      snow_depth: 0,
    },
    hourly: {
      time: times,
      temperature_2m: times.map((_, index) => 16 - index * 0.3),
      weather_code: times.map((_, index) => (index > 6 ? 61 : 2)),
      cloud_cover: times.map((_, index) => 40 + index),
      precipitation: times.map((_, index) => (index > 6 ? 0.4 : 0)),
      precipitation_probability: times.map((_, index) => (index > 6 ? 55 : 12)),
      snowfall: times.map(() => 0),
      snow_depth: times.map(() => 0),
      wind_speed_10m: times.map(() => 9),
    },
    daily: {
      time: dates,
      weather_code: [2, 61],
      temperature_2m_max: [17, 14],
      temperature_2m_min: [11, 9],
      precipitation_sum: [0.2, 3.4],
      precipitation_probability_max: [20, 70],
      snowfall_sum: [0, 0],
    },
  };
}

export async function installVisualProviderFixtures(page: Page) {
  const clock = fixtureClock();

  await page.route('https://photon.komoot.io/api/**', route => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    if (query === 'ProviderError') return json(route, { message: 'fixture outage' }, 503);
    return json(route, photonFixture(query));
  });

  await page.route(`${DIGITRANSIT_ENDPOINT}**`, route => handleDigitransit(route, clock));
  await page.route(`${TRANSITOUS_API}**`, route => {
    const url = route.request().url();
    if (url.includes('/map/stops')) return json(route, []);
    return json(route, { stopTimes: [], legs: [] });
  });
  await page.route(`${TRANSITOUS_ROUTES}**`, route => json(route, []));

  await page.route('https://nominatim.openstreetmap.org/**', route => json(route, {
    display_name: 'Tampere-talo, Yliopistonkatu 55, Tampere',
    address: { house_number: '55', road: 'Yliopistonkatu', city: 'Tampere' },
    extratags: {
      description: 'Tampere Hall is a concert and congress centre in central Tampere.',
      opening_hours: 'Mo-Su 08:00-22:00',
      website: 'https://www.tampere-talo.fi',
      phone: '+358 3 243 4111',
    },
  }));

  await page.route(VALHALLA_ENDPOINT, route => json(route, {
    trip: {
      summary: { length: 1.1, time: 900 },
      legs: [{
        shape: {
          type: 'LineString',
          coordinates: [
            visualFixture.origin,
            [23.7678, 61.4990],
            [23.7730, 61.4984],
            visualFixture.destination,
          ],
        },
      }],
    },
  }));

  await page.route(`${OPENCHARGEMAP_ENDPOINT}**`, route => json(route, [{
    ID: 189853,
    AddressInfo: {
      Title: 'Koskipuisto charging',
      AddressLine1: 'Koskikatu 1',
      Town: 'Tampere',
      Postcode: '33100',
      Country: { Title: 'Finland' },
      Latitude: 61.4981,
      Longitude: 23.7609,
    },
    OperatorInfo: { Title: 'Virta' },
    UsageType: { Title: 'Public' },
    StatusType: { Title: 'Operational', IsOperational: true },
    NumberOfPoints: 4,
    Connections: [
      { ID: 1, ConnectionType: { Title: 'CCS (Type 2)' }, PowerKW: 150, Quantity: 2, StatusType: { Title: 'Operational', IsOperational: true } },
      { ID: 2, ConnectionType: { Title: 'Type 2' }, PowerKW: 22, Quantity: 2, StatusType: { Title: 'Operational', IsOperational: true } },
    ],
  }]));

  await page.route('https://api.open-meteo.com/**', route => {
    return json(route, openMeteoFixture(new URL(route.request().url()), clock));
  });
}
