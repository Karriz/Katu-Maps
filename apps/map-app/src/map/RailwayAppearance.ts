import type { ExpressionSpecification } from 'maplibre-gl';

export const RAIL_BED_DAY = '#d5dad6';
export const RAIL_BED_NIGHT = '#203447';
export const RAIL_SLEEPER_DAY = '#b4bdb7';
export const RAIL_SLEEPER_NIGHT = '#43596b';
export const RAIL_GAUGE = 1.5;
export const RAIL_WIDTH = 0.18;
export const RAIL_BED_WIDTH = 5.5;
export const SLEEPER_WIDTH = 2.4;
export const SLEEPER_THICKNESS = 0.24;
export const SLEEPER_SPACING = 2.8;

// Same local latitude convention as the map's metre-scaled path styling.
export function railwayWidth(metres: number, gap = false): ExpressionSpecification {
  const pixels = (zoom: number) => metres * 512 * 2 ** zoom / (40_075_016.686 * Math.cos(61.5 * Math.PI / 180));
  return ['interpolate', ['exponential', 2], ['zoom'],
    8, gap ? 0 : metres === RAIL_WIDTH ? 0.5 : 0.7,
    14, gap ? 0 : metres === RAIL_WIDTH ? 0.5 : pixels(14), 16, pixels(16), 18, pixels(18), 22, pixels(22)];
}
