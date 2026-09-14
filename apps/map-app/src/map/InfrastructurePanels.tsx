import type { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import type { ChargingStation } from './ChargingStations';
import { ChargingStationPanel } from './ChargingStationPanel';
import type { RoadTrafficStation } from './RoadTraffic';
import type { RoadTrafficMessage } from './RoadTrafficMessages';
import { RoadTrafficMessagePanel } from './RoadTrafficMessagePanel';
import { RoadTrafficPanel } from './RoadTrafficPanel';
import type { RoadWeatherStation } from './RoadWeather';
import { RoadWeatherPanel } from './RoadWeatherPanel';
import type { TrafficCameraSelection } from './TrafficCameras';
import { TrafficCameraPanel } from './TrafficCameraPanel';
import type { LocationSelection } from './useRoutePlanning';

type Sheet = ReturnType<typeof useMobileBottomSheet>;
type ShareableInfrastructure = { coordinates: [number, number]; name: string };

type InfrastructurePanelsProps = {
  selections: {
    roadWeather: RoadWeatherStation | null;
    roadTrafficMessage: RoadTrafficMessage | null;
    roadTraffic: RoadTrafficStation | null;
    chargingStation: ChargingStation | null;
    trafficCamera: TrafficCameraSelection | null;
  };
  sheets: {
    roadWeather: Sheet;
    roadTrafficMessage: Sheet;
    roadTraffic: Sheet;
    chargingStation: Sheet;
    trafficCamera: Sheet;
  };
  onClose: {
    roadWeather: () => void;
    roadTrafficMessage: () => void;
    roadTraffic: () => void;
    chargingStation: () => void;
    trafficCamera: () => void;
  };
  onShare: (selection: ShareableInfrastructure, minimumZoom: number) => void;
  onDirections: (destination: LocationSelection) => void;
};

export function InfrastructurePanels({
  selections,
  sheets,
  onClose,
  onShare,
  onDirections,
}: InfrastructurePanelsProps) {
  if (selections.roadWeather) {
    const station = selections.roadWeather;
    return <RoadWeatherPanel
      key={station.id}
      station={station}
      sheet={sheets.roadWeather}
      onClose={onClose.roadWeather}
      onShare={() => onShare(station, 12)}
      onDirections={onDirections}
    />;
  }

  if (selections.roadTrafficMessage) {
    const message = selections.roadTrafficMessage;
    return <RoadTrafficMessagePanel
      key={message.id}
      message={message}
      sheet={sheets.roadTrafficMessage}
      onClose={onClose.roadTrafficMessage}
      onShare={() => onShare(message, 12)}
      onDirections={onDirections}
    />;
  }

  if (selections.roadTraffic) {
    const station = selections.roadTraffic;
    return <RoadTrafficPanel
      key={station.id}
      station={station}
      sheet={sheets.roadTraffic}
      onClose={onClose.roadTraffic}
      onShare={() => onShare(station, 11)}
      onDirections={onDirections}
    />;
  }

  if (selections.chargingStation) {
    const station = selections.chargingStation;
    return <ChargingStationPanel
      key={station.id}
      station={station}
      sheet={sheets.chargingStation}
      onClose={onClose.chargingStation}
      onShare={() => onShare(station, 14)}
      onDirections={onDirections}
    />;
  }

  if (selections.trafficCamera) {
    const camera = selections.trafficCamera;
    return <TrafficCameraPanel
      key={camera.id}
      selection={camera}
      sheet={sheets.trafficCamera}
      onClose={onClose.trafficCamera}
      onShare={() => onShare(camera, 12)}
      onDirections={onDirections}
    />;
  }

  return null;
}
