import type { Map as MaplibreMap } from 'maplibre-gl';

export type TreeBiomeProfile = {
  coniferChance: number;
  palmChance: number;
  shrubChance: number;
  heightScale: number;
  crownWidthScale: number;
  crownHeightScale: number;
  foliageHue: number;
  foliageSaturation: number;
  foliageLightness: number;
};

const TEMPERATE_PROFILE: TreeBiomeProfile = {
  coniferChance: 0.38,
  palmChance: 0,
  shrubChance: 0.04,
  heightScale: 1,
  crownWidthScale: 1,
  crownHeightScale: 1,
  foliageHue: 0.31,
  foliageSaturation: 0.53,
  foliageLightness: 0.36,
};

const BIOME_PROFILES: Record<string, Partial<TreeBiomeProfile>> = {
  'Boreal Forests/Taiga': {
    coniferChance: 0.9, heightScale: 1.12, crownWidthScale: 0.82,
    crownHeightScale: 1.16, foliageHue: 0.36, foliageSaturation: 0.42, foliageLightness: 0.29,
  },
  'Temperate Conifer Forests': {
    coniferChance: 0.82, heightScale: 1.18, crownWidthScale: 0.86,
    crownHeightScale: 1.12, foliageHue: 0.34, foliageSaturation: 0.48, foliageLightness: 0.29,
  },
  'Tropical & Subtropical Coniferous Forests': {
    coniferChance: 0.8, heightScale: 1.12, crownWidthScale: 0.9,
    crownHeightScale: 1.1, foliageHue: 0.31, foliageSaturation: 0.57, foliageLightness: 0.31,
  },
  'Tropical & Subtropical Moist Broadleaf Forests': {
    coniferChance: 0.03, palmChance: 0.18, heightScale: 1.28, crownWidthScale: 1.18,
    crownHeightScale: 1.08, foliageHue: 0.34, foliageSaturation: 0.62, foliageLightness: 0.3,
  },
  'Tropical & Subtropical Dry Broadleaf Forests': {
    coniferChance: 0.06, palmChance: 0.1, heightScale: 0.9, crownWidthScale: 1.14,
    crownHeightScale: 0.86, foliageHue: 0.25, foliageSaturation: 0.48, foliageLightness: 0.38,
  },
  'Tropical & Subtropical Grasslands, Savannas & Shrublands': {
    coniferChance: 0.02, palmChance: 0.04, shrubChance: 0.18, heightScale: 0.76,
    crownWidthScale: 1.42, crownHeightScale: 0.72, foliageHue: 0.24,
    foliageSaturation: 0.5, foliageLightness: 0.37,
  },
  'Mediterranean Forests, Woodlands & Scrub': {
    coniferChance: 0.24, shrubChance: 0.2, heightScale: 0.76,
    crownWidthScale: 1.2, crownHeightScale: 0.78, foliageHue: 0.27,
    foliageSaturation: 0.38, foliageLightness: 0.39,
  },
  Mangroves: {
    coniferChance: 0, palmChance: 0.16, heightScale: 0.74, crownWidthScale: 1.3,
    crownHeightScale: 0.74, foliageHue: 0.38, foliageSaturation: 0.55, foliageLightness: 0.3,
  },
  Tundra: {
    coniferChance: 0.08, shrubChance: 0.72, heightScale: 0.42,
    crownWidthScale: 1.15, crownHeightScale: 0.68, foliageHue: 0.25,
    foliageSaturation: 0.3, foliageLightness: 0.42,
  },
  'Deserts & Xeric Shrublands': {
    coniferChance: 0.01, shrubChance: 0.74, heightScale: 0.5,
    crownWidthScale: 1.08, crownHeightScale: 0.7, foliageHue: 0.2,
    foliageSaturation: 0.34, foliageLightness: 0.43,
  },
};

export function treeBiomeProfile(biome?: string): TreeBiomeProfile {
  return { ...TEMPERATE_PROFILE, ...(biome ? BIOME_PROFILES[biome] : undefined) };
}

export function visibleBiome(
  map: Pick<MaplibreMap, 'getCenter' | 'project' | 'getLayer' | 'queryRenderedFeatures'>,
  layerId?: string,
) {
  if (!layerId || !map.getLayer(layerId)) return undefined;
  try {
    const feature = map.queryRenderedFeatures(map.project(map.getCenter()), { layers: [layerId] })[0];
    const properties = feature?.properties as { biome?: unknown } | undefined;
    return typeof properties?.biome === 'string' ? properties.biome : undefined;
  } catch (error) {
    console.warn(`Could not query optional biome layer ${layerId}`, error);
    return undefined;
  }
}
