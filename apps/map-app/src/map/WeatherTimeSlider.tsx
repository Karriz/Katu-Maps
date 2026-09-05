import { Cloud, CloudRain, X } from 'lucide-react';
import { closestHourIndex, type ForecastGrid, type WeatherOverlayVariable } from './Weather';

function formatSliderTime(time: string) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return time;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function WeatherTimeSlider({
  variable,
  times,
  selectedTime,
  loading,
  unavailable,
  onVariableChange,
  onTimeChange,
  onClose,
}: {
  variable: WeatherOverlayVariable;
  times: string[];
  selectedTime: string | undefined;
  loading: boolean;
  unavailable: boolean;
  onVariableChange: (variable: WeatherOverlayVariable) => void;
  onTimeChange: (time: string) => void;
  onClose: () => void;
}) {
  const index = selectedTime ? Math.max(0, times.indexOf(selectedTime)) : closestHourIndex(times);
  const label = times[index] ? formatSliderTime(times[index]) : 'Forecast';
  return (
    <div className="weather-time-slider" role="region" aria-label="Weather forecast overlay">
      <div className="weather-time-slider-header">
        <div className="weather-time-slider-modes" role="group" aria-label="Forecast overlay">
          <button type="button" aria-pressed={variable === 'cloud'} onClick={() => onVariableChange('cloud')}>
            <Cloud aria-hidden="true" /> Cloud cover
          </button>
          <button type="button" aria-pressed={variable === 'precip'} onClick={() => onVariableChange('precip')}>
            <CloudRain aria-hidden="true" /> Rain forecast
          </button>
        </div>
        <button className="weather-time-slider-close" type="button" aria-label="Close forecast overlay" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="weather-time-slider-body">
        <strong>{label}</strong>
        {loading && <span>Updating overlay…</span>}
        {unavailable && !loading && <span>Zoom in to a region to show this overlay</span>}
        {!loading && !unavailable && (
          <span>{variable === 'cloud' ? 'Model cloud cover' : 'Model precipitation, not radar'}</span>
        )}
      </div>
      <input
        aria-label="Forecast time"
        disabled={times.length < 2}
        max={Math.max(0, times.length - 1)}
        min={0}
        step={1}
        type="range"
        value={index}
        onChange={(event) => {
          const next = times[Number(event.currentTarget.value)];
          if (next) onTimeChange(next);
        }}
      />
      <a className="weather-time-slider-attribution" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        Weather data by Open-Meteo.com
      </a>
    </div>
  );
}

export function weatherSliderTimes(grid: ForecastGrid | null, fallback: string[]) {
  return grid?.times.length ? grid.times : fallback;
}
