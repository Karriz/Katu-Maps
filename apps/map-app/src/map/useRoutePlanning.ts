import { useRef, useState } from 'react';
import type { SheetSnap } from '../lib/useMobileBottomSheet';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import type { TransitProviderId } from './transit';
import type { RouteMode, RouteResult } from './ValhallaRouting';
import type { TransitRouteResult } from './TransitRouting';

export type LocationSelection = {
  name: string;
  category: string;
  address?: string;
  coordinates: [number, number];
  source: 'search' | 'map';
  transitStopId?: string;
  transitStopProvider?: TransitProviderId;
  transitMode?: string;
  openingHours?: string;
  phone?: string;
  email?: string;
  website?: string;
  osmType?: string;
  osmId?: string | number;
  iconId?: string;
  favoriteId?: string;
};

export function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function useRoutePlanning() {
  const [routeMode, setRouteMode] = useState<RouteMode>('pedestrian');
  const [routeOpen, setRouteOpen] = useState(false);
  const [routePicking, setRoutePicking] = useState<'origin' | 'destination' | null>(null);
  const [routeSearchTarget, setRouteSearchTarget] = useState<'origin' | 'destination' | null>(null);
  const [routeContextMenu, setRouteContextMenu] = useState<{ x: number; y: number; coordinates: [number, number] } | null>(null);
  const [routeOriginSelection, setRouteOriginSelection] = useState<LocationSelection | null>(null);
  const [routeDestinationSelection, setRouteDestinationSelection] = useState<LocationSelection | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [transitRouteOptions, setTransitRouteOptions] = useState<TransitRouteResult[]>([]);
  const [selectedTransitRouteIndex, setSelectedTransitRouteIndex] = useState(0);
  const [transitDetailsOpen, setTransitDetailsOpen] = useState(false);
  const [transitTimeMode, setTransitTimeMode] = useState<'depart' | 'arrive'>('depart');
  const [transitDateTime, setTransitDateTime] = useState(() => localDateTimeValue());
  const [transitTimeControlsOpen, setTransitTimeControlsOpen] = useState(false);
  const routeSheet = useMobileBottomSheet('half');
  const routeSheetCollapsed = routeSheet.snap === 'collapsed';
  const routeSheetSnapBeforeDetailsRef = useRef<SheetSnap | null>(null);
  const journeyBackButtonRef = useRef<HTMLButtonElement>(null);
  const journeyDetailsToggleRef = useRef<HTMLButtonElement>(null);
  const routeOriginRef = useRef<[number, number] | null>(null);
  const routeDestinationRef = useRef<[number, number] | null>(null);
  const routePickingRef = useRef<'origin' | 'destination' | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const routeCameraRequestRef = useRef(0);

  const setRouteSheetCollapsed = (collapsed: boolean | ((current: boolean) => boolean)) => {
    const next = typeof collapsed === 'function' ? collapsed(routeSheet.snap === 'collapsed') : collapsed;
    routeSheet.setSnap(next ? 'collapsed' : 'half');
  };

  const openTransitDetails = () => {
    setTransitDetailsOpen(true);
    if (window.innerWidth <= 760) {
      routeSheetSnapBeforeDetailsRef.current = routeSheet.snap;
      routeSheet.setSnap('expanded');
    }
  };

  const closeTransitDetails = () => {
    setTransitDetailsOpen(false);
    const previousSnap = routeSheetSnapBeforeDetailsRef.current;
    routeSheetSnapBeforeDetailsRef.current = null;
    if (window.innerWidth <= 760) {
      routeSheet.setSnap(previousSnap ?? 'half');
      window.requestAnimationFrame(() => journeyDetailsToggleRef.current?.focus());
    }
  };

  return {
    routeMode, setRouteMode, routeOpen, setRouteOpen, routePicking, setRoutePicking,
    routeSearchTarget, setRouteSearchTarget, routeContextMenu, setRouteContextMenu,
    routeOriginSelection, setRouteOriginSelection, routeDestinationSelection, setRouteDestinationSelection,
    routeLoading, setRouteLoading, routeError, setRouteError, routeResult, setRouteResult,
    transitRouteOptions, setTransitRouteOptions, selectedTransitRouteIndex, setSelectedTransitRouteIndex,
    transitDetailsOpen, setTransitDetailsOpen, transitTimeMode, setTransitTimeMode,
    transitDateTime, setTransitDateTime, transitTimeControlsOpen, setTransitTimeControlsOpen,
    routeSheet, routeSheetCollapsed, routeSheetSnapBeforeDetailsRef, journeyBackButtonRef,
    journeyDetailsToggleRef, routeOriginRef, routeDestinationRef, routePickingRef, routeAbortRef,
    routeCameraRequestRef, setRouteSheetCollapsed, openTransitDetails, closeTransitDetails,
  };
}
