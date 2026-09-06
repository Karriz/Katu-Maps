import type { ExpressionSpecification } from 'maplibre-gl';

// Broad ecological regions provide an illustrated globe and a subdued local base.
const BIOME_COLORS: ExpressionSpecification = [
  'match', ['get', 'biome'],
  'Deserts & Xeric Shrublands', '#e8ce96',
  'Tropical & Subtropical Moist Broadleaf Forests', '#8fb58a',
  'Tropical & Subtropical Dry Broadleaf Forests', '#b3c18a',
  'Tropical & Subtropical Coniferous Forests', '#a1ba8d',
  'Temperate Broadleaf & Mixed Forests', '#aec795',
  'Temperate Conifer Forests', '#9dbb99',
  'Boreal Forests/Taiga', '#8eb57d',
  'Tropical & Subtropical Grasslands, Savannas & Shrublands', '#cfce96',
  'Temperate Grasslands, Savannas & Shrublands', '#cbd4a2',
  'Flooded Grasslands & Savannas', '#abc9ae',
  'Montane Grasslands & Shrublands', '#c9c8ae',
  'Tundra', '#d5ddc9',
  'Mediterranean Forests, Woodlands & Scrub', '#c5c59a',
  'Mangroves', '#95b9a4',
  '#b8d19f',
];

export function globeBiomeColor(tint?: string, amount = 0): ExpressionSpecification {
  if (!tint || amount <= 0) return BIOME_COLORS;
  return ['interpolate', ['linear'], Math.min(1, amount), 0, BIOME_COLORS, 1, tint];
}
