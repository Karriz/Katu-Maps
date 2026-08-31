import { useEffect, useRef } from 'react';
import {
  Bike,
  Building2,
  Box,
  Compass,
  Crosshair,
  Footprints,
  Globe2,
  Layers3,
  Route,
  Mountain,
  Minus,
  Plus,
  Search,
  Star,
  TrainFront,
  TrainTrack,
  Trees,
  X,
  Moon,
  Sun,
  Monitor,
  type LucideIcon,
} from 'lucide-react';
import type { ThemePreference } from '../theme';

export type MapLayerKey =
  | 'globe'
  | 'terrain'
  | 'buildings'
  | 'trees'
  | 'cycling'
  | 'hiking'
  | 'transit'
  | 'transitLines'
  | 'transitModels';

export type MapLayerState = Record<MapLayerKey, boolean>;

type SearchResult = {
  id: string;
  primary: string;
  secondary?: string;
};

type LayerDefinition = {
  key: MapLayerKey;
  label: string;
  description: string;
  icon: LucideIcon;
};

const primaryLayers: LayerDefinition[] = [
  { key: 'terrain', label: 'Terrain', description: 'Land & elevation', icon: Mountain },
  { key: 'buildings', label: '3D buildings', description: 'Flat footprints when off', icon: Building2 },
  { key: 'cycling', label: 'Cycling routes', description: 'Emphasized cycle networks', icon: Bike },
  { key: 'hiking', label: 'Hiking routes', description: 'Trails, shelters & viewpoints', icon: Footprints },
  { key: 'transitLines', label: 'Transit lines', description: 'Colored metro, tram & rail', icon: TrainTrack },
  { key: 'transit', label: 'Transit stops', description: 'Interactive stops & departures', icon: TrainFront },
];

const advancedLayers: LayerDefinition[] = [
  { key: 'trees', label: 'Trees', description: '3D vegetation models', icon: Trees },
  { key: 'transitModels', label: '3D vehicles', description: 'Live vehicle models', icon: Box },
  { key: 'globe', label: 'Globe', description: 'World projection', icon: Globe2 },
];

