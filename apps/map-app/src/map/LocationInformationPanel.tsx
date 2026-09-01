import type { LucideIcon } from 'lucide-react';
import { Navigation, Pencil, Share2, Star, Trash2, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import type { Favorite } from '../lib/Favorites';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import type { LocationSelection } from './useRoutePlanning';
import { wikipediaUrl } from './LocationMedia';
import { LocationImageCarousel } from './LocationImageCarousel';
import { useLocationMedia } from './useLocationMedia';
import { useLocationDescription } from './useLocationDescription';

export function LocationInformationPanel({
  selection,
  sheet,
  detailsLoading,
  icon: SelectedLocationIcon,
  iconColor,
  favorite,
  onClose,
  onSaveFavorite,
  onEditFavorite,
  onRemoveFavorite,
  onShare,
  onDirections,
}: {
  selection: LocationSelection;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  detailsLoading: boolean;
  icon: LucideIcon;
  iconColor: string;
  favorite?: Favorite;
  onClose: () => void;
  onSaveFavorite: () => void;
  onEditFavorite: () => void;
  onRemoveFavorite: () => void;
  onShare: () => void;
  onDirections: () => void;
}) {
  const identity = selection.wikidata ?? `${selection.osmType ?? ''}${selection.osmId ?? selection.coordinates.join(',')}`;
  const images = useLocationMedia(selection, identity);
  const description = useLocationDescription(selection, identity);
  const wikipedia = wikipediaUrl(selection.wikipedia);
  const links = [
    ...(wikipedia ? [{ label: 'Wikipedia', url: wikipedia }] : []),
    ...(selection.website ? [{ label: 'Official website', url: selection.website }] : []),
    ...(selection.socialLinks ?? []),
  ];
  return (
    <aside className={`location-info-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`} style={sheet.style} data-snap={sheet.snap} aria-label="Location information">
      <MobileSheetHandle {...sheet} closeLabel="Close location information" onClose={onClose} />
      <div className="location-info-header">
        <div className="location-info-icon" aria-hidden="true" style={{ backgroundColor: iconColor }}>
          <SelectedLocationIcon size={20} strokeWidth={2.4} />
        </div>
        <div>
          <span className="location-info-category">{selection.category}</span>
          <h2>{selection.name}</h2>
          {selection.address && <p>{selection.address}</p>}
        </div>
      </div>
      <div className="location-info-content" tabIndex={0}>
        <LocationImageCarousel images={images} />
        {description && <section className="location-description" aria-label="About this location">
          <p>{description.text}</p>
          <small>
            {description.source === 'wikipedia' && description.articleUrl
              ? <><a href={description.articleUrl} target="_blank" rel="noopener noreferrer">Read on Wikipedia</a> · Wikipedia, CC BY-SA</>
              : 'Description from OpenStreetMap'}
          </small>
        </section>}
        {detailsLoading && <p className="location-info-loading">Loading OpenStreetMap details…</p>}
        {(selection.openingHours || selection.phone || selection.email) && (
          <div className="location-info-details">
            {selection.openingHours && <div><strong>Hours</strong><span>{selection.openingHours}</span></div>}
            {selection.phone && <div><strong>Phone</strong><a href={`tel:${selection.phone}`}>{selection.phone}</a></div>}
            {selection.email && <div><strong>Email</strong><a href={`mailto:${selection.email}`}>{selection.email}</a></div>}
          </div>
        )}
        {links.length > 0 && <nav className="location-external-links" aria-label="External links">
          {links.map((link) => <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>)}
        </nav>}
        {!detailsLoading && !selection.openingHours && !selection.phone && !selection.email && links.length === 0 && (
          <p className="location-info-empty">No opening hours or contact details are available in the current map data.</p>
        )}
        <span className="location-info-source">
          {selection.source === 'search' ? 'Found with Photon · details from OpenStreetMap' : 'OpenStreetMap place'}
        </span>
        <InfoActionRow actions={[
          ...(favorite
            ? [{ label: 'Edit favourite', icon: Pencil, onClick: onEditFavorite, iconOnly: true }, { label: 'Remove favourite', icon: Trash2, onClick: onRemoveFavorite, iconOnly: true }]
            : [{ label: 'Save', icon: Star, onClick: onSaveFavorite }]),
          { label: 'Share', icon: Share2, onClick: onShare },
          { label: 'Directions', icon: Navigation, tone: 'primary' as const, onClick: onDirections },
        ]} />
        <a className="location-info-attribution" href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors · Nominatim
        </a>
      </div>
      <button className="location-info-close" type="button" aria-label="Close location information" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
