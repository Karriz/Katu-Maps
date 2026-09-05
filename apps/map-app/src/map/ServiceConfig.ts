const DEFAULT_CLIENT_ID = 'katu-maps';

function configuredEndpoint(value: string | undefined, fallback: string) {
  const candidate = value?.trim() || fallback;
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
    return url.href.replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

export function configuredInterval(value: string | undefined, fallback: number, minimum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.round(parsed)) : fallback;
}

/** Public browser configuration. Never put secret credentials in Vite variables. */
export const serviceConfig = Object.freeze({
  clientId: import.meta.env.VITE_API_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID,
  photonEndpoint: configuredEndpoint(import.meta.env.VITE_PHOTON_ENDPOINT, 'https://photon.komoot.io/api'),
  nominatimEndpoint: configuredEndpoint(import.meta.env.VITE_NOMINATIM_ENDPOINT, 'https://nominatim.openstreetmap.org'),
  valhallaEndpoint: configuredEndpoint(import.meta.env.VITE_VALHALLA_ENDPOINT, 'https://valhalla1.openstreetmap.de/route'),
  osrmEndpoint: configuredEndpoint(import.meta.env.VITE_OSRM_ENDPOINT, ''),
  transitousApiRoot: configuredEndpoint(import.meta.env.VITE_TRANSITOUS_API_ROOT, 'https://api.transitous.org/api/v6'),
  transitousRoutesEndpoint: configuredEndpoint(import.meta.env.VITE_TRANSITOUS_ROUTES_ENDPOINT, 'https://api.transitous.org/api/experimental/map/routes'),
  digitransitEndpoint: configuredEndpoint(import.meta.env.VITE_DIGITRANSIT_ENDPOINT, 'https://api.digitransit.fi/routing/v2/finland/gtfs/v1'),
  digitrafficRoadEndpoint: configuredEndpoint(import.meta.env.VITE_DIGITRAFFIC_ROAD_ENDPOINT, 'https://tie.digitraffic.fi'),
  digitrafficWeathercamEndpoint: configuredEndpoint(import.meta.env.VITE_DIGITRAFFIC_WEATHERCAM_ENDPOINT, 'https://weathercam.digitraffic.fi'),
  overpassEndpoint: configuredEndpoint(import.meta.env.VITE_OVERPASS_ENDPOINT, 'https://overpass-api.de/api/interpreter'),
  openChargeMapEndpoint: configuredEndpoint(import.meta.env.VITE_OPENCHARGEMAP_ENDPOINT, 'https://api.openchargemap.io/v3'),
  openChargeMapApiKey: import.meta.env.VITE_OPENCHARGEMAP_API_KEY?.trim() || '',
  openMeteoEndpoint: configuredEndpoint(import.meta.env.VITE_OPENMETEO_ENDPOINT, 'https://api.open-meteo.com'),
  transitTripRefreshMs: configuredInterval(import.meta.env.VITE_TRANSIT_TRIP_REFRESH_MS, 15_000, 15_000),
});
