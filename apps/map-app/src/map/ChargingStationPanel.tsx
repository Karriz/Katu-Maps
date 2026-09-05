import { ExternalLink, Navigation, PlugZap, Share2, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MAP_COLORS } from './MapPalette';
import { safeHttpUrl } from './LocationMedia';
import {
  chargingStationAddress,
  chargingStationDetailsUrl,
  formatChargingPower,
  formatChargingUpdatedTime,
  groupChargingConnectors,
  type ChargingStation,
  type ChargingStatusKind,
} from './ChargingStations';
import type { LocationSelection } from './useRoutePlanning';

const STATUS_LABELS: Record<ChargingStatusKind, string> = {
  operational: 'Operational',
  limited: 'Partly operational',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

function statusClass(kind: ChargingStatusKind) {
  if (kind === 'operational') return 'is-open';
  if (kind === 'limited') return 'is-limited';
  if (kind === 'unavailable') return 'is-closed';
  return 'is-unknown';
}

export function ChargingStationPanel({
  station,
  sheet,
  onClose,
  onShare,
  onDirections,
}: {
  station: ChargingStation;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  onClose: () => void;
  onShare: () => void;
  onDirections: (destination: LocationSelection) => void;
}) {
  const address = chargingStationAddress(station);
  const updated = formatChargingUpdatedTime(station.statusUpdated);
  const connectors = groupChargingConnectors(station.connectors);
  const destination: LocationSelection = {
    name: station.name,
    category: 'Charging station',
    coordinates: station.coordinates,
    source: 'map',
    address: address || undefined,
  };
  const detailsUrl = chargingStationDetailsUrl(station.id);
  const website = safeHttpUrl(station.relatedUrl);
  const operatorUrl = safeHttpUrl(station.operatorUrl);

  return (
    <aside
      className={`location-info-panel charging-station-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`}
      style={sheet.style}
      data-snap={sheet.snap}
      aria-label="Charging station"
    >
      <MobileSheetHandle {...sheet} closeLabel="Close charging station" onClose={onClose} />
      <div className="location-info-header">
        <div className="location-info-icon" aria-hidden="true" style={{ backgroundColor: MAP_COLORS.chargingStation }}>
          <PlugZap size={20} strokeWidth={2.4} />
        </div>
        <div>
          <span className="location-info-category">Charging station</span>
          <h2>{station.name}</h2>
          {address && <p>{address}</p>}
        </div>
      </div>
      <div className="location-info-content" tabIndex={0}>
        {(station.operator || station.usage || station.usageCost || station.numberOfPoints || station.phone || station.accessComments || station.comments) && (
          <section className="location-info-details" aria-label="General information">
          {station.operator && <div>
            <strong>Operator</strong>
            {operatorUrl
              ? <a href={operatorUrl} target="_blank" rel="noopener noreferrer">{station.operator}</a>
              : <span>{station.operator}</span>}
          </div>}
          {station.usage && <div>
            <strong>Access</strong>
            <span>{station.usage}</span>
          </div>}
          {station.usageCost && <div>
            <strong>Cost</strong>
            <span>{station.usageCost}</span>
          </div>}
          {station.numberOfPoints ? <div>
            <strong>Charge points</strong>
            <span>{station.numberOfPoints}</span>
          </div> : null}
          {station.phone && <div>
            <strong>Phone</strong>
            <a href={`tel:${station.phone}`}>{station.phone}</a>
          </div>}
          {station.accessComments && <div>
            <strong>Access notes</strong>
            <span>{station.accessComments}</span>
          </div>}
            {station.comments && <div>
              <strong>Notes</strong>
              <span>{station.comments}</span>
            </div>}
          </section>
        )}
        <section className="location-info-details" aria-label="Status">
          <div>
            <strong>Status</strong>
            <span className="location-hours-value">
              <span className={`location-open-state ${statusClass(station.statusKind)}`}>
                {station.status || STATUS_LABELS[station.statusKind]}
              </span>
              {updated ? <span>{updated}</span> : null}
            </span>
          </div>
        </section>
        <section className="location-info-details charging-connector-section" aria-label="Charger types">
          <div>
            <strong>Chargers</strong>
            {connectors.length ? (
              <ul className="charging-connector-list">
                {connectors.map((connector) => {
                  const power = formatChargingPower(connector.powerKw);
                  const quantity = connector.quantity > 1 ? `${connector.quantity}× ` : '';
                  return (
                    <li key={`${connector.type}:${connector.powerKw ?? 'na'}:${connector.statusKind}`}>
                      <span className="charging-connector-type">{quantity}{connector.type}</span>
                      <span className="charging-connector-meta">
                        {[power, connector.current].filter(Boolean).join(' · ')}
                        {connector.statusKind !== 'unknown' && (
                          <span className={`location-open-state ${statusClass(connector.statusKind)}`}>
                            {connector.status}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <span>Charger types were not listed for this station.</span>}
          </div>
        </section>
        <nav className="location-external-links" aria-label="External links">
          <a href={detailsUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" /> Open Charge Map
          </a>
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden="true" /> Website
            </a>
          )}
        </nav>
        <span className="location-info-source">Charging locations from Open Charge Map</span>
        <a
          className="location-info-attribution"
          href="https://openchargemap.org/"
          target="_blank"
          rel="noreferrer"
        >
          Source: Open Charge Map{station.dataProvider ? ` · ${station.dataProvider}` : ''}
        </a>
      </div>
      <div className="location-info-sticky-actions">
        <InfoActionRow actions={[
          { label: 'Share', icon: Share2, onClick: onShare },
          { label: 'Directions', icon: Navigation, tone: 'primary', onClick: () => onDirections(destination) },
        ]} />
      </div>
      <button className="location-info-close" type="button" aria-label="Close charging station" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
