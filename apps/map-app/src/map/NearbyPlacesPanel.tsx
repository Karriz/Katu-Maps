import { X } from 'lucide-react';
import { formatNearbyDistance, type NearbyPlace } from './NearbyPlaces';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';

export function NearbyPlacesPanel({ places, onClose, onSelect }: {
  places: NearbyPlace[];
  onClose: () => void;
  onSelect: (place: NearbyPlace) => void;
}) {
  const sheet = useMobileBottomSheet('half');
  return (
    <aside
      className={`nearby-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`}
      style={sheet.style}
      data-snap={sheet.snap}
      aria-labelledby="nearby-heading"
    >
      <MobileSheetHandle {...sheet} closeLabel="Close nearby places" onClose={onClose} />
      <header>
        <div>
          <strong id="nearby-heading">Nearby</strong>
          <span>{places.length ? `${places.length} notable places` : 'No notable places found nearby'}</span>
        </div>
        <button className="nearby-panel-close" type="button" onClick={onClose} aria-label="Close nearby places">
          <X aria-hidden="true" />
        </button>
      </header>
      {places.length > 0 && (
        <ol>
          {places.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => onSelect(place)}
                aria-label={`${place.name || place.type}, ${formatNearbyDistance(place.distance)} away`}
              >
                <strong>{place.name || place.type.replaceAll('_', ' ')}</strong>
                <span>{place.type.replaceAll('_', ' ')} · {formatNearbyDistance(place.distance)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
