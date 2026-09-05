import { Navigation, Share2, Thermometer, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MAP_COLORS } from './MapPalette';
import { formatMeasuredTime } from './Digitraffic';
import {
  compassFromDegrees,
  formatTemperature,
  formatWeatherValue,
  type RoadConditionKind,
  type RoadWeatherStation,
} from './RoadWeather';
import type { LocationSelection } from './useRoutePlanning';

function conditionClass(kind: RoadConditionKind | undefined) {
  if (kind === 'ice' || kind === 'frost' || kind === 'snow') return 'is-closed';
  if (kind === 'wet' || kind === 'damp') return 'is-limited';
  if (kind === 'dry') return 'is-open';
  return 'is-unknown';
}

export function RoadWeatherPanel({
  station,
  sheet,
  onClose,
  onShare,
  onDirections,
}: {
  station: RoadWeatherStation;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  onClose: () => void;
  onShare: () => void;
  onDirections: (destination: LocationSelection) => void;
}) {
  const place = [station.municipality, station.province].filter(Boolean).join(', ');
  const road = station.roadNumber ? `Road ${station.roadNumber}` : undefined;
  const measured = formatMeasuredTime(station.measuredTime ?? (typeof station.dataUpdatedTime === 'string' ? station.dataUpdatedTime : undefined));
  const wind = station.windSpeed !== undefined
    ? [formatWeatherValue(station.windSpeed, 'm/s'), compassFromDegrees(station.windDirection)].filter(Boolean).join(' ')
    : undefined;
  const destination: LocationSelection = {
    name: station.name,
    category: 'Road weather station',
    coordinates: station.coordinates,
    source: 'map',
    address: place || undefined,
  };

  return (
    <aside
      className={`location-info-panel road-weather-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`}
      style={sheet.style}
      data-snap={sheet.snap}
      aria-label="Road weather station"
    >
      <MobileSheetHandle {...sheet} closeLabel="Close road weather station" onClose={onClose} />
      <div className="location-info-header">
        <div className="location-info-icon" aria-hidden="true" style={{ backgroundColor: station.icy ? MAP_COLORS.roadWeatherIce : MAP_COLORS.roadWeather }}>
          <Thermometer size={20} strokeWidth={2.4} />
        </div>
        <div>
          <span className="location-info-category">Road weather</span>
          <h2>{station.name}</h2>
          {(place || road) && <p>{[road, place].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div className="location-info-content" tabIndex={0}>
        <div className="location-info-details">
          {station.airTemperature !== undefined && <div>
            <strong>Air temperature</strong>
            <span>{formatTemperature(station.airTemperature)}</span>
          </div>}
          {station.roadTemperature !== undefined && <div>
            <strong>Road temperature</strong>
            <span>{formatTemperature(station.roadTemperature)}</span>
          </div>}
          {station.roadConditionLabel && <div>
            <strong>Road surface</strong>
            <span className="location-hours-value">
              <span className={`location-open-state ${conditionClass(station.roadCondition)}`}>
                {station.roadConditionLabel}
              </span>
            </span>
          </div>}
          {station.iceMm !== undefined && <div>
            <strong>Ice</strong>
            <span>{formatWeatherValue(station.iceMm, 'mm')}</span>
          </div>}
          {station.waterMm !== undefined && <div>
            <strong>Water</strong>
            <span>{formatWeatherValue(station.waterMm, 'mm')}</span>
          </div>}
          {station.snowMm !== undefined && <div>
            <strong>Snow</strong>
            <span>{formatWeatherValue(station.snowMm, 'mm')}</span>
          </div>}
          {station.friction !== undefined && <div>
            <strong>Friction</strong>
            <span>{station.friction.toFixed(2)}</span>
          </div>}
          {wind && <div>
            <strong>Wind</strong>
            <span>{wind}</span>
          </div>}
          {station.humidity !== undefined && <div>
            <strong>Humidity</strong>
            <span>{formatWeatherValue(station.humidity, '%', 0)}</span>
          </div>}
          {station.precipitationMmH !== undefined && <div>
            <strong>Precipitation</strong>
            <span>{formatWeatherValue(station.precipitationMmH, 'mm/h')}</span>
          </div>}
          {station.visibilityKm !== undefined && <div>
            <strong>Visibility</strong>
            <span>{formatWeatherValue(station.visibilityKm, 'km', 0)}</span>
          </div>}
          {measured && <div>
            <strong>Updated</strong>
            <span>{measured}</span>
          </div>}
        </div>
        <span className="location-info-source">Finnish road weather stations from Fintraffic Digitraffic</span>
        <a
          className="location-info-attribution"
          href="https://www.digitraffic.fi/en/road-traffic/"
          target="_blank"
          rel="noreferrer"
        >
          Source: Fintraffic / digitraffic.fi · CC BY 4.0
        </a>
      </div>
      <div className="location-info-sticky-actions">
        <InfoActionRow actions={[
          { label: 'Share', icon: Share2, onClick: onShare },
          { label: 'Directions', icon: Navigation, tone: 'primary', onClick: () => onDirections(destination) },
        ]} />
      </div>
      <button className="location-info-close" type="button" aria-label="Close road weather station" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
