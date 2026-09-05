import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloudOverlayColor,
  closestHourIndex,
  fetchForecastGrid,
  fetchViewedWeather,
  forecastBoundsUsable,
  forecastGridPoints,
  overlayBoundsForView,
  padForecastBounds,
  parseForecastGrid,
  parseViewedWeather,
  precipOverlayColor,
  resetWeatherCaches,
  roundViewedCoordinate,
  sampleGridValue,
  upcomingHourlyForecast,
  viewedWeatherCacheKey,
  weatherIconKind,
  weatherSummary,
} from './Weather';

const helsinkiPayload = {
  timezone: 'Europe/Helsinki',
  current: {
    time: '2026-09-05T19:45',
    temperature_2m: 16.7,
    weather_code: 3,
    cloud_cover: 98,
    precipitation: 0,
    wind_speed_10m: 12.2,
    wind_direction_10m: 220,
    relative_humidity_2m: 71,
    snowfall: 0,
    snow_depth: 0,
  },
  hourly: {
    time: ['2026-09-05T19:00', '2026-09-05T20:00'],
    temperature_2m: [16.4, 15.8],
    weather_code: [3, 61],
    cloud_cover: [91, 97],
    precipitation: [0, 0.6],
    precipitation_probability: [10, 40],
    snowfall: [0, 0],
    snow_depth: [0, 0],
    wind_speed_10m: [12, 11],
  },
  daily: {
    time: ['2026-09-05', '2026-09-06'],
    weather_code: [3, 61],
    temperature_2m_max: [17, 14],
    temperature_2m_min: [12, 9],
    precipitation_sum: [0.2, 4.1],
    precipitation_probability_max: [20, 70],
    snowfall_sum: [0, 0],
  },
};

afterEach(() => {
  resetWeatherCaches();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('viewed weather parsing', () => {
  it('maps Open-Meteo current, hourly and daily fields', () => {
    const weather = parseViewedWeather(helsinkiPayload, [24.938, 60.17]);
    expect(weather?.current).toEqual(expect.objectContaining({
      temperature: 16.7,
      icon: 'cloudy',
      summary: 'Cloudy',
      cloudCover: 98,
      precipitationProbability: 10,
    }));
    expect(weather?.hourly[1].icon).toBe('rain');
    expect(weather?.daily[1].precipitationProbabilityMax).toBe(70);
  });

  it('classifies WMO weather codes', () => {
    expect(weatherIconKind(0)).toBe('clear');
    expect(weatherIconKind(2)).toBe('partly-cloudy');
    expect(weatherIconKind(80)).toBe('rain');
    expect(weatherIconKind(73)).toBe('snow');
    expect(weatherSummary(95)).toBe('Thunderstorm');
  });

  it('rounds cache keys so nearby pans reuse a forecast', () => {
    expect(roundViewedCoordinate(24.93841)).toBe(24.938);
    expect(viewedWeatherCacheKey(24.9384, 60.1699)).toBe(viewedWeatherCacheKey(24.9381, 60.1702));
  });
});

describe('viewed weather requests', () => {
  it('fetches a rounded coordinate and caches the parsed forecast', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(helsinkiPayload), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = await fetchViewedWeather(24.93841, 60.16992);
    const second = await fetchViewedWeather(24.93812, 60.17011);
    expect(first.current.temperature).toBe(16.7);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('latitude=60.17');
    expect(String(fetchMock.mock.calls[0][0])).toContain('longitude=24.938');
  });
});

describe('forecast overlay grid', () => {
  it('builds a regular sample grid from west/north', () => {
    const points = forecastGridPoints({ west: 24, south: 60, east: 26, north: 62 }, 3, 2);
    expect(points.latitudes).toEqual([62, 62, 62, 60, 60, 60]);
    expect(points.longitudes).toEqual([24, 25, 26, 24, 25, 26]);
  });

  it('interpolates overlay values and keeps clear/dry cells transparent', () => {
    const payload = [
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [0], precipitation: [0] } },
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [100], precipitation: [4] } },
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [0], precipitation: [0] } },
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [100], precipitation: [4] } },
    ];
    const grid = parseForecastGrid(payload, { west: 0, south: 0, east: 1, north: 1 }, 2, 2);
    expect(grid).not.toBeNull();
    expect(sampleGridValue(grid!, 'cloud', 0, 0.5, 0.5)).toBeCloseTo(50);
    expect(cloudOverlayColor(0)[3]).toBe(0);
    expect(precipOverlayColor(0)[3]).toBe(0);
    expect(precipOverlayColor(3)[3]).toBeGreaterThan(80);
  });
});

describe('closest forecast hour', () => {
  it('picks the nearest hourly step', () => {
    expect(closestHourIndex(['2026-09-05T10:00Z', '2026-09-05T11:00Z', '2026-09-05T12:00Z'], Date.parse('2026-09-05T11:12Z'))).toBe(1);
  });

  it('starts the hourly strip at the current hour', () => {
    const hours = upcomingHourlyForecast([
      { time: '2026-09-05T10:00Z', icon: 'clear', summary: 'Clear', temperature: 12 },
      { time: '2026-09-05T11:00Z', icon: 'cloudy', summary: 'Cloudy', temperature: 11 },
      { time: '2026-09-05T12:00Z', icon: 'rain', summary: 'Rain', temperature: 10 },
    ], 2, Date.parse('2026-09-05T11:12Z'));
    expect(hours.map((hour) => hour.time)).toEqual(['2026-09-05T11:00Z', '2026-09-05T12:00Z']);
  });
});

describe('forecast overlay bounds', () => {
  it('rejects antimeridian-spanning views', () => {
    expect(forecastBoundsUsable({ west: 170, south: 10, east: -170, north: 20 })).toBe(false);
    expect(forecastBoundsUsable({ west: -25, south: 59, east: 30, north: 71 })).toBe(true);
  });

  it('pads a viewport without wrapping the date line', () => {
    expect(padForecastBounds({ west: 23, south: 61, east: 25, north: 63 }, 0.5)).toEqual({
      west: 22,
      south: 60,
      east: 26,
      north: 64,
    });
  });

  it('falls back to a local window around the map centre on a world view', () => {
    expect(overlayBoundsForView(
      { lng: 24, lat: 61 },
      { west: -180, south: -85, east: 180, north: 85 },
    )).toEqual({
      west: 19,
      south: 57,
      east: 29,
      north: 65,
    });
  });
});

describe('forecast overlay requests', () => {
  it('fetches a multi-location cloud and rain grid', async () => {
    const payload = [
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [10], precipitation: [0] } },
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [20], precipitation: [0.2] } },
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [30], precipitation: [0.4] } },
      { hourly: { time: ['2026-09-05T18:00'], cloud_cover: [40], precipitation: [0.6] } },
    ];
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const bounds = { west: 24, south: 60, east: 25, north: 61 };
    const first = await fetchForecastGrid(bounds, 2, 2);
    const second = await fetchForecastGrid(bounds, 2, 2);
    expect(first.cloudCover[3][0]).toBe(40);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('hourly=cloud_cover%2Cprecipitation');
  });
});
