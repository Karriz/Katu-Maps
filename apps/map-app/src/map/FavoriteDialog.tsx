import { BriefcaseBusiness, House, Star, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { FavoriteKind } from '../lib/Favorites';
import type { PendingFavorite } from './LocationFeature';

type FavoriteDialogProps = {
  favorite: PendingFavorite | null;
  setFavorite: Dispatch<SetStateAction<PendingFavorite | null>>;
  onKindChange: (kind: FavoriteKind) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function FavoriteDialog({
  favorite,
  setFavorite,
  onKindChange,
  onClose,
  onConfirm,
}: FavoriteDialogProps) {
  if (!favorite) return null;

  const editing = Boolean(favorite.editingFavoriteId);
  return (
    <div className="favorite-menu-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form
        className="favorite-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorite-menu-title"
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <button className="favorite-menu-close" type="button" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
        <span className="favorite-menu-eyebrow">{editing ? 'Edit favourite' : 'Save place'}</span>
        <h2 id="favorite-menu-title">{editing ? 'Edit favourite' : 'Save as favourite'}</h2>
        <p>{editing ? 'Update the name of this saved place.' : 'Give this place a useful name and choose how it should appear on the map.'}</p>
        <label className="favorite-name-field">
          <span>Name</span>
          <input
            autoFocus
            maxLength={120}
            required
            value={favorite.name}
            onChange={(event) => setFavorite((current) => current
              ? { ...current, name: event.target.value, nameWasEdited: true }
              : current)}
          />
          {favorite.addressLoading && <small aria-live="polite">Looking up the street address...</small>}
        </label>
        {!editing && <fieldset className="favorite-kind-group">
          <legend className="favorite-kind-label">Type</legend>
          <div className="favorite-kind-options">
            <button className={favorite.kind === 'home' ? 'selected' : ''} type="button" aria-pressed={favorite.kind === 'home'} onClick={() => onKindChange('home')}>
              <House aria-hidden="true" /><span><strong>Home</strong><small>Save as Home</small></span>
            </button>
            <button className={favorite.kind === 'work' ? 'selected' : ''} type="button" aria-pressed={favorite.kind === 'work'} onClick={() => onKindChange('work')}>
              <BriefcaseBusiness aria-hidden="true" /><span><strong>Work</strong><small>Save as Work</small></span>
            </button>
            <button className={favorite.kind === 'favorite' ? 'selected' : ''} type="button" aria-pressed={favorite.kind === 'favorite'} onClick={() => onKindChange('favorite')}>
              <Star aria-hidden="true" /><span><strong>Favourite</strong><small>Standard saved place</small></span>
            </button>
          </div>
        </fieldset>}
        <div className="favorite-menu-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!favorite.name.trim() || favorite.addressLoading}>
            {favorite.addressLoading ? 'Finding address...' : editing ? 'Save changes' : 'Save favourite'}
          </button>
        </div>
      </form>
    </div>
  );
}
