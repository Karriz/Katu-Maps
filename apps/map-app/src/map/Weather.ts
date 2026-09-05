import { apiHttpError, fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';

export type WeatherIconKind = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

export type WeatherCurrent = {
  time: string;
  temperature: number;
  weatherCode: number;
  icon: WeatherIconKind;
  summary: string;
  cloudCover?: number;
  precipitation?: number;
  precipitationProbability?: number;
  windSpeed?: number;
  windDirection?: number;
  humidity?: number;
  snowfall?: number;
  snowDepth?: number;
};

export type WeatherHour = {
  time: string;
  temperature?: number;
  weatherCode?: number;
  icon: WeatherIconKind;
  summary: string;
  cloudCover?: number;
  precipitation?: number;
  precipitationProbability?: number;
  snowfall?: number;
  snowDepth?: number;
  windSpeed?: number;
};

export type WeatherDay = {
  date: string;
  weatherCode?: number;
  icon: WeatherIconKind;
  summary: string;
  temperatureMax?: number;
  temperatureMin?: number;
  precipitationSum?: number;
  precipitationProbabilityMax?: number;
  snowfallSum?: number;
};

export type ViewedWeather = {
  coordinates: [number, number];
  timezone?: string;
  current: WeatherCurrent;
  hourly: WeatherHour[];
  daily: WeatherDay[];
};

export type ForecastGrid = {
  west: number;
  south: number;
  east: number;
  north: number;
  columns: number;
  rows: number;
  times: string[];
  cloudCover: number[][];
  precipitation: number[][];
};

export type WeatherOverlayVariable = 'cloud' | 'precip';

export type GeoBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const POINT_TTL_MS = 15 * 60_000;
const GRID_TTL_MS = 15 * 60_000;
const POINT_DECIMALS = 3;

let pointCache: { key: string; weather: ViewedWeather; fetchedAt: number } | null = null;
const gridCache = new Map<string, { grid: ForecastGrid; fetchedAt: number }>();

export function resetWeatherCaches() {
  pointCache = null;
  gridCache.clear();
}

export function roundViewedCoordinate(value: number, decimals = POINT_DECIMALS) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function viewedWeatherCacheKey(longitude: number, latitude: number) {
  return `${roundViewedCoordinate(longitude)},${roundViewedCoordinate(latitude)}`;
}

export function weatherIconKind(code: number | undefined): WeatherIconKind {
  if (code === undefined || !Number.isFinite(code)) return 'cloudy';
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

export function weatherSummary(code: number | undefined) {
  const labels: Record<WeatherIconKind, string> = {
    clear: 'Clear',
    'partly-cloudy': 'Partly cloudy',
    cloudy: 'Cloudy',
    fog: 'Fog',
    drizzle: 'Drizzle',
    rain: 'Rain',
    snow: 'Snow',
    thunder: 'Thunderstorm',
  };
  return labels[weatherIconKind(code)];
}

export function formatWeatherTemperature(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return `${rounded}°`;
}

export function formatPercent(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return `${Math.round(value)}%`;
}

export function formatMillimetres(value: number | undefined, unit = 'mm') {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const digits = Math.abs(value) >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

export function formatWind(speed: number | undefined, direction: number | undefined) {
  if (speed === undefined || !Number.isFinite(speed)) return undefined;
  const compass = compassFromDegrees(direction);
  return compass ? `${speed.toFixed(0)} km/h ${compass}` : `${speed.toFixed(0)} km/h`;
}

export function compassFromDegrees(degrees: number | undefined) {
  if (degrees === undefined || !Number.isFinite(degrees)) return undefined;
  const headings = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return headings[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

export function closestHourIndex(times: string[], now = Date.now()) {
  if (!times.length) return 0;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const delta = Math.abs(Date.parse(time) - now);
    if (Number.isFinite(delta) && delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

export function upcomingHourlyForecast(hours: WeatherHour[], limit = 24, now = Date.now()) {
  const start = closestHourIndex(hours.map((hour) => hour.time), now);
  return hours.slice(start, start + limit);
}

export function padForecastBounds(bounds: GeoBounds, padding = 0.08): GeoBounds {
  const padX = (bounds.east - bounds.west) * padding;
  const padY = (bounds.north - bounds.south) * padding;
  return {
    west: bounds.west - padX,
    south: Math.max(-85, bounds.south - padY),
    east: bounds.east + padX,
    north: Math.min(85, bounds.north + padY),
  };
}

export function forecastBoundsUsable(bounds: GeoBounds) {
  return bounds.west < bounds.east
    && bounds.south < bounds.north
    && bounds.east - bounds.west <= 160
    && bounds.west >= -180
    && bounds.east <= 180;
}

export function overlayBoundsForView(center: { lng: number; lat: number }, viewport: GeoBounds): GeoBounds {
  const span = viewport.east - viewport.west;
  if (forecastBoundsUsable(viewport) && span <= 25) return padForecastBounds(viewport);
  const bounds = {
    west: Math.max(-180, center.lng - 5),
    south: Math.max(-85, center.lat - 4),
    east: Math.min(180, center.lng + 5),
    north: Math.min(85, center.lat + 4),
  };
  return forecastBoundsUsable(bounds) ? bounds : viewport;
}

export function isWeatherAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberSeries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => finiteNumber(entry));
}

function stringSeries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === 'string' ? entry : ''));
}

function hourFromParts(time: string, code: number | undefined, extras: Omit<WeatherHour, 'time' | 'weatherCode' | 'icon' | 'summary'>): WeatherHour {
  return {
    time,
    weatherCode: code,
    icon: weatherIconKind(code),
    summary: weatherSummary(code),
    ...extras,
  };
}

export function parseViewedWeather(payload: unknown, coordinates: [number, number]): ViewedWeather | null {
  if (!isRecord(payload)) return null;
  const current = isRecord(payload.current) ? payload.current : null;
  const hourly = isRecord(payload.hourly) ? payload.hourly : null;
  const daily = isRecord(payload.daily) ? payload.daily : null;
  if (!current && !hourly) return null;

  const hourlyTimes = stringSeries(hourly?.time);
  const hourlyCodes = numberSeries(hourly?.weather_code);
  const hourlyCloud = numberSeries(hourly?.cloud_cover);
  const hourlyPrecip = numberSeries(hourly?.precipitation);
  const hourlyPrecipProb = numberSeries(hourly?.precipitation_probability);
  const hourlyTemp = numberSeries(hourly?.temperature_2m);
  const hourlySnow = numberSeries(hourly?.snowfall);
  const hourlySnowDepth = numberSeries(hourly?.snow_depth);
  const hourlyWind = numberSeries(hourly?.wind_speed_10m);
  const hours: WeatherHour[] = hourlyTimes.map((time, index) => hourFromParts(time, hourlyCodes[index], {
    temperature: hourlyTemp[index],
    cloudCover: hourlyCloud[index],
    precipitation: hourlyPrecip[index],
    precipitationProbability: hourlyPrecipProb[index],
    snowfall: hourlySnow[index],
    snowDepth: hourlySnowDepth[index],
    windSpeed: hourlyWind[index],
  }));

  const currentCode = finiteNumber(current?.weather_code) ?? hours[closestHourIndex(hourlyTimes)]?.weatherCode;
  const nearestHour = hours[closestHourIndex(hourlyTimes)];
  const parsedCurrent: WeatherCurrent | null = current
    ? {
      time: text(current.time) ?? nearestHour?.time ?? new Date().toISOString(),
      temperature: finiteNumber(current.temperature_2m) ?? nearestHour?.temperature ?? 0,
      weatherCode: currentCode ?? 3,
      icon: weatherIconKind(currentCode),
      summary: weatherSummary(currentCode),
      cloudCover: finiteNumber(current.cloud_cover) ?? nearestHour?.cloudCover,
      precipitation: finiteNumber(current.precipitation) ?? nearestHour?.precipitation,
      precipitationProbability: nearestHour?.precipitationProbability,
      windSpeed: finiteNumber(current.wind_speed_10m),
      windDirection: finiteNumber(current.wind_direction_10m),
      humidity: finiteNumber(current.relative_humidity_2m),
      snowfall: finiteNumber(current.snowfall) ?? nearestHour?.snowfall,
      snowDepth: finiteNumber(current.snow_depth) ?? nearestHour?.snowDepth,
    }
    : nearestHour
      ? {
        time: nearestHour.time,
        temperature: nearestHour.temperature ?? 0,
        weatherCode: nearestHour.weatherCode ?? 3,
        icon: nearestHour.icon,
        summary: nearestHour.summary,
        cloudCover: nearestHour.cloudCover,
        precipitation: nearestHour.precipitation,
        precipitationProbability: nearestHour.precipitationProbability,
        windSpeed: nearestHour.windSpeed,
        snowfall: nearestHour.snowfall,
        snowDepth: nearestHour.snowDepth,
      }
      : null;
  if (!parsedCurrent) return null;

  const dailyDates = stringSeries(daily?.time);
  const dailyCodes = numberSeries(daily?.weather_code);
  const days: WeatherDay[] = dailyDates.map((date, index) => ({
    date,
    weatherCode: dailyCodes[index],
    icon: weatherIconKind(dailyCodes[index]),
    summary: weatherSummary(dailyCodes[index]),
    temperatureMax: numberSeries(daily?.temperature_2m_max)[index],
    temperatureMin: numberSeries(daily?.temperature_2m_min)[index],
    precipitationSum: numberSeries(daily?.precipitation_sum)[index],
    precipitationProbabilityMax: numberSeries(daily?.precipitation_probability_max)[index],
    snowfallSum: numberSeries(daily?.snowfall_sum)[index],
  }));

  return {
    coordinates,
    timezone: text(payload.timezone),
    current: parsedCurrent,
    hourly: hours,
    daily: days,
  };
}

export function parseForecastGrid(
  payload: unknown,
  bounds: GeoBounds,
  columns: number,
  rows: number,
): ForecastGrid | null {
  const entries = Array.isArray(payload) ? payload : isRecord(payload) ? [payload] : [];
  if (entries.length !== columns * rows) return null;
  const firstHourly = isRecord(entries[0]?.hourly) ? entries[0].hourly : null;
  const times = stringSeries(firstHourly?.time);
  if (!times.length) return null;
  const cloudCover: number[][] = [];
  const precipitation: number[][] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || !isRecord(entry.hourly)) return null;
    const cloud = numberSeries(entry.hourly.cloud_cover).map((value) => value ?? 0);
    const precip = numberSeries(entry.hourly.precipitation).map((value) => value ?? 0);
    if (cloud.length !== times.length || precip.length !== times.length) return null;
    cloudCover.push(cloud);
    precipitation.push(precip);
  }
  return {
    ...bounds,
    columns,
    rows,
    times,
    cloudCover,
    precipitation,
  };
}

