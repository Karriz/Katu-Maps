import { useEffect, useRef, useState } from 'react';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import {
  Bike,
  Building2,
  Box,
  Camera,
  CarFront,
  Compass,
  PlugZap,
  Crosshair,
  Footprints,
  Globe2,
  Code2,
  Layers3,
  Route,
  Mountain,
  Minus,
  Plus,
  Search,
  Star,
  Thermometer,
  TrainFront,
  TrainTrack,
  Trees,
  X,
  Moon,
  Sun,
  CloudSun,
  Monitor,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import type { ThemePreference } from '../theme';
import { useAutocompleteNavigation } from '../lib/useAutocompleteNavigation';

export type MapLayerKey =
  | 'globe'
  | 'terrain'
  | 'buildings'
  | 'trees'
  | 'cycling'
  | 'hiking'
  | 'transit'
  | 'transitLines'
  | 'transitModels'
  | 'trafficCameras'
  | 'chargingStations'
  | 'roadWeather'
  | 'roadTraffic'
  | 'weather';

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

type LayerGroup = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  layers: LayerDefinition[];
};

const layerGroups: LayerGroup[] = [
  {
    id: 'map',
    label: 'Map',
    layers: [
      { key: 'terrain', label: 'Terrain', description: 'Land & elevation', icon: Mountain },
      { key: 'buildings', label: '3D buildings', description: 'Flat footprints when off', icon: Building2 },
    ],
  },
  {
    id: 'transit',
    label: 'Transit',
    layers: [
      { key: 'transitLines', label: 'Transit lines', description: 'Colored metro, tram & rail', icon: TrainTrack },
      { key: 'transit', label: 'Transit stops', description: 'Interactive stops & departures', icon: TrainFront },
    ],
  },
  {
    id: 'driving',
    label: 'Driving',
    layers: [
      { key: 'roadTraffic', label: 'Traffic', description: 'Congestion, roadworks & incidents', icon: CarFront },
      { key: 'roadWeather', label: 'Road weather', description: 'Temperature, ice & surface', icon: Thermometer },
      { key: 'trafficCameras', label: 'Traffic cameras', description: 'Finnish roadside cameras', icon: Camera },
      { key: 'chargingStations', label: 'Charging stations', description: 'Open Charge Map locations', icon: PlugZap },
    ],
  },
  {
    id: 'bike-walk',
    label: 'Bike & walk',
    layers: [
      { key: 'cycling', label: 'Cycling routes', description: 'Emphasized cycle networks', icon: Bike },
      { key: 'hiking', label: 'Hiking routes', description: 'Trails, shelters & viewpoints', icon: Footprints },
    ],
  },
  {
    id: 'weather',
    label: 'Weather',
    layers: [
      { key: 'weather', label: 'Weather', description: 'Forecast for the viewed location', icon: CloudSun },
    ],
  },
];

const advancedLayers: LayerDefinition[] = [
  { key: 'trees', label: 'Trees', description: '3D vegetation models', icon: Trees },
  { key: 'transitModels', label: '3D vehicles', description: 'Live vehicle models', icon: Box },
  { key: 'globe', label: 'Globe', description: 'World projection', icon: Globe2 },
];

