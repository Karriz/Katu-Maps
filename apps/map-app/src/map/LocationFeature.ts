import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { FavoriteKind } from '../lib/Favorites';
import { parseLocationMetadata, safeHttpUrl } from './LocationMedia';
import { defaultPositionName, formatCoordinates } from './PositionInformation';
import type { PositionInformationState } from './useInfoPanelState';
import type { LocationSelection } from './useRoutePlanning';
import type { PhotonFeature } from './useMapSearch';

export type PendingFavorite = {
  editingFavoriteId?: string;
  selection: LocationSelection;
  provider?: string;
  providerId?: string;
  kind: FavoriteKind;
  name: string;
  nameWasEdited: boolean;
  addressLoading: boolean;
};

export function positionInformationState(
  coordinates: [number, number],
  address?: string,
  favoriteId?: string,
): PositionInformationState {
  return {
    coordinates,
    elevation: { status: 'loading' },
    address: address ? { status: 'available', address } : { status: 'loading' },
    favoriteId,
  };
}

export function suggestedFavoriteName(selection: LocationSelection) {
  if (selection.name !== 'Map point') return selection.name;
  return defaultPositionName(selection.coordinates, selection.address);
}

export function photonResultLabel(feature: PhotonFeature) {
  if (feature.properties.coordinateResult) {
    return {
      primary: `Go to ${formatCoordinates(feature.geometry.coordinates)}`,
      secondary: 'Coordinates · Open position information',
    };
  }
  const { name, housenumber, street, city, state, country } = feature.properties;
  if (feature.properties.transitStopId) {
    return {
      primary: name || 'Transit stop',
      secondary: `Transit stop${feature.properties.transitMode ? ` · ${feature.properties.transitMode}` : ''}`,
    };
  }
  const address = [housenumber, street].filter(Boolean).join(' ');
  const primary = name || address || city || state || country || 'Unnamed place';
  const secondary = [name && address, city, state, country].filter(Boolean).join(', ');
  return { primary, secondary };
}

export function locationCategory(properties: Record<string, unknown>) {
  const value = String(properties.class ?? properties.osm_value ?? properties.subclass ?? 'place').replaceAll('_', ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function locationIconId(properties: Record<string, unknown>) {
  return String(properties.class ?? properties.osm_value ?? properties.subclass ?? 'shop');
}

function locationName(properties: Record<string, unknown>) {
  return String(properties.name ?? properties['name:en'] ?? 'Interesting place');
}

function locationAddress(properties: Record<string, unknown>) {
  return [properties.housenumber, properties.street, properties.city]
    .filter(Boolean)
    .join(' ')
    .trim() || undefined;
}

function locationProperty(properties: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function locationDetails(properties: Record<string, unknown>) {
  const extra = properties.extra && typeof properties.extra === 'object'
    ? properties.extra as Record<string, unknown>
    : properties.extratags && typeof properties.extratags === 'object'
      ? properties.extratags as Record<string, unknown>
      : {};
  const detailProperties = { ...properties, ...extra };
  const website = locationProperty(detailProperties, 'website', 'contact:website', 'contact_website');
  return {
    openingHours: locationProperty(detailProperties, 'opening_hours', 'openingHours'),
    phone: locationProperty(detailProperties, 'phone', 'contact:phone', 'contact_phone'),
    email: locationProperty(detailProperties, 'email', 'contact:email', 'contact_email'),
    website: safeHttpUrl(website),
    ...parseLocationMetadata(detailProperties),
  };
}

export function locationSelectionFromFeature(feature: MapGeoJSONFeature): LocationSelection {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  return {
    name: locationName(properties),
    category: locationCategory(properties),
    address: locationAddress(properties),
    coordinates: feature.geometry.type === 'Point'
      ? feature.geometry.coordinates as [number, number]
      : [0, 0],
    source: 'map',
    ...locationDetails(properties),
    iconId: locationIconId(properties),
    favoriteId: typeof properties.favoriteId === 'string' ? properties.favoriteId : undefined,
    osmId: typeof properties.osm_id === 'string' || typeof properties.osm_id === 'number'
      ? properties.osm_id
      : (typeof feature.id === 'string' || typeof feature.id === 'number' ? feature.id : undefined),
    osmType: typeof properties.osm_type === 'string' ? properties.osm_type : undefined,
  };
}
