import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Map } from 'maplibre-gl';
import { orderedFavorites, type Favorite } from '../lib/Favorites';
import { parseCoordinates } from './PositionInformation';
import { searchTransitStops, type TransitProviderId } from './transit';

export type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    transitStopId?: string;
    transitMode?: string;
    transitProvider?: TransitProviderId;
    favoriteId?: string;
    coordinateResult?: boolean;
    [key: string]: unknown;
  };
};

function isValidCoordinate(coordinate: unknown): coordinate is [number, number] {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

export function useMapSearch(mapRef: RefObject<Map | null>, favorites: Favorite[], favoritesOpen: boolean, transitEnabled: boolean) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PhotonFeature[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResultsQuery, setSearchResultsQuery] = useState('');
  const [highlightedSearchResults, setHighlightedSearchResults] = useState<PhotonFeature[]>([]);
  const transitSearchCacheRef = useRef(new globalThis.Map<string, PhotonFeature[]>());
  const pendingSearchSubmitRef = useRef<string | null>(null);
  const selectedSearchQueryRef = useRef<string | null>(null);

  const coordinateSearchFeature = useMemo<PhotonFeature | undefined>(() => {
    const coordinates = parseCoordinates(searchQuery);
    return coordinates ? { geometry: { coordinates }, properties: { coordinateResult: true } } : undefined;
  }, [searchQuery]);

  const favoriteFeatures = useMemo(() => orderedFavorites(favorites, favoritesOpen ? '' : searchQuery).map((favorite): PhotonFeature => ({
    geometry: { coordinates: favorite.coordinates },
    properties: {
      name: favorite.name,
      city: favorite.address,
      class: favorite.category,
      favoriteId: favorite.id,
      transitStopId: favorite.transitStopId ?? (favorite.provider === 'transit' ? favorite.providerId?.split(':').slice(1).join(':') : undefined),
      transitProvider: (favorite.transitProvider ?? (favorite.provider === 'transit' ? favorite.providerId?.split(':')[0] : undefined)) as TransitProviderId | undefined,
      transitMode: favorite.transitMode,
      favoriteEntityType: favorite.entityType,
    },
  })), [favorites, favoritesOpen, searchQuery]);

  const displayedSearchResults = useMemo(() => [
    ...favoriteFeatures,
    ...(!favoritesOpen && coordinateSearchFeature ? [coordinateSearchFeature] : []),
    ...(!favoritesOpen && searchQuery.trim().length >= 2 ? searchResults : []),
  ].filter((feature, index, all) => all.findIndex((candidate) => (
    candidate.geometry.coordinates.join(',') === feature.geometry.coordinates.join(',')
  )) === index).slice(0, 8), [coordinateSearchFeature, favoriteFeatures, favoritesOpen, searchQuery, searchResults]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query && selectedSearchQueryRef.current === query) {
      selectedSearchQueryRef.current = null;
      return;
    }
    if (query.length < 2) {
      setSearchResults([]);
      setSearchResultsQuery('');
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ q: query, limit: '6', location_bias_scale: '0.2' });
        const map = mapRef.current;
        if (map) {
          const center = map.getCenter();
          params.set('lon', center.lng.toFixed(6));
          params.set('lat', center.lat.toFixed(6));
          params.set('zoom', String(Math.round(map.getZoom())));
        }
        const cacheKey = map
          ? `${query.toLocaleLowerCase()}|${map.getCenter().lng.toFixed(1)},${map.getCenter().lat.toFixed(1)}|${Math.floor(map.getZoom())}`
          : query.toLocaleLowerCase();
        const cachedResults = transitSearchCacheRef.current.get(cacheKey);
        if (cachedResults) {
          setSearchResults(cachedResults);
          setSearchResultsQuery(query);
          return;
        }
        const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Search service unavailable');
        const data = await response.json() as { features?: PhotonFeature[] };
        const photonResults = data.features ?? [];
        const transitResults: PhotonFeature[] = [];
        if (map && transitEnabled) {
          const center = map.getCenter();
          const zoom = map.getZoom();
          const radiusDegrees = zoom >= 12 ? 0.35 : zoom >= 9 ? 0.75 : 1.5;
          try {
            const stops = await searchTransitStops(query, {
              south: Math.max(-85, center.lat - radiusDegrees), west: center.lng - radiusDegrees,
              north: Math.min(85, center.lat + radiusDegrees), east: center.lng + radiusDegrees,
            }, controller.signal);
            stops.forEach((stop) => transitResults.push({
              geometry: { coordinates: stop.coordinates },
              properties: { name: stop.name, transitStopId: stop.stopId, transitMode: stop.mode, transitProvider: stop.provider },
            }));
          } catch (transitError) {
            if ((transitError as Error).name === 'AbortError') throw transitError;
            console.warn('Transit stop search unavailable.', transitError);
          }
        }
        const results = [...transitResults, ...photonResults].filter((feature) => isValidCoordinate(feature.geometry.coordinates)).slice(0, 6);
        transitSearchCacheRef.current.set(cacheKey, results);
        setSearchResults(results);
        setSearchResultsQuery(query);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setSearchResults([]);
          setSearchResultsQuery(query);
          setSearchError('Could not search right now');
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [mapRef, searchQuery, selectedSearchQueryRef, transitEnabled]);

  return {
    searchQuery, setSearchQuery, searchResults, setSearchResults, searchOpen, setSearchOpen,
    searchLoading, setSearchLoading, searchError, setSearchError, searchResultsQuery,
    highlightedSearchResults, setHighlightedSearchResults, coordinateSearchFeature, favoriteFeatures, displayedSearchResults,
    pendingSearchSubmitRef, selectedSearchQueryRef,
  };
}
