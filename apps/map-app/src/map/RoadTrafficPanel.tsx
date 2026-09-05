import { CarFront, Navigation, Share2, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MAP_COLORS } from './MapPalette';
import { formatMeasuredTime } from './Digitraffic';
import {
  TRAFFIC_CONGESTION_COLORS,
  TRAFFIC_CONGESTION_LABELS,
  type RoadTrafficDirection,
  type RoadTrafficStation,
  type TrafficCongestion,
} from './RoadTraffic';
import type { LocationSelection } from './useRoutePlanning';

function congestionClass(kind: TrafficCongestion) {
  if (kind === 'severe' || kind === 'heavy') return 'is-closed';
  if (kind === 'slow') return 'is-limited';
  if (kind === 'free') return 'is-open';
  return 'is-unknown';
}

function formatSpeed(value: number | undefined) {
  return value === undefined ? undefined : `${Math.round(value)} km/h`;
}

function formatVolume(value: number | undefined) {
  return value === undefined ? undefined : `${Math.round(value)} veh/h`;
}

function DirectionDetails({
  label,
  direction,
}: {
  label: string;
  direction: RoadTrafficDirection;
}) {
  const speed = formatSpeed(direction.speedKmh);
  const volume = formatVolume(direction.volumePerHour);
  if (!speed && !volume && direction.congestion === 'unknown') return null;
  return (
    <div>
      <strong>{label}{direction.municipality ? ` · ${direction.municipality}` : ''}</strong>
      <span className="location-hours-value">
        <span className={`location-open-state ${congestionClass(direction.congestion)}`}>
          {TRAFFIC_CONGESTION_LABELS[direction.congestion]}
        </span>
        {[speed, volume].filter(Boolean).join(' · ')}
      </span>
    </div>
  );
}

export function RoadTrafficPanel({
  station,
  sheet,
  onClose,
  onShare,
  onDirections,
}: {
  station: RoadTrafficStation;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  onClose: () => void;
  onShare: () => void;
  onDirections: (destination: LocationSelection) => void;
}) {
  const place = [station.municipality, station.province].filter(Boolean).join(', ');
  const road = station.roadNumber ? `Road ${station.roadNumber}` : undefined;
  const measured = formatMeasuredTime(station.measuredTime ?? (typeof station.dataUpdatedTime === 'string' ? station.dataUpdatedTime : undefined));
  const destination: LocationSelection = {
    name: station.name,
    category: 'Traffic station',
    coordinates: station.coordinates,
    source: 'map',
    address: place || undefined,
  };

  return (
    <aside
      className={`location-info-panel road-traffic-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`}
      style={sheet.style}
      data-snap={sheet.snap}
      aria-label="Road traffic"
    >
      <MobileSheetHandle {...sheet} closeLabel="Close road traffic" onClose={onClose} />
      <div className="location-info-header">
        <div className="location-info-icon" aria-hidden="true" style={{ backgroundColor: MAP_COLORS.roadTraffic }}>
          <CarFront size={20} strokeWidth={2.4} />
        </div>
        <div>
          <span className="location-info-category">Traffic</span>
          <h2>{station.name}</h2>
          {(place || road) && <p>{[road, place].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div className="location-info-content" tabIndex={0}>
        <ul className="road-traffic-legend" aria-label="Traffic colours">
          {(['free', 'slow', 'heavy', 'severe'] as const).map((kind) => (
            <li key={kind}>
              <span style={{ background: TRAFFIC_CONGESTION_COLORS[kind] }} aria-hidden="true" />
              {TRAFFIC_CONGESTION_LABELS[kind]}
            </li>
          ))}
        </ul>
        <div className="location-info-details">
          <DirectionDetails label="Direction 1" direction={station.direction1} />
          <DirectionDetails label="Direction 2" direction={station.direction2} />
          {measured && <div>
            <strong>Updated</strong>
            <span>{measured}</span>
          </div>}
        </div>
        <span className="location-info-source">Finnish traffic measurement stations from Fintraffic Digitraffic</span>
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
      <button className="location-info-close" type="button" aria-label="Close road traffic" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
