import { Mountain, Navigation, Pencil, Share2, Star, Trash2, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import type { Favorite } from '../lib/Favorites';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { defaultPositionName, formatCoordinates, formatElevation, hasDisplayableElevation } from './PositionInformation';
import type { PositionInformationState } from './useInfoPanelState';
import type { LocationSelection } from './useRoutePlanning';

export function PositionInformationPanel({
  information,
  sheet,
  favorite,
  is3dMode,
  onClose,
  onEditFavorite,
  onSaveFavorite,
  onRemoveFavorite,
  onShare,
  onDirections,
}: {
  information: PositionInformationState;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  favorite?: Favorite | null;
  is3dMode: boolean;
  onClose: () => void;
  onEditFavorite: () => void;
  onSaveFavorite: () => void;
  onRemoveFavorite: () => void;
  onShare: () => void;
  onDirections: (selection: LocationSelection) => void;
}) {
  const selection: LocationSelection = {
    name: defaultPositionName(
      information.coordinates,
      information.address.status === 'available' ? information.address.address : undefined,
    ),
    category: 'Pinned location',
    coordinates: information.coordinates,
    source: 'map',
    address: information.address.status === 'available' ? information.address.address : undefined,
  };
  return (
    <aside className={`position-information mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`} style={sheet.style} data-snap={sheet.snap} role="dialog" aria-modal="true" aria-labelledby="position-information-title">
      <MobileSheetHandle {...sheet} closeLabel="Close position information" onClose={onClose} />
      <button className="location-info-close" type="button" aria-label="Close position information" onClick={onClose}><X aria-hidden="true" /></button>
      <div className="position-information-heading">
        <span className="location-info-icon" aria-hidden="true"><Mountain size={20} /></span>
        <div><span className="location-info-category">Map point</span><h2 id="position-information-title">Position information</h2></div>
      </div>
      <InfoActionRow actions={[
        favorite
          ? { label: 'Edit favourite', icon: Pencil, iconOnly: true, onClick: onEditFavorite }
          : { label: 'Save', icon: Star, disabled: information.address.status === 'loading', onClick: onSaveFavorite },
        ...(favorite ? [{ label: 'Remove favourite', icon: Trash2, iconOnly: true, onClick: onRemoveFavorite }] : []),
        { label: 'Share', icon: Share2, onClick: onShare },
        { label: 'Directions', icon: Navigation, tone: 'primary' as const, onClick: () => onDirections(selection) },
      ]} />
      <div className="position-information-content">
        <div className="position-information-field">
          <strong>Address</strong>
          {information.address.status === 'loading' && <span className="position-information-muted" aria-live="polite">Finding street address...</span>}
          {information.address.status === 'available' && <span>{information.address.address}</span>}
          {information.address.status === 'unavailable' && <span className="position-information-muted">No street address found</span>}
        </div>
        <div className="position-information-field">
          <strong>Latitude, longitude</strong>
          <span>{formatCoordinates(information.coordinates)}</span>
        </div>
        {hasDisplayableElevation(information.elevation, is3dMode) && <>
          <div className="position-information-field">
            <strong>Approximate terrain elevation</strong>
            <span>{formatElevation(information.elevation.metres)}</span>
          </div>
          <small>Ground surface from the configured terrain DEM.</small>
        </>}
      </div>
    </aside>
  );
}
