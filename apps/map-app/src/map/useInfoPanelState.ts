import { useCallback, useState } from 'react';
import type { TransitStopSelection } from './TransitStopsLayer';
import type { LocationSelection } from './useRoutePlanning';
import type { AddressState, ElevationState } from './PositionInformation';
import type { TrafficCameraSelection } from './TrafficCameras';
import type { ChargingStation } from './ChargingStations';
import type { RoadWeatherStation } from './RoadWeather';
import type { RoadTrafficStation } from './RoadTraffic';
import type { RoadTrafficMessage } from './RoadTrafficMessages';

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
  const [selectedChargingStation, setSelectedChargingStation] = useState<ChargingStation | null>(null);
  const [selectedRoadWeather, setSelectedRoadWeather] = useState<RoadWeatherStation | null>(null);
  const [selectedRoadTraffic, setSelectedRoadTraffic] = useState<RoadTrafficStation | null>(null);
  const [selectedRoadTrafficMessage, setSelectedRoadTrafficMessage] = useState<RoadTrafficMessage | null>(null);
  const [positionInformation, setPositionInformation] = useState<PositionInformationState | null>(null);

  const closePositionInformation = useCallback(() => setPositionInformation(null), []);
  const closeLocationInformation = useCallback(() => setSelectedLocation(null), []);
  const closeTransitInformation = useCallback(() => setSelectedTransitStop(null), []);
  const closeTrafficCamera = useCallback(() => setSelectedTrafficCamera(null), []);
  const closeChargingStation = useCallback(() => setSelectedChargingStation(null), []);
  const closeRoadWeather = useCallback(() => setSelectedRoadWeather(null), []);
  const closeRoadTraffic = useCallback(() => setSelectedRoadTraffic(null), []);
  const closeRoadTrafficMessage = useCallback(() => setSelectedRoadTrafficMessage(null), []);
  const closeAllInformation = useCallback(() => {
    setPositionInformation(null);
    setSelectedLocation(null);
    setSelectedTransitStop(null);
    setSelectedTrafficCamera(null);
    setSelectedChargingStation(null);
    setSelectedRoadWeather(null);
    setSelectedRoadTraffic(null);
    setSelectedRoadTrafficMessage(null);
  }, []);

  return {
    selectedLocation,
    setSelectedLocation,
    selectedTransitStop,
    setSelectedTransitStop,
    selectedTrafficCamera,
    setSelectedTrafficCamera,
    selectedChargingStation,
    setSelectedChargingStation,
    selectedRoadWeather,
    setSelectedRoadWeather,
    selectedRoadTraffic,
    setSelectedRoadTraffic,
    selectedRoadTrafficMessage,
    setSelectedRoadTrafficMessage,
    positionInformation,
    setPositionInformation,
    closePositionInformation,
    closeLocationInformation,
    closeTransitInformation,
    closeTrafficCamera,
    closeChargingStation,
    closeRoadWeather,
    closeRoadTraffic,
    closeRoadTrafficMessage,
    closeAllInformation,
  };
}
