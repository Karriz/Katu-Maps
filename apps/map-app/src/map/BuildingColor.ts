import type { ColorSpecification, ExpressionSpecification } from 'maplibre-gl';

/**
 * Hue anchors used only for buildings which do not have an OSM colour.
 * Blending them strongly toward the active theme keeps the variation quiet,
 * while using the feature id makes it reproducible across renders and tiles.
 */
const BUILDING_HUES = [
  '#b87964',
  '#c39465',
  '#aaa06d',
  '#78977c',
  '#719595',
  '#7892ae',
  '#9487a7',
  '#a98591',
] as const;

const OSM_COLOR_MIX = 0.72;
const GENERATED_COLOR_MIX = 0.86;

function mixTowardTheme(
  color: ColorSpecification | ExpressionSpecification,
  themeColor: ColorSpecification,
  amount: number,
): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    amount,
    0,
    color,
    1,
    themeColor,
  ] as ExpressionSpecification;
}

/**
 * Returns a data-driven building colour for the OpenMapTiles building schema.
 *
 * OpenMapTiles exposes the OSM `building:colour` value as `colour` (and also
 * derives it from common building materials). Valid values are softened
 * toward the current theme. Buildings without that property choose a muted
 * hue from their numeric OSM feature id, so their colour is varied but stable.
 * `to-color`'s fallback also makes malformed OSM values harmless.
 */
export function buildingColorExpression(themeColor: ColorSpecification): ExpressionSpecification {
  const osmColor = ['to-color', ['get', 'colour'], themeColor] as ExpressionSpecification;
  const generated: unknown[] = [
    'match',
    ['%', ['abs', ['to-number', ['id'], 0]], BUILDING_HUES.length],
  ];

  BUILDING_HUES.forEach((hue, index) => {
    generated.push(index, mixTowardTheme(hue, themeColor, GENERATED_COLOR_MIX));
  });
  generated.push(themeColor);

  return [
    'case',
    ['has', 'colour'],
    mixTowardTheme(osmColor, themeColor, OSM_COLOR_MIX),
    generated,
  ] as ExpressionSpecification;
}