export function sampleGridValue(grid: ForecastGrid, variable: WeatherOverlayVariable, timeIndex: number, longitude: number, latitude: number) {
  const { west, south, east, north, columns, rows } = grid;
  const series = variable === 'cloud' ? grid.cloudCover : grid.precipitation;
  if (east === west || north === south || columns < 2 || rows < 2) return 0;
  const x = ((longitude - west) / (east - west)) * (columns - 1);
  const y = ((north - latitude) / (north - south)) * (rows - 1);
  const x0 = Math.max(0, Math.min(columns - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(y)));
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const index = (row: number, column: number) => series[row * columns + column]?.[timeIndex] ?? 0;
  const top = index(y0, x0) * (1 - tx) + index(y0, x0 + 1) * tx;
  const bottom = index(y0 + 1, x0) * (1 - tx) + index(y0 + 1, x0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function cloudOverlayColor(cover: number): [number, number, number, number] {
  const amount = Math.max(0, Math.min(1, cover / 100));
  const alpha = amount < 0.08 ? 0 : Math.round((0.12 + amount * 0.62) * 255);
  const shade = Math.round(210 - amount * 55);
  return [shade, shade + 6, shade + 14, alpha];
}

export function precipOverlayColor(millimetres: number): [number, number, number, number] {
  if (millimetres <= 0.05) return [0, 0, 0, 0];
  const amount = Math.max(0, Math.min(1, Math.log2(1 + millimetres) / 4));
  const alpha = Math.round((0.18 + amount * 0.7) * 255);
  const r = Math.round(70 - amount * 50);
  const g = Math.round(140 - amount * 40);
  const b = Math.round(210 + amount * 30);
  return [r, g, b, alpha];
}

export function renderForecastImage(
  grid: ForecastGrid,
  variable: WeatherOverlayVariable,
  timeIndex: number,
  width = 256,
  height = 256,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas.toDataURL();
  const image = context.createImageData(width, height);
  const colorAt = variable === 'cloud' ? cloudOverlayColor : precipOverlayColor;
  for (let row = 0; row < height; row += 1) {
    const latitude = grid.north - (row / Math.max(1, height - 1)) * (grid.north - grid.south);
    for (let column = 0; column < width; column += 1) {
      const longitude = grid.west + (column / Math.max(1, width - 1)) * (grid.east - grid.west);
      const value = sampleGridValue(grid, variable, timeIndex, longitude, latitude);
      const [r, g, b, a] = colorAt(value);
      const offset = (row * width + column) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = a;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function openMeteoUrl(path: string, params: Record<string, string>) {
  const url = new URL(`${serviceConfig.openMeteoEndpoint}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export async function fetchViewedWeather(longitude: number, latitude: number, signal?: AbortSignal): Promise<ViewedWeather> {
  const coordinates: [number, number] = [roundViewedCoordinate(longitude), roundViewedCoordinate(latitude)];
  const key = viewedWeatherCacheKey(coordinates[0], coordinates[1]);
  if (pointCache && pointCache.key === key && Date.now() - pointCache.fetchedAt < POINT_TTL_MS) {
    return pointCache.weather;
  }
  const url = openMeteoUrl('/v1/forecast', {
    latitude: String(coordinates[1]),
    longitude: String(coordinates[0]),
    current: 'temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m,snowfall,snow_depth',
    hourly: 'temperature_2m,weather_code,cloud_cover,precipitation,precipitation_probability,snowfall,snow_depth,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,snowfall_sum',
    forecast_days: '7',
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  });
  const response = await fetchWithTimeout(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw apiHttpError(response, 'Open-Meteo');
  const weather = parseViewedWeather(await response.json(), coordinates);
  if (!weather) throw new Error('Weather forecast was empty.');
  pointCache = { key, weather, fetchedAt: Date.now() };
  return weather;
}

export function forecastGridPoints(
  bounds: GeoBounds,
  columns: number,
  rows: number,
) {
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  const latStep = rows <= 1 ? 0 : (bounds.north - bounds.south) / (rows - 1);
  const lonStep = columns <= 1 ? 0 : (bounds.east - bounds.west) / (columns - 1);
  for (let row = 0; row < rows; row += 1) {
    const latitude = bounds.north - row * latStep;
    for (let column = 0; column < columns; column += 1) {
      latitudes.push(roundViewedCoordinate(latitude, 2));
      longitudes.push(roundViewedCoordinate(bounds.west + column * lonStep, 2));
    }
  }
  return { latitudes, longitudes };
}

export async function fetchForecastGrid(
  bounds: GeoBounds,
  columns = 5,
  rows = 5,
  signal?: AbortSignal,
): Promise<ForecastGrid> {
  const key = [bounds.west, bounds.south, bounds.east, bounds.north, columns, rows]
    .map((value) => roundViewedCoordinate(value, 2))
    .join(':');
  const cached = gridCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < GRID_TTL_MS) return cached.grid;
  const points = forecastGridPoints(bounds, columns, rows);
  const url = openMeteoUrl('/v1/forecast', {
    latitude: points.latitudes.join(','),
    longitude: points.longitudes.join(','),
    hourly: 'cloud_cover,precipitation',
    forecast_days: '2',
    timezone: 'UTC',
  });
  const response = await fetchWithTimeout(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw apiHttpError(response, 'Open-Meteo');
  const grid = parseForecastGrid(await response.json(), bounds, columns, rows);
  if (!grid) throw new Error('Weather overlay data was empty.');
  gridCache.set(key, { grid, fetchedAt: Date.now() });
  return grid;
}
