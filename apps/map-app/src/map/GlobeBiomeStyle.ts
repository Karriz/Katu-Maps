import type { ExpressionSpecification } from 'maplibre-gl';

// Broad ecological regions provide an illustrated globe and a subdued local base.
const BIOME_COLORS: ExpressionSpecification = [
  'match', ['get', 'biome'],
  'Deserts & Xeric Shrublands', '#d0c3a5',
  'Tropical & Subtropical Moist Broadleaf Forests', '#8aaf86',
  'Tropical & Subtropical Dry Broadleaf Forests', '#aeb989',
  'Tropical & Subtropical Coniferous Forests', '#9cb58c',
  'Temperate Broadleaf & Mixed Forests', '#a5be91',
  'Temperate Conifer Forests', '#9ab797',
  'Boreal Forests/Taiga', '#9bb59a',
  'Tropical & Subtropical Grasslands, Savannas & Shrublands', '#c4c395',
  'Temperate Grasslands, Savannas & Shrublands', '#c0c99e',
  'Flooded Grasslands & Savannas', '#a6c3a9',
  'Montane Grasslands & Shrublands', '#c3c2aa',
  // Vegetated arctic coasts (Norway / Siberia / Canada). Ice interiors use Ice Sheets.
  'Tundra', '#b5c3b0',
  'Ice Sheets', '#d8dde0',
  'Mediterranean Forests, Woodlands & Scrub', '#bebe95',
  'Mangroves', '#91b4a0',
  '#adc796',
];

export function globeBiomeColor(tint?: string, amount = 0): ExpressionSpecification {
  if (!tint || amount <= 0) return BIOME_COLORS;
  return ['interpolate', ['linear'], Math.min(1, amount), 0, BIOME_COLORS, 1, tint];
}
