/** 3D terrain mesh is rebuilt on zoom. At globe and continental cameras that
 * covers most of the world, which is why wheel-zoom stutters while panning
 * the same view stays smooth. Hillshade remains as the low-zoom relief. */
export const TERRAIN_3D_ENABLE_ZOOM = 7.25;
export const TERRAIN_3D_DISABLE_ZOOM = 6.5;

export type TerrainController = {
  getZoom: () => number;
  getTerrain: () => { source?: string } | null | undefined;
  setTerrain: (terrain: { source: string; exaggeration: number } | null) => unknown;
};

export function shouldEnableTerrain3d(
  userEnabled: boolean,
  zoom: number,
  currentlyEnabled: boolean,
): boolean {
  if (!userEnabled) return false;
  return currentlyEnabled ? zoom >= TERRAIN_3D_DISABLE_ZOOM : zoom >= TERRAIN_3D_ENABLE_ZOOM;
}

export function syncTerrain3d(
  map: TerrainController,
  options: { userEnabled: boolean; source: string },
): boolean {
  const currentlyEnabled = Boolean(map.getTerrain());
  const enable = shouldEnableTerrain3d(options.userEnabled, map.getZoom(), currentlyEnabled);
  if (enable) {
    const current = map.getTerrain();
    if (!current || current.source !== options.source) {
      map.setTerrain({ source: options.source, exaggeration: 1 });
    }
  } else if (currentlyEnabled) {
    map.setTerrain(null);
  }
  return enable;
}
