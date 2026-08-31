export type FavoriteKind = 'home' | 'work' | 'favorite';
export type FavoriteEntityType = 'place' | 'transit-stop' | 'position';

export type Favorite = {
  id: string;
  name: string;
  coordinates: [number, number];
  category: string;
  address?: string;
  providerId?: string;
  provider?: string;
  iconId?: string;
  entityType?: FavoriteEntityType;
  transitStopId?: string;
  transitProvider?: string;
  transitMode?: string;
  osmType?: string;
  osmId?: string | number;
  openingHours?: string;
  phone?: string;
  email?: string;
  website?: string;
  kind: FavoriteKind;
  createdAt: number;
};

export const FAVORITES_STORAGE_KEY = 'maps-favorites-v1';

export function isValidFavoriteCoordinates(coordinates: unknown): coordinates is [number, number] {
  return Array.isArray(coordinates)
    && coordinates.length === 2
    && typeof coordinates[0] === 'number'
    && Number.isFinite(coordinates[0])
    && coordinates[0] >= -180
    && coordinates[0] <= 180
    && typeof coordinates[1] === 'number'
    && Number.isFinite(coordinates[1])
    && coordinates[1] >= -90
    && coordinates[1] <= 90;
}

export function resolvedFavoriteEntityType(favorite: Favorite): FavoriteEntityType {
  if (favorite.entityType) return favorite.entityType;
  if (favorite.provider === 'transit') return 'transit-stop';
  if (favorite.provider) return 'place';
  return 'position';
}

export function favoriteIdentity(favorite: Pick<Favorite, 'coordinates' | 'providerId' | 'provider'>) {
  if (favorite.providerId) return `${favorite.provider ?? 'place'}:${favorite.providerId}`;
  return `coordinate:${favorite.coordinates[0].toFixed(5)},${favorite.coordinates[1].toFixed(5)}`;
}

export function findTransitFavorite(favorites: Favorite[], stopId: string, provider: string) {
  return favorites.find((favorite) => (
    (favorite.transitStopId === stopId && favorite.transitProvider === provider)
    || (favorite.provider === 'transit' && favorite.providerId === `${provider}:${stopId}`)
  ));
}

export function upsertFavorite(favorites: Favorite[], favorite: Favorite) {
  const identity = favoriteIdentity(favorite);
  const existing = favorites.find((item) => favoriteIdentity(item) === identity)
    ?? favorites.find((item) => favorite.kind !== 'favorite' && item.kind === favorite.kind);
  if (!existing) return [...favorites, favorite];
  return favorites.map((item) => item.id === existing.id
    ? { ...favorite, id: existing.id, createdAt: existing.createdAt }
    : item).filter((item) => favorite.kind === 'favorite'
      || item.kind !== favorite.kind
      || item.id === existing.id);
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
      entityType: favorite.entityType,
      transitStopId: favorite.transitStopId,
      transitProvider: favorite.transitProvider,
      transitMode: favorite.transitMode,
      osmType: favorite.osmType,
      osmId: favorite.osmId,
      openingHours: favorite.openingHours,
      phone: favorite.phone,
      email: favorite.email,
      website: favorite.website,
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
        && isValidFavoriteCoordinates(candidate.coordinates);
    });
  } catch { return []; }
}

export function saveFavorites(favorites: Favorite[], storage: Pick<Storage, 'setItem'> = window.localStorage) {
  storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
}
