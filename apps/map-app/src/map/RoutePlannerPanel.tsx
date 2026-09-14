import { lazy, Suspense, type ComponentProps } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { RoutePlannerControls } from './RoutePlannerControls';
import type { useRoutePlanning } from './useRoutePlanning';

const TransitJourneyDetails = lazy(() => import('./TransitJourneyDetails').then((module) => ({
  default: module.TransitJourneyDetails,
})));
const TransitJourneyHeader = lazy(() => import('./TransitJourneyDetails').then((module) => ({
  default: module.TransitJourneyHeader,
})));

type RoutePlanning = ReturnType<typeof useRoutePlanning>;
type RouteControlsProps = Omit<ComponentProps<typeof RoutePlannerControls>, 'route'>;

type RoutePlannerPanelProps = {
  route: RoutePlanning;
  controls: RouteControlsProps;
  onCancel: () => void;
};

export function RoutePlannerPanel({ route, controls, onCancel }: RoutePlannerPanelProps) {
  const {
    routeMode,
    routeOpen,
    routePicking,
    setRoutePicking,
    routeOriginSelection,
    routeDestinationSelection,
    routeLoading,
    routeError,
    routeResult,
    transitRouteOptions,
    selectedTransitRouteIndex,
    transitDetailsOpen,
    routeSheet,
    routeSheetCollapsed,
    journeyBackButtonRef,
    journeyDetailsToggleRef,
    routePickingRef,
    openTransitDetails,
    closeTransitDetails,
  } = route;
  const selectedTransitOption = transitRouteOptions[selectedTransitRouteIndex];
  const setJourneyBackButton = (button: HTMLButtonElement | null) => {
    journeyBackButtonRef.current = button;
    button?.focus();
  };

  return (
    <>
      {routePicking && (
        <div className="route-selection-banner" role="status">
          <strong>Pick {routePicking === 'origin' ? 'a starting point' : 'a destination'}</strong>
          <span>Click anywhere on the map</span>
          <button type="button" onClick={() => { routePickingRef.current = null; setRoutePicking(null); }}>Cancel</button>
        </div>
      )}
      {routeOpen && !routePicking && (
        <aside
          className={`route-panel mobile-bottom-sheet${routeSheetCollapsed ? ' route-sheet-collapsed' : ''}${routeSheet.dragging ? ' is-dragging' : ''}${transitDetailsOpen ? ' transit-journey-detail' : ''}`}
          style={routeSheet.style}
          data-snap={routeSheet.snap}
          aria-label={transitDetailsOpen ? 'Journey details' : 'Route details'}
        >
          <MobileSheetHandle {...routeSheet} closeLabel="Close route planner" onClose={onCancel} />
          {transitDetailsOpen && (
            <Suspense fallback={null}>
              <TransitJourneyHeader
                originName={routeOriginSelection?.name}
                destinationName={routeDestinationSelection?.name}
                selectedOption={selectedTransitOption}
                backButtonRef={setJourneyBackButton}
                onBack={closeTransitDetails}
              />
            </Suspense>
          )}
          <div className="route-panel-heading" {...routeSheet.handleProps}>
            <div><strong>Plan a route</strong><span>Search for a place or pick it on the map</span></div>
            <button className="route-panel-close" type="button" aria-label="Close route planner" onClick={onCancel}>
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="route-panel-body">
            <RoutePlannerControls route={route} {...controls} />
            {routeResult && !routeLoading && (
              <>
                {routeResult.provider && (
                  <div className="route-provider-status" role="status">
                    <span className="route-provider-status-dot" aria-hidden="true" />
                    {routeResult.provider === 'digitransit' ? 'Digitransit routing'
                      : routeResult.provider === 'transitous' ? 'Transitous routing'
                        : routeResult.provider === 'osrm' ? 'OSRM routing' : 'Valhalla routing'}
                  </div>
                )}
                {routeMode !== 'transit' && <div className="route-summary">
                  <strong>{routeResult.distanceKm < 1 ? `${Math.round(routeResult.distanceKm * 1000)} m` : `${routeResult.distanceKm.toFixed(1)} km`}</strong>
                  <span>{routeResult.durationSeconds < 3600 ? `${Math.round(routeResult.durationSeconds / 60)} min` : `${Math.floor(routeResult.durationSeconds / 3600)} h ${Math.round(routeResult.durationSeconds % 3600 / 60)} min`}</span>
                </div>}
                {routeMode === 'transit' && routeResult.transitLegs && (
                  <button
                    ref={journeyDetailsToggleRef}
                    className="transit-route-details-toggle"
                    type="button"
                    onClick={transitDetailsOpen ? closeTransitDetails : openTransitDetails}
                  >
                    {transitDetailsOpen ? 'Hide journey details' : 'View journey details'}
                    <ArrowRight aria-hidden="true" />
                  </button>
                )}
                {routeMode === 'transit' && transitDetailsOpen && routeResult.transitLegs && (
                  <Suspense fallback={null}>
                    <TransitJourneyDetails
                      routeResult={routeResult}
                      destinationName={routeDestinationSelection?.name}
                      selectedOption={selectedTransitOption}
                    />
                  </Suspense>
                )}
              </>
            )}
            {!routeLoading && !routeResult && !routeError && !routeOriginSelection && (
              <p className="route-panel-message">Choose a starting point to begin.</p>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
