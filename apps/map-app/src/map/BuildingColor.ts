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

// A warm neutral removes saturation independently of the active map theme.
// Mixing only toward the theme (especially a white one) merely tints vivid
// colors: red becomes pink, while black becomes almost white. This first pass
// instead gives saturated colors an earthy, material-like appearance and
// lifts very dark colors into visible grays.
const OSM_PASTEL_NEUTRAL = '#a89e94';
const OSM_NEUTRAL_MIX = 0.55;
const OSM_THEME_MIX = 0.2;
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
  const pastelOsmColor = mixTowardTheme(
    mixTowardTheme(osmColor, OSM_PASTEL_NEUTRAL, OSM_NEUTRAL_MIX),
    themeColor,
    OSM_THEME_MIX,
  );
  const generated = [
    'match',
    ['%', ['abs', ['to-number', ['id'], 0]], BUILDING_HUES.length],
    ...BUILDING_HUES.flatMap((hue, index) => [
      index,
      mixTowardTheme(hue, themeColor, GENERATED_COLOR_MIX),
    ]),
    themeColor,
  ] as unknown as ExpressionSpecification;

  return [
    'case',
    ['has', 'colour'],
    pastelOsmColor,
    generated,
  ] as unknown as ExpressionSpecification;
}
