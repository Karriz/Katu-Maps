import { useCallback, useState } from 'react';
import type { TransitStopSelection } from './TransitStopsLayer';
import type { LocationSelection } from './useRoutePlanning';
import type { AddressState, ElevationState } from './PositionInformation';
import type { TrafficCameraSelection } from './TrafficCameras';

export type PositionInformationState = {
  coordinates: [number, number];
  elevation: ElevationState;
  address: AddressState;
  favoriteId?: string;
};

export type SelectedTransitStop = TransitStopSelection & { favoriteId?: string };

export function useInfoPanelState() {
  const [selectedLocation, setSelectedLocation] = useState<LocationSelection | null>(null);
  const [selectedTransitStop, setSelectedTransitStop] = useState<SelectedTransitStop | null>(null);
  const [selectedTrafficCamera, setSelectedTrafficCamera] = useState<TrafficCameraSelection | null>(null);
  const [positionInformation, setPositionInformation] = useState<PositionInformationState | null>(null);

  const closePositionInformation = useCallback(() => setPositionInformation(null), []);
  const closeLocationInformation = useCallback(() => setSelectedLocation(null), []);
  const closeTransitInformation = useCallback(() => setSelectedTransitStop(null), []);
  const closeTrafficCamera = useCallback(() => setSelectedTrafficCamera(null), []);
  const closeAllInformation = useCallback(() => {
    setPositionInformation(null);
    setSelectedLocation(null);
    setSelectedTransitStop(null);
    setSelectedTrafficCamera(null);
  }, []);

  return {
    selectedLocation,
    setSelectedLocation,
    selectedTransitStop,
    setSelectedTransitStop,
    selectedTrafficCamera,
    setSelectedTrafficCamera,
    positionInformation,
    setPositionInformation,
    closePositionInformation,
    closeLocationInformation,
    closeTransitInformation,
    closeTrafficCamera,
    closeAllInformation,
  };
}
