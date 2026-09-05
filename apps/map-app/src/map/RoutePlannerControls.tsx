import { createPortal } from 'react-dom';
import { ArrowRightLeft, Clock3, MapPin, X } from 'lucide-react';
import { useRef, type MouseEvent, type MutableRefObject, type RefObject } from 'react';
import type { useRoutePlanning } from './useRoutePlanning';
import type { TransitProviderId } from './transit';
import { TransitRouteOptions } from './TransitRouteOptions';
import { useAutocompleteNavigation } from '../lib/useAutocompleteNavigation';

function dismissSearchInput(input: HTMLInputElement | null) {
  if (!input) {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    return;
  }
  // Readonly-then-blur is required after mousedown preventDefault: otherwise
  // mobile browsers keep the OS keyboard open even if the input loses focus.
  input.setAttribute('readonly', 'true');
  input.blur();
  window.setTimeout(() => input.removeAttribute('readonly'), 0);
}

type PhotonFeature = {
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

type RoutePlanning = ReturnType<typeof useRoutePlanning>;

type RoutePlannerControlsProps = {
  route: RoutePlanning;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchLoading: boolean;
  searchError: string | null;
  displayedSearchResults: PhotonFeature[];
  favoriteFeatures: PhotonFeature[];
  userLocationRef: RefObject<[number, number] | null>;
  routeSearchAnchorRefs: MutableRefObject<Record<'origin' | 'destination', HTMLDivElement | null>>;
  routeSearchResultsRef: RefObject<HTMLDivElement | null>;
  setSearchOpen: (open: boolean) => void;
  setSearchResults: (results: PhotonFeature[]) => void;
  setSearchError: (error: string | null) => void;
  beginRouteSearch: (kind: 'origin' | 'destination') => void;
  pickRouteEndpoint: (kind: 'origin' | 'destination') => void;
  selectYourLocation: (kind: 'origin' | 'destination') => void;
  selectSearchResult: (feature: PhotonFeature) => void;
  selectTransitRoute: (index: number) => void;
  swapRouteEndpoints: () => void;
  photonResultLabel: (feature: PhotonFeature) => { primary: string; secondary: string };
};

export function RoutePlannerControls({
  route,
  searchQuery,
  setSearchQuery,
  searchLoading,
  searchError,
  displayedSearchResults,
  favoriteFeatures,
  userLocationRef,
  routeSearchAnchorRefs,
  routeSearchResultsRef,
  setSearchOpen,
  setSearchResults,
  setSearchError,
  beginRouteSearch,
  pickRouteEndpoint,
  selectYourLocation,
  selectSearchResult,
  selectTransitRoute,
  swapRouteEndpoints,
  photonResultLabel,
}: RoutePlannerControlsProps) {
  const {
    routeMode, setRouteMode, routeSearchTarget, setRouteSearchTarget,
    routeOriginSelection, setRouteOriginSelection, routeDestinationSelection, setRouteDestinationSelection,
    routeLoading, setRouteLoading, routeError, setRouteError, setRouteResult, setTransitRouteOptions,
    transitRouteOptions, selectedTransitRouteIndex, transitTimeControlsOpen, setTransitTimeControlsOpen,
    transitTimeMode, setTransitTimeMode, transitDateTime, setTransitDateTime,
    routeOriginRef, routeDestinationRef, routeAbortRef,
  } = route;
  const routeSearchInputRefs = useRef<Record<'origin' | 'destination', HTMLInputElement | null>>({
    origin: null,
    destination: null,
  });
  const chooseRouteSearchOption = (kind: 'origin' | 'destination', select: () => void) => ({
    onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      dismissSearchInput(routeSearchInputRefs.current[kind]);
      select();
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail !== 0) return;
      dismissSearchInput(routeSearchInputRefs.current[kind]);
      select();
    },
  });
  const routeNavigation = useAutocompleteNavigation({
    count: displayedSearchResults.length + 1,
    open: routeSearchTarget !== null,
    onSelect: (index) => {
      if (routeSearchTarget === null) return;
      dismissSearchInput(routeSearchInputRefs.current[routeSearchTarget]);
      if (index === 0) selectYourLocation(routeSearchTarget);
      else selectSearchResult(displayedSearchResults[index - 1]);
    },
    onEscape: () => setRouteSearchTarget(null),
    resetKey: `${routeSearchTarget ?? ''}:${searchQuery}`,
  });

  return (
    <div className="route-planner-controls">
      <div className="route-endpoints">
        {(['origin', 'destination'] as const).map((kind) => {
          const selection = kind === 'origin' ? routeOriginSelection : routeDestinationSelection;
          const label = kind === 'origin' ? 'Starting point' : 'Destination';
          return (
            <div className="route-endpoint-group" key={kind}>
              <div
                className={`route-search-field${routeSearchTarget === kind ? ' active' : ''}`}
                ref={(element) => { routeSearchAnchorRefs.current[kind] = element; }}
              >
                <MapPin aria-hidden="true" />
                <input
                  ref={(element) => { routeSearchInputRefs.current[kind] = element; }}
                  role="combobox"
                  aria-label={`Search ${label.toLowerCase()}`}
                  aria-autocomplete="list"
                  aria-controls={`route-${kind}-search-results`}
                  aria-expanded={routeSearchTarget === kind}
                  aria-activedescendant={routeSearchTarget === kind && routeNavigation.highlightedIndex >= 0 ? `route-${kind}-option-${routeNavigation.highlightedIndex}` : undefined}
                  placeholder={`Search ${label.toLowerCase()}`}
                  value={routeSearchTarget === kind ? searchQuery : (selection?.name ?? '')}
                  onFocus={() => beginRouteSearch(kind)}
                  onKeyDown={routeNavigation.onKeyDown}
                  onChange={(event) => {
                    setRouteSearchTarget(kind);
                    setSearchQuery(event.target.value);
                    setSearchOpen(false);
                  }}
                />
                {(routeSearchTarget === kind ? searchQuery : selection?.name) && (
                  <button type="button" className="route-field-clear" aria-label={`Clear ${label.toLowerCase()}`} title={`Clear ${label.toLowerCase()}`} onClick={() => {
                    if (kind === 'origin') {
                      routeOriginRef.current = null;
                      setRouteOriginSelection(null);
                    } else {
                      routeDestinationRef.current = null;
                      setRouteDestinationSelection(null);
                    }
                    routeAbortRef.current?.abort();
                    setRouteLoading(false);
                    setRouteResult(null);
                    setTransitRouteOptions([]);
                    setRouteError(null);
                    setSearchResults([]);
                    setSearchError(null);
                    setSearchQuery('');
                    setRouteSearchTarget(kind);
                  }}>
                    <X aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="route-map-button" onClick={() => pickRouteEndpoint(kind)}>Map</button>
              </div>
              {routeSearchTarget === kind && createPortal(
                <div className="route-search-results route-search-results-floating" id={`route-${kind}-search-results`} ref={routeSearchResultsRef} role="listbox" aria-label={`Search ${label.toLowerCase()} results`}>
                  <button id={`route-${kind}-option-0`} role="option" aria-selected={routeNavigation.highlightedIndex === 0} className={`route-search-result route-search-current-location${routeNavigation.highlightedIndex === 0 ? ' highlighted' : ''}`} type="button" {...chooseRouteSearchOption(kind, () => selectYourLocation(kind))}>
                    <strong>Your location</strong>
                    <span>{userLocationRef.current ? 'Use current GPS position' : 'Request location access'}</span>
                  </button>
                  {searchLoading && <div className="route-search-message">Searching…</div>}
                  {!searchLoading && searchError && <div className="route-search-message">{searchError}</div>}
                  {!searchLoading && !searchError && searchQuery.trim().length >= 2 && displayedSearchResults.length === 0 && <div className="route-search-message">No places found</div>}
                  {!searchLoading && (searchQuery.trim().length >= 2 || favoriteFeatures.length > 0) && displayedSearchResults.map((feature, index) => {
                    const { primary, secondary } = photonResultLabel(feature);
                    const optionIndex = index + 1;
                    return <button id={`route-${kind}-option-${optionIndex}`} role="option" aria-selected={routeNavigation.highlightedIndex === optionIndex} className={`route-search-result${routeNavigation.highlightedIndex === optionIndex ? ' highlighted' : ''}`} key={`${feature.geometry.coordinates.join(':')}-${index}`} type="button" {...chooseRouteSearchOption(kind, () => selectSearchResult(feature))}><strong>{primary}</strong>{secondary && <span>{secondary}</span>}</button>;
                  })}
                </div>,
                document.body,
              )}
            </div>
          );
        })}
        <button type="button" className="route-endpoint-swap" aria-label="Swap starting point and destination" title="Swap start and destination" onClick={swapRouteEndpoints} disabled={!routeOriginSelection && !routeDestinationSelection}>
          <ArrowRightLeft aria-hidden="true" />
        </button>
      </div>
      <div className="route-mode-row">
        <div className="route-mode-tabs" role="tablist" aria-label="Travel mode">
          {([['pedestrian', 'Walk'], ['bicycle', 'Cycle'], ['transit', 'Transit'], ['auto', 'Drive']] as const).map(([mode, label]) => <button key={mode} role="tab" aria-selected={routeMode === mode} type="button" className={routeMode === mode ? 'active' : ''} onClick={() => setRouteMode(mode)}>{label}</button>)}
        </div>
        {routeMode === 'transit' && <button className={`transit-time-toggle${transitTimeControlsOpen ? ' active' : ''}`} type="button" aria-label="Show transit time options" aria-pressed={transitTimeControlsOpen} onClick={() => setTransitTimeControlsOpen((open) => !open)}><Clock3 aria-hidden="true" /></button>}
      </div>
      {routeMode === 'transit' && transitTimeControlsOpen && <div className="transit-time-controls">
        <div className="transit-time-tabs" role="tablist" aria-label="Transit time preference">
          {([['depart', 'Depart at'], ['arrive', 'Arrive by']] as const).map(([mode, label]) => <button key={mode} role="tab" aria-selected={transitTimeMode === mode} type="button" className={transitTimeMode === mode ? 'active' : ''} onClick={() => setTransitTimeMode(mode)}>{label}</button>)}
        </div>
        <input aria-label={transitTimeMode === 'depart' ? 'Depart at date and time' : 'Arrive by date and time'} type="datetime-local" value={transitDateTime} onChange={(event) => setTransitDateTime(event.target.value)} />
      </div>}
      {routeLoading && <p className="route-panel-message">Calculating route…</p>}
      {routeError && <p className="route-panel-error">{routeError}</p>}
      {routeMode === 'transit' && !routeLoading && transitRouteOptions.length > 0 && <TransitRouteOptions options={transitRouteOptions} selectedIndex={selectedTransitRouteIndex} onSelect={selectTransitRoute} />}
    </div>
  );
}
