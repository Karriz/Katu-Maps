import { WeatherGlyph } from './WeatherIcons';
import { formatWeatherTemperature, type ViewedWeather } from './Weather';

export function WeatherChip({
  weather,
  loading,
  unavailable,
  expanded,
  onOpen,
}: {
  weather: ViewedWeather | null;
  loading: boolean;
  unavailable: boolean;
  expanded: boolean;
  onOpen: () => void;
}) {
  const temperature = formatWeatherTemperature(weather?.current.temperature);
  const label = weather
    ? `Weather at the map centre, ${weather.current.summary}, ${temperature}`
    : loading
      ? 'Loading weather for the map centre'
      : unavailable
        ? 'Weather for the map centre is unavailable'
        : 'Weather for the map centre';
  return (
    <button
      className={`weather-chip${expanded ? ' is-open' : ''}${unavailable ? ' is-unavailable' : ''}`}
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      {weather ? <WeatherGlyph icon={weather.current.icon} size={22} /> : <span className="weather-chip-placeholder" aria-hidden="true" />}
      <span className="weather-chip-copy">
        <strong>{temperature ?? (loading ? '…' : '—')}</strong>
        <small>{weather?.current.summary ?? (unavailable ? 'Unavailable' : 'Weather')}</small>
      </span>
    </button>
  );
}
