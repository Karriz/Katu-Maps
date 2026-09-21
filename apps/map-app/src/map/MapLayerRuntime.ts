import { BridgeModelLayer } from './BridgeModelLayer';
import { ChargingStationsLayer } from './ChargingStationsLayer';
import { FacadeModelLayer } from './FacadeModelLayer';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';
import { RoadTrafficLayer } from './RoadTrafficLayer';
import { RoadWeatherLayer } from './RoadWeatherLayer';
import { RoofModelLayer } from './RoofModelLayer';
import { RouteLineDeckLayer } from './RouteLineDeckLayer';
import { TrafficCamerasLayer } from './TrafficCamerasLayer';
import { TransitRouteOverlay } from './TransitRouteOverlay';
import { TransitStopsLayer, type TransitVehiclePose } from './TransitStopsLayer';
import { TransitVehicleModelLayer } from './TransitVehicleModelLayer';
import { TreeModelLayer } from './TreeModelLayer';
import { LiveVehiclesLayer, type LiveVehicle } from './LiveVehicles';
import { LiveVehicleModelLayer } from './LiveVehicleModelLayer';

type RefSlot<T> = { current: T | null };

export type MapLayerRuntimeRefs = {
  tree: RefSlot<TreeModelLayer>;
  bridge: RefSlot<BridgeModelLayer>;
  roof: RefSlot<RoofModelLayer>;
  facade: RefSlot<FacadeModelLayer>;
  transitStops: RefSlot<TransitStopsLayer>;
  trafficCameras: RefSlot<TrafficCamerasLayer>;
  roadWeather: RefSlot<RoadWeatherLayer>;
  roadTraffic: RefSlot<RoadTrafficLayer>;
  chargingStations: RefSlot<ChargingStationsLayer>;
  transitVehicle: RefSlot<TransitVehicleModelLayer>;
  transitRouteOverlay: RefSlot<TransitRouteOverlay>;
  selectedRouteDeck: RefSlot<RouteLineDeckLayer>;
  transitStopRouteDeck: RefSlot<RouteLineDeckLayer>;
  liveVehicles: RefSlot<LiveVehiclesLayer>;
  liveVehicleModels: RefSlot<LiveVehicleModelLayer>;
};

export type MapLayerRuntime = ReturnType<typeof createMapLayerRuntime>;

export function createMapLayerRuntime(
  onVehiclePose: (pose: TransitVehiclePose | null) => void,
  onLiveVehicleSelect: (vehicle: LiveVehicle) => void = () => undefined,
  onLiveVehiclePosition: (vehicle: LiveVehicle) => void = () => undefined,
) {
  const tree = new TreeModelLayer({
    sourceId: OPENFREEMAP_SOURCE_ID,
    waterLayers: ['water'],
    vegetationLayers: ['landcover', 'landuse', 'park'],
    biomeLayer: 'global-globe-biomes',
  });
  const bridge = new BridgeModelLayer();
  const roof = new RoofModelLayer();
  const facade = new FacadeModelLayer();
  const transitVehicle = new TransitVehicleModelLayer();
  transitVehicle.setBridgeDeckSource(bridge);
  const transitStops = new TransitStopsLayer((pose) => {
    transitVehicle.setPose(pose);
    onVehiclePose(pose);
  });
  const trafficCameras = new TrafficCamerasLayer();
  const roadWeather = new RoadWeatherLayer();
  const roadTraffic = new RoadTrafficLayer();
  const chargingStations = new ChargingStationsLayer();
  const transitRouteOverlay = new TransitRouteOverlay();
  const selectedRouteDeck = new RouteLineDeckLayer('selected-route-deck-3d');
  const transitStopRouteDeck = new RouteLineDeckLayer('transit-selected-route-deck-3d');
  const liveVehicleRouteDeck = new RouteLineDeckLayer('live-vehicle-selected-route-deck-3d');
  const liveVehicles = new LiveVehiclesLayer(onLiveVehicleSelect, onLiveVehiclePosition);
  const liveVehicleModels = new LiveVehicleModelLayer();
  liveVehicleModels.setBridgeDeckSource(bridge);
  liveVehicles.setModelLayer(liveVehicleModels);
  liveVehicles.setRouteDeckLayer(liveVehicleRouteDeck);
  selectedRouteDeck.setBridgeDeckSource(bridge);
  transitStopRouteDeck.setBridgeDeckSource(bridge);
  liveVehicleRouteDeck.setBridgeDeckSource(bridge);
  transitStops.onSelectedRoutes((features) => {
    transitStopRouteDeck.setFeatures(features.map((feature) => ({
      coordinates: feature.geometry.coordinates as Array<[number, number]>,
      color: feature.properties.color,
      widthPixels: 4.5,
      casingWidthPixels: 8,
    })));
  });

  return {
    tree,
    bridge,
    roof,
    facade,
    transitVehicle,
    transitStops,
    trafficCameras,
    roadWeather,
    roadTraffic,
    chargingStations,
    transitRouteOverlay,
    selectedRouteDeck,
    transitStopRouteDeck,
    liveVehicleRouteDeck,
    liveVehicles,
    liveVehicleModels,
  };
}

export function assignMapLayerRuntimeRefs(runtime: MapLayerRuntime, refs: MapLayerRuntimeRefs) {
  (Object.keys(refs) as Array<keyof MapLayerRuntimeRefs>).forEach((key) => {
    refs[key].current = runtime[key] as never;
  });
}

export function disposeMapLayerRuntime(runtime: MapLayerRuntime) {
  runtime.transitStops.dispose();
  runtime.liveVehicles.dispose();
  runtime.transitRouteOverlay.dispose();
  runtime.trafficCameras.dispose();
  runtime.chargingStations.dispose();
  runtime.roadWeather.dispose();
  runtime.roadTraffic.dispose();
  runtime.transitVehicle.setBridgeDeckSource(null);
  runtime.selectedRouteDeck.setBridgeDeckSource(null);
  runtime.transitStopRouteDeck.setBridgeDeckSource(null);
  runtime.liveVehicleRouteDeck.setBridgeDeckSource(null);
}

export function releaseMapLayerRuntimeRefs(runtime: MapLayerRuntime, refs: MapLayerRuntimeRefs) {
  (Object.keys(refs) as Array<keyof MapLayerRuntimeRefs>).forEach((key) => {
    if (refs[key].current === runtime[key]) refs[key].current = null;
  });
}
