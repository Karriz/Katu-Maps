import { Map } from 'maplibre-gl';
import type { MapDeepLink } from '../lib/DeepLink';
import { loadPersistedMapView, savePersistedMapView } from './PersistedMapView';
import { globalMapStyleForBuildingMode } from './GlobalMapStyle';

const DEFAULT_CENTER: [number, number] = [23.7609, 61.4981];
const PROVIDER_ATTRIBUTION = [
  '<a href="https://digitransit.fi/" target="_blank" rel="noreferrer">Finnish transit data by Digitransit</a>',
  '<a href="https://www.digitraffic.fi/en/road-traffic/" target="_blank" rel="noreferrer">Road weather, traffic and cameras by Fintraffic / Digitraffic</a>',
  '<a href="https://openchargemap.org/" target="_blank" rel="noreferrer">Charging locations by Open Charge Map</a>',
  '<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather by Open-Meteo</a>',
  '<a href="https://clouds.matteason.co.uk/" target="_blank" rel="noreferrer">Cloud maps by Matt Eason / EUMETSAT</a>',
  '<a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transit data by Transitous</a>',
].join(' · ');

export function createRuntimeMap(
  container: HTMLElement,
  deepLink: MapDeepLink | null,
  buildingMode: { buildings: boolean; buildingColors: boolean },
) {
  const savedView = deepLink ? null : loadPersistedMapView();
  return new Map({
    container,
    style: globalMapStyleForBuildingMode(buildingMode),
    center: deepLink?.coordinates ?? savedView?.center ?? DEFAULT_CENTER,
    zoom: deepLink?.zoom ?? savedView?.zoom ?? 2.2,
    pitch: savedView?.pitch ?? 0,
    bearing: savedView?.bearing ?? 0,
    maxPitch: 55,
    maxZoom: 18,
    attributionControl: {
      compact: true,
      customAttribution: PROVIDER_ATTRIBUTION,
    },
  });
}

export function persistRuntimeCamera(map: Map) {
  const center = map.getCenter();
  savePersistedMapView({
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  });
}
