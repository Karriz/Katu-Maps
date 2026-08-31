import { useEffect } from 'react';
import { fetchDigitransitRoute } from './transit';
import { fetchTransitRoutes } from './TransitRouting';
import type { useRoutePlanning } from './useRoutePlanning';
import type { RouteResult } from './ValhallaRouting';
import { fetchValhallaRoute } from './ValhallaRouting';

type RoutePlanning = ReturnType<typeof useRoutePlanning>;

type RouteExecutionProps = {
  route: RoutePlanning;
  showTransitLegVehicle: (result: RouteResult) => void;
  setRouteGeometry: (result: RouteResult | null) => void;
  scheduleRouteFit: (result: RouteResult) => void;
};

export function routeExecutionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message === 'Failed to fetch'
    ? 'Routing services are temporarily unavailable. Check your connection and try again.'
    : message || 'Could not calculate a route';
}

export function useRouteExecution({ route, showTransitLegVehicle, setRouteGeometry, scheduleRouteFit }: RouteExecutionProps) {
  const {
    routeMode, routeOriginSelection, routeDestinationSelection, transitDateTime, transitTimeMode,
    transitRouteOptions, setRouteLoading, setRouteError, setTransitRouteOptions,
    setSelectedTransitRouteIndex, setTransitDetailsOpen, routeSheetSnapBeforeDetailsRef,
    setRouteSheetCollapsed, setRouteResult, routeAbortRef,
  } = route;

  const requestRoute = async (origin: [number, number], destination: [number, number]) => {
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setRouteLoading(true);
    setRouteError(null);
    setTransitRouteOptions([]);
    setSelectedTransitRouteIndex(0);
    setTransitDetailsOpen(false);
    routeSheetSnapBeforeDetailsRef.current = null;
    setRouteSheetCollapsed(false);
    try {
      let result: RouteResult;
      if (routeMode === 'transit') {
        const options = await fetchTransitRoutes(origin, destination, {
          originStopId: routeOriginSelection?.transitStopId,
          originStopProvider: routeOriginSelection?.transitStopProvider,
          destinationStopId: routeDestinationSelection?.transitStopId,
          destinationStopProvider: routeDestinationSelection?.transitStopProvider,
          time: transitDateTime ? new Date(transitDateTime).toISOString() : undefined,
          arriveBy: transitTimeMode === 'arrive', signal: controller.signal,
        });
        if (!options[0]) throw new Error('No transit route options were returned');
        setTransitRouteOptions(options);
        result = options[0];
      } else {
        try {
          result = { ...(await fetchDigitransitRoute(origin, destination, routeMode, controller.signal)), provider: 'digitransit' };
        } catch (digitransitError) {
          if (controller.signal.aborted) throw digitransitError;
          try {
            result = await fetchValhallaRoute(origin, destination, routeMode, controller.signal);
          } catch (fallbackError) {
            if (controller.signal.aborted) throw fallbackError;
            const primary = digitransitError instanceof Error ? digitransitError.message : 'service unavailable';
            const fallback = fallbackError instanceof Error ? fallbackError.message : 'service unavailable';
            throw new Error(`Routing unavailable. Digitransit: ${primary}. Valhalla: ${fallback}`);
          }
        }
      }
      if (controller.signal.aborted) return;
      setRouteResult(result);
      showTransitLegVehicle(result);
      setRouteGeometry(result);
      scheduleRouteFit(result);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setRouteResult(null);
        setRouteGeometry(null);
        setRouteError(routeExecutionErrorMessage(error));
      }
    } finally {
      if (!controller.signal.aborted) setRouteLoading(false);
    }
  };

  const selectTransitRoute = (index: number) => {
    const option = transitRouteOptions[index];
    if (!option) return;
    setSelectedTransitRouteIndex(index);
    setRouteResult(option);
    showTransitLegVehicle(option);
    setRouteGeometry(option);
    scheduleRouteFit(option);
  };

  useEffect(() => {
    if (!route.routeResult || routeMode !== 'transit') return;
    const timer = window.setInterval(() => showTransitLegVehicle(route.routeResult!), 30_000);
    return () => window.clearInterval(timer);
  }, [route.routeResult, routeMode, showTransitLegVehicle]);

  return { requestRoute, selectTransitRoute };
}
