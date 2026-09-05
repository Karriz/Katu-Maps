import { Construction, Navigation, Share2, TriangleAlert, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MAP_COLORS } from './MapPalette';
import {
  formatTrafficMessageFeature,
  formatTrafficMessageWhen,
  type RoadTrafficMessage,
} from './RoadTrafficMessages';
import type { LocationSelection } from './useRoutePlanning';

export function RoadTrafficMessagePanel({
  message,
  sheet,
  onClose,
  onShare,
  onDirections,
}: {
  message: RoadTrafficMessage;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  onClose: () => void;
  onShare: () => void;
  onDirections: (destination: LocationSelection) => void;
}) {
  const place = [message.municipality, message.province].filter(Boolean).join(', ');
  const road = message.roadNumber ? `Road ${message.roadNumber}` : message.roadName;
  const when = formatTrafficMessageWhen(message.startTime, message.endTime);
  const Icon = message.kind === 'roadwork' ? Construction : TriangleAlert;
  const category = message.kind === 'roadwork' ? 'Roadworks' : 'Incident';
  const color = message.kind === 'roadwork' ? MAP_COLORS.roadWork : MAP_COLORS.roadIncident;
  const destination: LocationSelection = {
    name: message.name,
    category,
    coordinates: message.coordinates,
    source: 'map',
    address: place || undefined,
  };

  return (
    <aside
      className={`location-info-panel road-traffic-message-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`}
      style={sheet.style}
      data-snap={sheet.snap}
      aria-label={category}
    >
      <MobileSheetHandle {...sheet} closeLabel={`Close ${category.toLowerCase()}`} onClose={onClose} />
      <div className="location-info-header">
        <div className="location-info-icon" aria-hidden="true" style={{ backgroundColor: color }}>
          <Icon size={20} strokeWidth={2.4} />
        </div>
        <div>
          <span className="location-info-category">{category}</span>
          <h2>{message.name}</h2>
          {(place || road) && <p>{[road, place].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div className="location-info-content" tabIndex={0}>
        <div className="location-info-details">
          <div>
            <strong>Status</strong>
            <span className="location-hours-value">
              <span className={`location-open-state ${message.scheduled ? 'is-limited' : 'is-closed'}`}>
                {message.scheduled ? 'Scheduled' : 'Active'}
              </span>
            </span>
          </div>
          {message.direction && <div>
            <strong>Direction</strong>
            <span>{message.direction}</span>
          </div>}
          {when && <div>
            <strong>{message.kind === 'roadwork' ? 'Works' : 'When'}</strong>
            <span>{when}</span>
          </div>}
          {message.features.map((feature) => (
            <div key={formatTrafficMessageFeature(feature)}>
              <strong>Restriction</strong>
              <span>{formatTrafficMessageFeature(feature)}</span>
            </div>
          ))}
          {message.workTypes.length > 0 && <div>
            <strong>Work type</strong>
            <span>{message.workTypes.join(', ')}</span>
          </div>}
          {message.workingHours.length > 0 && <div>
            <strong>Working hours</strong>
            <span>{message.workingHours.join(' · ')}</span>
          </div>}
        </div>
        {message.location && <p className="traffic-message-comment">{message.location}</p>}
        {message.comment && <p className="traffic-message-comment">{message.comment}</p>}
        {(message.sender || message.contactPhone || message.contactEmail) && (
          <div className="location-info-details">
            {message.sender && <div>
              <strong>Reported by</strong>
              <span>{message.sender}</span>
            </div>}
            {message.contactPhone && <div>
              <strong>Phone</strong>
              <span>{message.contactPhone}</span>
            </div>}
            {message.contactEmail && <div>
              <strong>Email</strong>
              <span>{message.contactEmail}</span>
            </div>}
          </div>
        )}
        <span className="location-info-source">
          {message.kind === 'roadwork'
            ? 'Finnish roadworks from Fintraffic Digitraffic'
            : 'Finnish traffic incidents from Fintraffic Digitraffic'}
        </span>
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
      <button className="location-info-close" type="button" aria-label={`Close ${category.toLowerCase()}`} onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
