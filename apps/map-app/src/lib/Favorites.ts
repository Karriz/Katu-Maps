export type FavoriteKind = 'home' | 'work' | 'favorite';

export type Favorite = {
  id: string;
  name: string;
  coordinates: [number, number];
  category: string;
  address?: string;
  providerId?: string;
  provider?: string;
  iconId?: string;
  kind: FavoriteKind;
  createdAt: number;
};

export const FAVORITES_STORAGE_KEY = 'maps-favorites-v1';

export function favoriteIdentity(favorite: Pick<Favorite, 'coordinates' | 'providerId' | 'provider'>) {
  if (favorite.providerId) return `${favorite.provider ?? 'place'}:${favorite.providerId}`;
  return `coordinate:${favorite.coordinates[0].toFixed(5)},${favorite.coordinates[1].toFixed(5)}`;
}

export function upsertFavorite(favorites: Favorite[], favorite: Favorite) {
  const identity = favoriteIdentity(favorite);
  const existing = favorites.find((item) => favoriteIdentity(item) === identity);
  if (!existing) return [...favorites, favorite];
  return favorites.map((item) => item.id === existing.id
    ? { ...favorite, id: existing.id, createdAt: existing.createdAt }
    : item);
}

export function orderedFavorites(favorites: Favorite[], query = '') {
  const normalized = query.trim().toLocaleLowerCase();
  return favorites
    .filter((favorite) => !normalized || `${favorite.name} ${favorite.address ?? ''} ${favorite.category}`
      .toLocaleLowerCase().includes(normalized))
    .sort((a, b) => {
      const rank = (kind: FavoriteKind) => kind === 'home' ? 0 : kind === 'work' ? 1 : 2;
      return rank(a.kind) - rank(b.kind) || a.createdAt - b.createdAt;
    });
}

export function favoriteMapFeatures(favorites: Favorite[]) {
  return favorites.map((favorite) => ({
    type: 'Feature' as const,
    id: favorite.id,
    geometry: { type: 'Point' as const, coordinates: favorite.coordinates },
    properties: {
      name: favorite.name,
      class: favorite.category,
      city: favorite.address,
      iconId: favorite.iconId,
      favoriteId: favorite.id,
      favoriteKind: favorite.kind,
    },
  }));
}

export function loadFavorites(storage: Pick<Storage, 'getItem'> = window.localStorage): Favorite[] {
  try {
    const value = JSON.parse(storage.getItem(FAVORITES_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Favorite => {
      const candidate = item as Partial<Favorite>;
      return typeof candidate.id === 'string'
        && typeof candidate.name === 'string'
        && Array.isArray(candidate.coordinates)
        && candidate.coordinates.length === 2
        && candidate.coordinates.every(Number.isFinite);
    });
  } catch { return []; }
}

export function saveFavorites(favorites: Favorite[], storage: Pick<Storage, 'setItem'> = window.localStorage) {
  storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
}