const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || 'dev';

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
  // Mobile browsers scroll focused form controls into view and can inflate the
  // sheet with empty space. Keep focus on the visible row instead.
  return (
    <button
      className="layer-toggle"
      type="button"
      role="switch"
      aria-checked={enabled}
      onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
      onClick={() => onChange(!enabled)}
    >
      <span className="layer-toggle-icon" aria-hidden="true"><Icon /></span>
      <span className="layer-toggle-copy">
        <strong>{definition.label}</strong>
        <small>{definition.description}</small>
      </span>
      <span className="layer-switch" aria-hidden="true"><span /></span>
    </button>
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
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpHeadingRef = useRef<HTMLHeadingElement>(null);
  const onSearchFocusRef = useRef(onSearchFocus);
  onSearchFocusRef.current = onSearchFocus;
  const [helpOpen, setHelpOpen] = useState(false);
  const [openLayerGroups, setOpenLayerGroups] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(layerGroups.map((group) => [group.id, group.defaultOpen !== false]))
  ));
  const layerSheet = useMobileBottomSheet('half');
  const shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const suggestionsVisible = searchOpen && (favoritesOpen || query.trim().length >= 2 || searchResults.length > 0);
  const searchNavigation = useAutocompleteNavigation({
    count: searchResults.length,
    open: suggestionsVisible,
    onSelect: onSearchResultSelect,
    onEscape: onSearchClose,
    resetKey: query,
  });

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        onSearchFocusRef.current();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (helpOpen) helpHeadingRef.current?.focus();
  }, [helpOpen]);

  const closeHelp = () => {
    setHelpOpen(false);
    window.requestAnimationFrame(() => helpButtonRef.current?.focus());
  };

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
            role="combobox"
            aria-label="Search for a place"
            aria-autocomplete="list"
            aria-expanded={suggestionsVisible}
            aria-controls="location-search-results"
            aria-activedescendant={searchNavigation.highlightedIndex >= 0 ? `location-search-option-${searchNavigation.highlightedIndex}` : undefined}
            placeholder="Search places…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={onSearchFocus}
            onKeyDown={searchNavigation.onKeyDown}
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
        {suggestionsVisible && (
          <div id="location-search-results" className="location-search-results" role="listbox" aria-label={favoritesOpen ? 'Favourite places' : 'Location search results'}>
            {searchError && <div className="location-search-message">{searchError}</div>}
            {!searchLoading && !searchError && searchResults.length === 0 && (
              <div className="location-search-message">{favoritesOpen ? 'No favourites saved yet' : 'No places found'}</div>
            )}
            {searchResults.map((result, index) => (
              <button
                id={`location-search-option-${index}`}
                className={`location-search-result${searchNavigation.highlightedIndex === index ? ' highlighted' : ''}`}
                key={result.id}
                type="button"
                role="option"
                aria-selected={searchNavigation.highlightedIndex === index}
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
            ref={helpButtonRef}
            className={`map-tool-help${helpOpen ? ' active' : ''}`}
            type="button"
            aria-label="Controls help"
            aria-expanded={helpOpen}
            aria-controls="controls-help-panel"
            title="Controls help"
            onClick={() => { if (helpOpen) closeHelp(); else setHelpOpen(true); }}
          >
            <CircleHelp aria-hidden="true" />
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

        {helpOpen && (
          <section
            className="controls-help-panel"
            id="controls-help-panel"
            aria-labelledby="controls-help-heading"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') closeHelp();
            }}
          >
            <header>
              <h2 id="controls-help-heading" ref={helpHeadingRef} tabIndex={-1}>Controls help</h2>
              <button className="controls-help-close" type="button" aria-label="Close controls help" onClick={closeHelp}><X aria-hidden="true" /></button>
            </header>
            <div className="controls-help-content">
              <section><h3>Touch</h3><ul>
                <li>Drag to move</li><li>Pinch to zoom</li><li>Rotate and tilt with two fingers</li>
                <li>Long-press for location actions</li><li>Tap a place or marker for details</li>
                <li>Drag or use provided controls to expand panels</li>
              </ul></section>
              <section><h3>Mouse and keyboard</h3><ul>
                <li>Drag and scroll</li><li>Right-click for location actions</li>
                <li><kbd>Arrow keys</kbd> to pan</li><li><kbd>+</kbd> / <kbd>−</kbd> to zoom</li>
                <li><kbd>Tab</kbd> to navigate controls</li><li><kbd>Arrow keys</kbd> to navigate suggestions</li>
                <li><kbd>Enter</kbd> to select or submit</li><li><kbd>Escape</kbd> to close the current menu</li>
                <li><kbd>{shortcutModifier}</kbd> + <kbd>K</kbd> to focus search</li>
              </ul></section>
            </div>
            <footer className="controls-help-footer">
              <div className="controls-help-brand">
                <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
                <strong>Katu Maps</strong>
                <span className="controls-help-version" aria-label={`Version ${appVersion}`}>{appVersion}</span>
              </div>
              <div className="controls-help-links">
                <a className="controls-help-source controls-help-source-offset" href="https://github.com/Karriz/Katu-Maps/blob/main/apps/map-app/public/privacy.md" target="_blank" rel="noopener noreferrer">Privacy policy</a>
                <a className="controls-help-source" href="https://github.com/Karriz/Katu-Maps" target="_blank" rel="noopener noreferrer">
                  <Code2 aria-hidden="true" />
                  <span>View source on GitHub</span>
                </a>
              </div>
            </footer>
          </section>
        )}

        {layersOpen && (
          <section
            className={`layer-panel mobile-bottom-sheet${layerSheet.dragging ? ' is-dragging' : ''}`}
            id="map-layer-panel"
            aria-label="Map layer visibility"
            style={layerSheet.style}
            data-snap={layerSheet.snap}
          >
            <MobileSheetHandle {...layerSheet} closeLabel="Close map layers" onClose={() => onLayersOpenChange(false)} />
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
              {layerGroups.map((group) => (
                <details
                  className="layer-group"
                  key={group.id}
                  open={openLayerGroups[group.id] !== false}
                  onToggle={(event) => {
                    const nextOpen = event.currentTarget.open;
                    setOpenLayerGroups((current) => (
                      current[group.id] === nextOpen ? current : { ...current, [group.id]: nextOpen }
                    ));
                  }}
                >
                  <summary className="layer-group-toggle" aria-labelledby={`layer-group-${group.id}`}>
                    <h3 className="layer-group-label" id={`layer-group-${group.id}`}>{group.label}</h3>
                  </summary>
                  <div className="layer-list">
                    {group.layers.map((definition) => (
                      <LayerRow
                        key={definition.key}
                        definition={definition}
                        enabled={layers[definition.key]}
                        onChange={(enabled) => onLayerChange(definition.key, enabled)}
                      />
                    ))}
                  </div>
                </details>
              ))}
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
            </div>
          </section>
        )}
      </div>
    </>
  );
}
