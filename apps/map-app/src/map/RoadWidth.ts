import type { ExpressionSpecification } from 'maplibre-gl';

export const ROAD_CASING_METRES = 1;
/** Keep leftover vector strokes slightly inside metre-accurate polygons. */
export const ROAD_LINE_UNDER_POLYGON_SCALE = 0.88;
export const ROAD_WIDTH_MODEL_REVISION = 3;
/** Dashed markings only where a carriageway is wide enough to hold them. */
export const ROAD_CENTERLINE_MIN_WIDTH_METRES = 8;
export const ROAD_CENTERLINE_WIDTH_METRES = 0.2;
const UNPAVED_ROAD_SURFACES = new Set(['unpaved', 'gravel', 'dirt', 'ground', 'sand']);

export const ROAD_POLYGON_CLASSES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor',
] as const;

export type RoadPolygonClass = (typeof ROAD_POLYGON_CLASSES)[number];

export const ROAD_WIDTH_METRES_BY_CLASS = {
  // Divided highways are normally encoded as one centerline per
  // carriageway, so using the full combined-road width overstates them at
  // close zooms. Allow roughly two lanes plus shoulders per line instead.
  motorway: 10.5,
  trunk: 9.5,
  primary: 9,
  secondary: 8,
  tertiary: 7,
  minor: 5.5,
} as const;

export const RAMP_WIDTH_METRES_BY_CLASS = {
  motorway: 7.5,
  trunk: 7,
  primary: 6.5,
  secondary: 6,
  tertiary: 5.5,
} as const;

export const SERVICE_WIDTH_METRES_BY_SERVICE = {
  parking_aisle: 3,
  driveway: 3.2,
  alley: 3.2,
  crossover: 3.5,
} as const;

export type RoadWidthProperties = {
  className: string;
  ramp?: boolean;
  service?: string;
  surface?: string;
};

export function estimatedRoadWidthMetres(properties: RoadWidthProperties) {
  const { className, ramp, service } = properties;
  if (ramp) {
    return RAMP_WIDTH_METRES_BY_CLASS[className as keyof typeof RAMP_WIDTH_METRES_BY_CLASS] ?? 5;
  }
  if (className === 'service') {
    return SERVICE_WIDTH_METRES_BY_SERVICE[service as keyof typeof SERVICE_WIDTH_METRES_BY_SERVICE] ?? 4;
  }
  return ROAD_WIDTH_METRES_BY_CLASS[className as keyof typeof ROAD_WIDTH_METRES_BY_CLASS] ?? 5;
}

export function estimatedRoadCasingWidthMetres(properties: RoadWidthProperties) {
  return estimatedRoadWidthMetres(properties) + ROAD_CASING_METRES;
}

export function isRoadPolygonClass(className: string): className is RoadPolygonClass {
  return (ROAD_POLYGON_CLASSES as readonly string[]).includes(className);
}

export function shouldDrawRoadCenterline(properties: RoadWidthProperties) {
  if (properties.ramp) return false;
  const surface = properties.surface?.toLowerCase();
  if (surface && UNPAVED_ROAD_SURFACES.has(surface)) return false;
  return estimatedRoadWidthMetres(properties) >= ROAD_CENTERLINE_MIN_WIDTH_METRES;
}

function matchTable(
  getter: ExpressionSpecification,
  table: Record<string, number>,
  fallback: number,
): ExpressionSpecification {
  return ['match', getter, ...Object.entries(table).flat(), fallback] as ExpressionSpecification;
}

/** MapLibre expression matching `estimatedRoadWidthMetres`. */
export function estimatedRoadWidthExpression(): ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'ramp'], 1],
    matchTable(['get', 'class'], RAMP_WIDTH_METRES_BY_CLASS, 5),
    ['==', ['get', 'class'], 'service'],
    matchTable(['get', 'service'], SERVICE_WIDTH_METRES_BY_SERVICE, 4),
    matchTable(['get', 'class'], ROAD_WIDTH_METRES_BY_CLASS, 5),
  ] as ExpressionSpecification;
}
