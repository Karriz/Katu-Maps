export type MapDeepLink = {
  type: 'position' | 'poi' | 'stop';
  coordinates: [number, number];
  zoom: number;
  id?: string;
  provider?: string;
  name?: string;
};

const DEFAULT_ZOOM = 16;

export function parseMapDeepLink(search: string): MapDeepLink | null {
  const params = new URLSearchParams(search);
  if (params.get('v') !== '1') return null;
  const type = params.get('type');
  if (type !== 'position' && type !== 'poi' && type !== 'stop') return null;
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lon'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const rawZoom = Number(params.get('z'));
  const zoom = Number.isFinite(rawZoom) ? Math.min(18, Math.max(2, rawZoom)) : DEFAULT_ZOOM;
  const id = params.get('id')?.trim() || undefined;
  const provider = params.get('provider')?.trim() || undefined;
  return {
    type,
    coordinates: [longitude, latitude],
    zoom,
    id,
    provider,
    name: params.get('name')?.trim().slice(0, 80) || undefined,
  };
}

export function createMapDeepLink(baseUrl: string, link: MapDeepLink) {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('v', '1');
  url.searchParams.set('type', link.type);
  url.searchParams.set('lat', String(Number(link.coordinates[1].toFixed(6))));
  url.searchParams.set('lon', String(Number(link.coordinates[0].toFixed(6))));
  url.searchParams.set('z', String(Number(link.zoom.toFixed(1))));
  if (link.provider) url.searchParams.set('provider', link.provider);
  if (link.id) url.searchParams.set('id', link.id);
  if (link.name) url.searchParams.set('name', link.name.slice(0, 80));
  return url.toString();
}

export async function shareMapDeepLink(url: string, title: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared' as const;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'cancelled' as const;
      // A native share implementation can reject unsupported payloads. In
      // that case the clipboard remains a useful fallback.
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied' as const;
}
