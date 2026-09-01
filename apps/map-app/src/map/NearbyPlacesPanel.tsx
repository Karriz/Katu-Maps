import { X } from 'lucide-react';
import { formatNearbyDistance, type NearbyPlace } from './NearbyPlaces';

export function NearbyPlacesPanel({ places, onClose, onSelect }: {
  places: NearbyPlace[];
  onClose: () => void;
  onSelect: (place: NearbyPlace) => void;
}) {
  return <aside className="nearby-panel" aria-labelledby="nearby-heading">
    <header><div><strong id="nearby-heading">Nearby</strong><span>{places.length ? `${places.length} notable places` : 'No notable places found nearby'}</span></div>
      <button type="button" onClick={onClose} aria-label="Close nearby places"><X aria-hidden="true" /></button></header>
    {places.length > 0 && <ol>{places.map((place) => <li key={place.id}>
      <button type="button" onClick={() => onSelect(place)} aria-label={`${place.name || place.type}, ${formatNearbyDistance(place.distance)} away`}>
        <strong>{place.name || place.type.replaceAll('_', ' ')}</strong>
        <span>{place.type.replaceAll('_', ' ')} · {formatNearbyDistance(place.distance)}</span>
      </button>
    </li>)}</ol>}
  </aside>;
}