function LayerRow({
  definition,
  enabled,
  onChange,
}: {
  definition: LayerDefinition;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const Icon = definition.icon;
  return (
    <label className="layer-toggle">
      <span className="layer-toggle-icon" aria-hidden="true"><Icon /></span>
      <span className="layer-toggle-copy">
        <strong>{definition.label}</strong>
        <small>{definition.description}</small>
      </span>
      <input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="layer-switch" aria-hidden="true"><span /></span>
    </label>
  );
}

export function MapControls({
  query,
  searchOpen,
  searchLoading,
  searchError,
  searchResults,
  searchPoweredByPhoton,
  onQueryChange,
  onSearchClear,
  onSearchFocus,
  onSearchClose,
  favoritesOpen,
  onFavoritesToggle,
  onSearchSubmit,
  onSearchResultSelect,
  layersOpen,
  onLayersOpenChange,
  layers,
  onLayerChange,
  onLocate,
  onResetOrientation,
  onZoomIn,
  onZoomOut,
  onRouteOpen,
  routeOpen,
  contentPanelOpen,
  is3dMode,
  onToggle3dMode,
  orientationChanged,
  notice,
  themePreference,
  onThemeChange,
}: {
  query: string;
  searchOpen: boolean;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: SearchResult[];
  searchPoweredByPhoton: boolean;
  onQueryChange: (query: string) => void;
  onSearchClear: () => void;
  onSearchFocus: () => void;
  onSearchClose: () => void;
  favoritesOpen: boolean;
  onFavoritesToggle: () => void;
  onSearchSubmit: () => void;
  onSearchResultSelect: (index: number) => void;
  layersOpen: boolean;
  onLayersOpenChange: (open: boolean) => void;
  layers: MapLayerState;
  onLayerChange: (key: MapLayerKey, enabled: boolean) => void;
  onLocate: () => void;
  onResetOrientation: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRouteOpen: () => void;
  routeOpen: boolean;
  contentPanelOpen: boolean;
  is3dMode: boolean;
  onToggle3dMode: () => void;
  orientationChanged: boolean;
  notice: string | null;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        onSearchFocus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [onSearchFocus]);

  return (
    <>
      {!routeOpen && <div className="location-search">
        <form
          className="location-search-form"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearchSubmit();
          }}
          onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) onSearchClose();
          }}
        >
          <Search aria-hidden="true" />
          <input
            ref={searchInputRef}
            aria-label="Search for a place"
            placeholder="Search places…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={onSearchFocus}
          />
          {query && (
            <button
              className="location-search-clear"
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                onSearchClear();
                searchInputRef.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </button>
          )}
          {searchLoading ? (
            <span className="location-search-spinner" aria-label="Searching" />
          ) : !query && (
            <kbd className="location-search-shortcut"><span>{shortcutModifier}</span>K</kbd>
          )}
          <button
            className={`location-favorites-toggle${favoritesOpen ? ' active' : ''}`}
            type="button"
            aria-label={favoritesOpen ? 'Close favourites' : 'Show favourites'}
            aria-expanded={favoritesOpen}
            aria-controls="location-search-results"
            title={favoritesOpen ? 'Close favourites' : 'Show favourites'}
            onClick={onFavoritesToggle}
          >
            <Star aria-hidden="true" />
          </button>
        </form>
        {searchOpen && (favoritesOpen || query.trim().length >= 2 || searchResults.length > 0) && (
          <div id="location-search-results" className="location-search-results" role="listbox" aria-label={favoritesOpen ? 'Favourite places' : 'Location search results'}>
            {searchError && <div className="location-search-message">{searchError}</div>}
            {!searchLoading && !searchError && searchResults.length === 0 && (
              <div className="location-search-message">{favoritesOpen ? 'No favourites saved yet' : 'No places found'}</div>
            )}
            {searchResults.map((result, index) => (
              <button
                className="location-search-result"
                key={result.id}
                type="button"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSearchResultSelect(index)}
              >
                <strong>{result.primary}</strong>
                {result.secondary && <span>{result.secondary}</span>}
              </button>
            ))}
            {!favoritesOpen && searchPoweredByPhoton && query.trim().length >= 2 && <div className="location-search-attribution">Powered by Photon</div>}
          </div>
        )}
      </div>}

      <div className={`map-tools${layersOpen ? ' layers-open' : ''}${routeOpen ? ' route-open' : ''}${contentPanelOpen ? ' content-panel-open' : ''}`}>
        <div className="map-tool-dock" aria-label="Map tools">
          <button
            className={`map-tool-layers${layersOpen ? ' active' : ''}`}
            type="button"
            aria-label="Map layers"
            aria-expanded={layersOpen}
            aria-controls="map-layer-panel"
            title="Map layers"
            onClick={() => onLayersOpenChange(!layersOpen)}
          >
            <Layers3 aria-hidden="true" />
          </button>
          <button
            className={`map-tool-mode${is3dMode ? ' active' : ''}`}
            type="button"
            aria-label={is3dMode ? 'Switch to 2D map' : 'Switch to 3D map'}
            aria-pressed={is3dMode}
            title={is3dMode ? 'Switch to 2D map' : 'Switch to 3D map'}
            onClick={onToggle3dMode}
          >
            <Box aria-hidden="true" />
          </button>
          <button
            className={`map-tool-route${routeOpen ? ' active' : ''}`}
            type="button"
            aria-label="Plan a route"
            aria-pressed={routeOpen}
            title="Plan a route"
            onClick={onRouteOpen}
          >
            <Route aria-hidden="true" />
          </button>
          <button className="map-tool-locate" type="button" aria-label="Find my location" title="Find my location" onClick={onLocate}>
            <Crosshair aria-hidden="true" />
          </button>
          <button
            className={`map-tool-compass${orientationChanged ? ' orientation-active' : ''}`}
            type="button"
            aria-label="Reset map orientation"
            title="Reset map orientation"
            onClick={onResetOrientation}
          >
            <Compass aria-hidden="true" />
          </button>
          <div className="map-tool-zoom" aria-label="Zoom controls">
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>
              <Plus aria-hidden="true" />
            </button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>
              <Minus aria-hidden="true" />
            </button>
          </div>
        </div>

        {notice && <div className="map-tool-notice" role="status">{notice}</div>}

        {layersOpen && (
          <section className="layer-panel" id="map-layer-panel" aria-label="Map layer visibility">
            <div className="layer-panel-heading">
              <div>
                <strong>Map layers</strong>
                <span>Customize your view</span>
              </div>
              <button
                className="layer-panel-close"
                type="button"
                aria-label="Close map layers"
                onClick={() => onLayersOpenChange(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="layer-panel-content" tabIndex={0}>
              <div className="layer-list">
                {primaryLayers.map((definition) => (
                  <LayerRow
                    key={definition.key}
                    definition={definition}
                    enabled={layers[definition.key]}
                    onChange={(enabled) => onLayerChange(definition.key, enabled)}
                  />
                ))}
              </div>
              <details className="layer-advanced">
                <summary>Advanced details</summary>
                <div className="layer-list">
                  {advancedLayers.map((definition) => (
                    <LayerRow
                      key={definition.key}
                      definition={definition}
                      enabled={layers[definition.key]}
                      onChange={(enabled) => onLayerChange(definition.key, enabled)}
                    />
                  ))}
                </div>
              </details>
              <div className="theme-setting">
                <span className="theme-setting-label">Appearance</span>
                <div className="theme-options" role="group" aria-label="Appearance">
                  {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const).map(([value, label, Icon]) => (
                    <button
                      className={themePreference === value ? 'selected' : ''}
                      key={value}
                      type="button"
                      aria-pressed={themePreference === value}
                      onClick={() => onThemeChange(value)}
                    ><Icon aria-hidden="true" /><span>{label}</span></button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
