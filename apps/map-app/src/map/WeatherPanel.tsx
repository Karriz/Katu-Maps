import { Cloud, CloudRain, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MAP_COLORS } from './MapPalette';
import {
  formatMillimetres,
  formatPercent,
  formatWeatherTemperature,
  formatWind,
  upcomingHourlyForecast,
  type ViewedWeather,
  type WeatherOverlayVariable,
} from './Weather';
import { WeatherGlyph } from './WeatherIcons';

function formatHourLabel(time: string) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return time;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(date);
}

function formatDayLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(parsed);
}

export function WeatherPanel({
  weather,
  loading,
  unavailable,
  sheet,
  onClose,
  onOpenOverlay,
}: {
  weather: ViewedWeather | null;
  loading: boolean;
  unavailable: boolean;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  onClose: () => void;
  onOpenOverlay: (variable: WeatherOverlayVariable) => void;
}) {
  const current = weather?.current;
  return (
    <aside
      className={`location-info-panel weather-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`}
      style={sheet.style}
      data-snap={sheet.snap}
      role="dialog"
      aria-modal="true"
      aria-label="Weather forecast"
    >
      <MobileSheetHandle {...sheet} closeLabel="Close weather" onClose={onClose} />
      <div className="location-info-header">
        <div className="location-info-icon" aria-hidden="true" style={{ backgroundColor: MAP_COLORS.weather }}>
          {current ? <WeatherGlyph icon={current.icon} /> : <Cloud size={20} />}
        </div>
        <div>
          <span className="location-info-category">Weather</span>
          <h2>{current ? `${formatWeatherTemperature(current.temperature)} ${current.summary}` : 'Map centre'}</h2>
          <p>Forecast for the place currently in view.</p>
        </div>
      </div>
      <div className="location-info-content" tabIndex={0}>
        {loading && !weather && <p className="location-info-loading">Loading forecast…</p>}
        {unavailable && !weather && <p className="location-info-empty">Weather could not be loaded for this view.</p>}
        {current && (
          <div className="location-info-details">
            {current.cloudCover !== undefined && <div><strong>Cloud cover</strong><span>{formatPercent(current.cloudCover)}</span></div>}
            {current.precipitationProbability !== undefined && <div><strong>Rain chance</strong><span>{formatPercent(current.precipitationProbability)}</span></div>}
            {current.precipitation !== undefined && <div><strong>Precipitation</strong><span>{formatMillimetres(current.precipitation)}</span></div>}
            {formatWind(current.windSpeed, current.windDirection) && <div><strong>Wind</strong><span>{formatWind(current.windSpeed, current.windDirection)}</span></div>}
            {current.humidity !== undefined && <div><strong>Humidity</strong><span>{formatPercent(current.humidity)}</span></div>}
            {current.snowDepth !== undefined && current.snowDepth > 0 && <div><strong>Snow depth</strong><span>{formatMillimetres(current.snowDepth * 100, 'cm')}</span></div>}
          </div>
        )}
        {weather && weather.hourly.length > 0 && (
          <section className="weather-forecast-strip" aria-label="Hourly forecast">
            <h3>Coming hours</h3>
            <ol>
              {upcomingHourlyForecast(weather.hourly).map((hour) => (
                <li key={hour.time}>
                  <span>{formatHourLabel(hour.time)}</span>
                  <WeatherGlyph icon={hour.icon} size={18} />
                  <strong>{formatWeatherTemperature(hour.temperature) ?? '—'}</strong>
                  <small>{formatPercent(hour.precipitationProbability) ?? formatMillimetres(hour.precipitation) ?? hour.summary}</small>
                </li>
              ))}
            </ol>
          </section>
        )}
        {weather && weather.daily.length > 0 && (
          <section className="weather-daily-list" aria-label="Daily forecast">
            <h3>Coming days</h3>
            <ol>
              {weather.daily.slice(0, 7).map((day) => (
                <li key={day.date}>
                  <span>{formatDayLabel(day.date)}</span>
                  <WeatherGlyph icon={day.icon} size={18} />
                  <strong>{formatWeatherTemperature(day.temperatureMax)} / {formatWeatherTemperature(day.temperatureMin)}</strong>
                  <small>{formatPercent(day.precipitationProbabilityMax) ?? day.summary}</small>
                </li>
              ))}
            </ol>
          </section>
        )}
        <span className="location-info-source">Model forecast from Open-Meteo. Rain chance is for this point, not a radar nowcast.</span>
        <a className="location-info-attribution" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather data by Open-Meteo.com · CC BY 4.0
        </a>
      </div>
      <div className="location-info-sticky-actions">
        <InfoActionRow actions={[
          { label: 'Cloud cover', icon: Cloud, onClick: () => onOpenOverlay('cloud') },
          { label: 'Rain forecast', icon: CloudRain, tone: 'primary', onClick: () => onOpenOverlay('precip') },
        ]} />
      </div>
      <button className="location-info-close" type="button" aria-label="Close weather" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
