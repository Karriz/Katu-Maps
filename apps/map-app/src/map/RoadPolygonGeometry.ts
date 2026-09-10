import {
  estimatedRoadCasingWidthMetres,
  estimatedRoadWidthMetres,
  isRoadPolygonClass,
  shouldDrawRoadCenterline,
  type RoadWidthProperties,
} from './RoadWidth';

const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;
export const ROAD_CELL_METRES = 256;
export const ROAD_CELL_PADDING_METRES = 36;
export const ROAD_POLYGON_SEAM_METRES = 0.6;
export const ROAD_DENSIFY_METRES = 12;
export const ROAD_SIMPLIFY_METRES = 0.85;
/** Sample curved carriageways often enough that roundabouts stay circular. */
export const ROAD_CURVE_STEP_RADIANS = Math.PI / 12;
const MIN_CURVE_RADIUS_METRES = 8;
const MAX_CURVE_RADIUS_METRES = 80;
const CLOSED_LOOP_GAP_METRES = 1.6;
const ROUND_JOIN_STEP_RADIANS = Math.PI / 10;
const MITER_LIMIT = 2.8;
const STITCH_METRES = 2.4;
const MIN_POLYGON_AREA_METRES = 2;
const MIN_CENTERLINE_LENGTH_METRES = 4;
const MAX_FEATURES_PER_CELL = 280;
const MAX_VERTICES_PER_CELL = 12_000;

export type PlanPoint = { east: number; north: number };
export type PlanOrigin = { longitude: number; latitude: number; cosLat: number };
export type PlanRect = { minEast: number; minNorth: number; maxEast: number; maxNorth: number };

export type RoadCenterline = {
  coordinates: Array<[number, number]>;
  properties: RoadWidthProperties & {
    className: string;
    layer: number;
    surface?: string;
  };
};

export type RoadWorkCell = {
  key: string;
  ix: number;
  iy: number;
  west: number;
  south: number;
  east: number;
  north: number;
};

export type RoadPolygonFeature = {
  type: 'Feature';
  properties: {
    kind: 'surface' | 'casing';
    class: string;
    layer: number;
    surface?: string;
    ramp: number;
  };
  geometry: {
    type: 'Polygon';
    coordinates: Array<Array<[number, number]>>;
  };
};

export type RoadCenterlineFeature = {
  type: 'Feature';
  properties: {
    kind: 'centerline';
    class: string;
    layer: number;
  };
  geometry: {
    type: 'LineString';
    coordinates: Array<[number, number]>;
  };
};

export type RoadCellGeometry = {
  cellKey: string;
  polygons: RoadPolygonFeature[];
  centerlines: RoadCenterlineFeature[];
  vertexCount: number;
  skipped: boolean;
};

export function planOriginFromLngLat(longitude: number, latitude: number): PlanOrigin {
  return {
    longitude,
    latitude,
    cosLat: Math.max(0.01, Math.cos(latitude * DEGREES_TO_RADIANS)),
  };
}

export function lngLatsToPlan(coordinates: Array<[number, number]>, origin: PlanOrigin): PlanPoint[] {
  const eastScale = origin.cosLat * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS;
  const northScale = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS;
  return coordinates.map(([longitude, latitude]) => ({
    east: (longitude - origin.longitude) * eastScale,
    north: (latitude - origin.latitude) * northScale,
  }));
}

export function planToLngLat(point: PlanPoint, origin: PlanOrigin): [number, number] {
  return [
    origin.longitude + point.east / (origin.cosLat * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS),
    origin.latitude + point.north / (EARTH_RADIUS_METERS * DEGREES_TO_RADIANS),
  ];
}

export function metresPerDegree(latitude: number) {
  return {
    latitude: EARTH_RADIUS_METERS * DEGREES_TO_RADIANS,
    longitude: EARTH_RADIUS_METERS * DEGREES_TO_RADIANS * Math.max(0.01, Math.cos(latitude * DEGREES_TO_RADIANS)),
  };
}

export function roadWorkCell(ix: number, iy: number): RoadWorkCell {
  const south = (iy * ROAD_CELL_METRES) / (EARTH_RADIUS_METERS * DEGREES_TO_RADIANS);
  const north = ((iy + 1) * ROAD_CELL_METRES) / (EARTH_RADIUS_METERS * DEGREES_TO_RADIANS);
  const cosLat = Math.max(0.01, Math.cos(south * DEGREES_TO_RADIANS));
  const longitudeScale = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS * cosLat;
  const west = (ix * ROAD_CELL_METRES) / longitudeScale;
  const east = ((ix + 1) * ROAD_CELL_METRES) / longitudeScale;
  return { key: `${ix}:${iy}`, ix, iy, west, south, east, north };
}

export function roadWorkCellAt(longitude: number, latitude: number) {
  const iy = Math.floor(latitude * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS / ROAD_CELL_METRES);
  const south = (iy * ROAD_CELL_METRES) / (EARTH_RADIUS_METERS * DEGREES_TO_RADIANS);
  const cosLat = Math.max(0.01, Math.cos(south * DEGREES_TO_RADIANS));
  const ix = Math.floor(longitude * EARTH_RADIUS_METERS * DEGREES_TO_RADIANS * cosLat / ROAD_CELL_METRES);
  return roadWorkCell(ix, iy);
}

export function cellsAround(
  longitude: number,
  latitude: number,
  rangeMetres: number,
  maxCells: number,
): RoadWorkCell[] {
  const origin = roadWorkCellAt(longitude, latitude);
  const radius = Math.max(0, Math.ceil(rangeMetres / ROAD_CELL_METRES));
  const cells: Array<{ cell: RoadWorkCell; distance: number }> = [];
  for (let iy = origin.iy - radius; iy <= origin.iy + radius; iy += 1) {
    for (let ix = origin.ix - radius; ix <= origin.ix + radius; ix += 1) {
      const cell = roadWorkCell(ix, iy);
      const midLng = (cell.west + cell.east) / 2;
      const midLat = (cell.south + cell.north) / 2;
      const scale = metresPerDegree(latitude);
      const distance = Math.hypot(
        (midLng - longitude) * scale.longitude,
        (midLat - latitude) * scale.latitude,
      );
      if (distance > rangeMetres + ROAD_CELL_METRES) continue;
      cells.push({ cell, distance });
    }
  }
  return cells
    .sort((left, right) => left.distance - right.distance || left.cell.key.localeCompare(right.cell.key))
    .slice(0, maxCells)
    .map((entry) => entry.cell);
}

export function lineSignature(coordinates: Array<[number, number]>) {
  return coordinates.map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).join(';');
}

export function collectRoadCenterlines(
  features: Array<{ geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> | null }>,
  range?: { longitude: number; latitude: number; metres: number },
): RoadCenterline[] {
  const unique = new Map<string, RoadCenterline>();
  const origin = range ? planOriginFromLngLat(range.longitude, range.latitude) : undefined;
  const rect = range ? {
    minEast: -range.metres,
    maxEast: range.metres,
    minNorth: -range.metres,
    maxNorth: range.metres,
  } : undefined;
  for (const feature of features) {
    const properties = propertiesFromFeature(feature.properties);
    if (!isRoadPolygonClass(properties.className)) continue;
    if (properties.brunnel === 'bridge' || properties.brunnel === 'tunnel') continue;
    for (const coordinates of linePartsFromGeometry(feature.geometry)) {
      if (coordinates.length < 2) continue;
      if (origin && rect && !lineIntersectsRect(coordinates, origin, rect)) continue;
      const identity = `${properties.className}:${properties.layer}:${properties.ramp ? 1 : 0}:${properties.service ?? ''}:${properties.surface ?? ''}`;
      const forward = identity + lineSignature(coordinates);
      const reverse = identity + lineSignature(coordinates.slice().reverse());
      if (unique.has(forward) || unique.has(reverse)) continue;
      unique.set(forward, { coordinates, properties });
    }
  }
  return [...unique.values()];
}

function propertiesFromFeature(properties: Record<string, unknown> | null | undefined) {
  const layer = Number(properties?.layer);
  const className = String(properties?.class ?? '');
  return {
    className,
    layer: Number.isFinite(layer) ? layer : 0,
    ramp: properties?.ramp === 1 || properties?.ramp === true,
    service: typeof properties?.service === 'string' ? properties.service : undefined,
    surface: typeof properties?.surface === 'string' ? properties.surface : undefined,
    brunnel: typeof properties?.brunnel === 'string' ? properties.brunnel : undefined,
  };
}

export function linePartsFromGeometry(geometry: { type?: string; coordinates?: unknown } | null | undefined) {
  if (!geometry) return [] as Array<Array<[number, number]>>;
  if (geometry.type === 'LineString') {
    const line = parseLngLatLine(geometry.coordinates);
    return line.length >= 2 ? [line] : [];
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((part) => parseLngLatLine(part))
      .filter((line) => line.length >= 2);
  }
  return [];
}

function parseLngLatLine(points: unknown): Array<[number, number]> {
  if (!Array.isArray(points)) return [];
  const coordinates: Array<[number, number]> = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const longitude = Number(point[0]);
    const latitude = Number(point[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    coordinates.push([longitude, latitude]);
  }
  return coordinates;
}

export function stitchRoadCenterlines(lines: RoadCenterline[]) {
  const groups = new Map<string, RoadCenterline[]>();
  for (const line of lines) {
    const key = [
      line.properties.className,
      line.properties.layer,
      line.properties.ramp ? 1 : 0,
      line.properties.service ?? '',
      line.properties.surface ?? '',
    ].join(':');
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }
  const merged: RoadCenterline[] = [];
  for (const group of groups.values()) merged.push(...stitchGroup(group));
  return merged;
}

function stitchGroup(lines: RoadCenterline[]) {
  const remaining = lines.map((line) => ({
    ...line,
    coordinates: line.coordinates.slice(),
  }));
  const result: RoadCenterline[] = [];
  while (remaining.length > 0) {
    const current = remaining.pop()!;
    let extended = true;
    while (extended) {
      extended = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        const joined = joinLines(current.coordinates, candidate.coordinates);
        if (!joined) continue;
        current.coordinates = joined;
        remaining.splice(index, 1);
        extended = true;
      }
    }
    result.push(current);
  }
  return result;
}

function joinLines(left: Array<[number, number]>, right: Array<[number, number]>) {
  const leftStart = left[0];
  const leftEnd = left[left.length - 1];
  const rightStart = right[0];
  const rightEnd = right[right.length - 1];
  if (near(leftEnd, rightStart)) return [...left, ...right.slice(1)];
  if (near(leftEnd, rightEnd)) return [...left, ...right.slice(0, -1).reverse()];
  if (near(leftStart, rightEnd)) return [...right, ...left.slice(1)];
  if (near(leftStart, rightStart)) return [...right.slice().reverse(), ...left.slice(1)];
  return null;
}

function near(left: [number, number], right: [number, number]) {
  const scale = metresPerDegree(left[1]);
  return Math.hypot(
    (left[0] - right[0]) * scale.longitude,
    (left[1] - right[1]) * scale.latitude,
  ) <= STITCH_METRES;
}

export function lineIntersectsRect(coordinates: Array<[number, number]>, origin: PlanOrigin, rect: PlanRect) {
  const plan = lngLatsToPlan(coordinates, origin);
  for (let index = 1; index < plan.length; index += 1) {
    if (segmentIntersectsRect(plan[index - 1], plan[index], rect)) return true;
  }
  return plan.some((point) => pointInRect(point, rect));
}

export function simplifyPlanLine(points: PlanPoint[], tolerance: number) {
  if (points.length <= 2) return points.slice();
  if (isClosedPlanLine(points)) {
    const body = closedRingBody(points);
    const simplified = body.length <= 2 ? body.slice() : douglasPeucker(body, tolerance);
    if (simplified.length < 3) return points.slice();
    return [...simplified, { ...simplified[0] }];
  }
  return douglasPeucker(points, tolerance);
}

function douglasPeucker(points: PlanPoint[], tolerance: number): PlanPoint[] {
  let maxDistance = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointLineDistance(points[index], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
  const right = douglasPeucker(points.slice(maxIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

function pointLineDistance(point: PlanPoint, start: PlanPoint, end: PlanPoint) {
  const dx = end.east - start.east;
  const dy = end.north - start.north;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs((point.east - start.east) * dy - (point.north - start.north) * dx) / length;
}

export function densifyPlanLine(points: PlanPoint[], spacingMetres: number) {
  if (points.length < 2) return points.slice();
  const closed = isClosedPlanLine(points);
  const body = closedRingBody(points);
  const densified: PlanPoint[] = [];
  const segmentCount = closed ? body.length : body.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = body[index];
    const end = body[(index + 1) % body.length];
    if (densified.length === 0) densified.push(start);
    const prev = body[(index - 1 + body.length) % body.length];
    const next = body[(index + 2) % body.length];
    const canCurve = closed || (index > 0 && index < body.length - 2);
    const arc = canCurve ? curveSegment(prev, start, end, next) : null;
    if (arc && arc.length > 2) {
      densified.push(...arc.slice(1));
      continue;
    }
    const length = Math.hypot(end.east - start.east, end.north - start.north);
    const steps = Math.max(1, Math.ceil(length / spacingMetres));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      densified.push({
        east: start.east + (end.east - start.east) * t,
        north: start.north + (end.north - start.north) * t,
      });
    }
  }
  if (closed && densified.length > 0) densified.push({ ...densified[0] });
  return densified;
}

export function isClosedPlanLine(points: PlanPoint[]) {
  if (points.length < 4) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.east - last.east, first.north - last.north) <= CLOSED_LOOP_GAP_METRES;
}

function closedRingBody(points: PlanPoint[]) {
  if (!isClosedPlanLine(points)) return points;
  return points.slice(0, -1);
}

function curveSegment(prev: PlanPoint, start: PlanPoint, end: PlanPoint, next: PlanPoint) {
  const startTurn = turnSign(prev, start, end);
  const endTurn = turnSign(start, end, next);
  if (startTurn === 0 || endTurn === 0 || startTurn !== endTurn) return null;
  const startCircle = circumcircle(prev, start, end);
  const endCircle = circumcircle(start, end, next);
  if (!startCircle || !endCircle) return null;
  if (!similarRadius(startCircle.radius, endCircle.radius)) return null;
  if (startCircle.radius < MIN_CURVE_RADIUS_METRES || startCircle.radius > MAX_CURVE_RADIUS_METRES) return null;
  if (endCircle.radius < MIN_CURVE_RADIUS_METRES || endCircle.radius > MAX_CURVE_RADIUS_METRES) return null;
  return sampleCircleArc(startCircle.center, start, end, startTurn);
}

function similarRadius(left: number, right: number) {
  const larger = Math.max(left, right);
  const smaller = Math.min(left, right);
  return larger <= smaller * 1.45 + 2;
}

function turnSign(a: PlanPoint, b: PlanPoint, c: PlanPoint) {
  const cross = (b.east - a.east) * (c.north - b.north) - (b.north - a.north) * (c.east - b.east);
  if (Math.abs(cross) < 1e-6) return 0;
  return cross > 0 ? 1 : -1;
}

function circumcircle(a: PlanPoint, b: PlanPoint, c: PlanPoint) {
  const d = 2 * (
    a.east * (b.north - c.north)
    + b.east * (c.north - a.north)
    + c.east * (a.north - b.north)
  );
  if (Math.abs(d) < 1e-8) return null;
  const a2 = a.east * a.east + a.north * a.north;
  const b2 = b.east * b.east + b.north * b.north;
  const c2 = c.east * c.east + c.north * c.north;
  const east = (a2 * (b.north - c.north) + b2 * (c.north - a.north) + c2 * (a.north - b.north)) / d;
  const north = (a2 * (c.east - b.east) + b2 * (a.east - c.east) + c2 * (b.east - a.east)) / d;
  const center = { east, north };
  return { center, radius: Math.hypot(a.east - east, a.north - north) };
}

function sampleCircleArc(center: PlanPoint, from: PlanPoint, to: PlanPoint, turn: number) {
  const startAngle = Math.atan2(from.north - center.north, from.east - center.east);
  const endAngle = Math.atan2(to.north - center.north, to.east - center.east);
  let delta = endAngle - startAngle;
  if (turn > 0) {
    while (delta <= 0) delta += Math.PI * 2;
  } else {
    while (delta >= 0) delta -= Math.PI * 2;
  }
  if (Math.abs(delta) < 1e-3 || Math.abs(delta) > Math.PI * 1.15) return null;
  const radius = Math.hypot(from.east - center.east, from.north - center.north);
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / ROAD_CURVE_STEP_RADIANS));
  const points: PlanPoint[] = [from];
  for (let step = 1; step < steps; step += 1) {
    const angle = startAngle + delta * (step / steps);
    points.push({
      east: center.east + Math.cos(angle) * radius,
      north: center.north + Math.sin(angle) * radius,
    });
  }
  points.push(to);
  return points;
}

export function bufferPlanLine(
  points: PlanPoint[],
  halfWidth: number,
  options: { startCap: 'round' | 'butt'; endCap: 'round' | 'butt' } = { startCap: 'round', endCap: 'round' },
) {
  return bufferPlanRings(points, halfWidth, options)[0] ?? [];
}

/** Closed carriageways become an outer ring plus a hole so the island stays open. */
export function bufferPlanRings(
  points: PlanPoint[],
  halfWidth: number,
  options: { startCap: 'round' | 'butt'; endCap: 'round' | 'butt' } = { startCap: 'round', endCap: 'round' },
) {
  if (points.length < 2 || halfWidth <= 0) return [];
  const closed = isClosedPlanLine(points);
  const body = closed ? closedRingBody(points) : points;
  if (body.length < 2) return [];
  const left = offsetSide(body, halfWidth, closed);
  const right = offsetSide(body, -halfWidth, closed);
  if (left.length < 2 || right.length < 2) return [];
  if (closed) {
    const leftRadius = meanRadius(left);
    const rightRadius = meanRadius(right);
    const outer = leftRadius >= rightRadius ? left : right;
    const inner = leftRadius >= rightRadius ? right : left;
    return [orientRing(outer, false), orientRing(inner, true)];
  }
  const ring: PlanPoint[] = [...left];
  if (options.endCap === 'round') {
    ring.push(...joinArc(body[body.length - 1], left[left.length - 1], right[right.length - 1]));
  }
  ring.push(...right.slice().reverse());
  if (options.startCap === 'round') {
    ring.push(...joinArc(body[0], right[0], left[0]));
  }
  return [orientRing(ring, false)];
}

function meanRadius(points: PlanPoint[]) {
  const center = {
    east: points.reduce((sum, point) => sum + point.east, 0) / points.length,
    north: points.reduce((sum, point) => sum + point.north, 0) / points.length,
  };
  return points.reduce((sum, point) => sum + Math.hypot(point.east - center.east, point.north - center.north), 0)
    / points.length;
}

function signedArea(ring: PlanPoint[]) {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) {
    area += ring[index - 1].east * ring[index].north - ring[index].east * ring[index - 1].north;
  }
  return area / 2;
}

function orientRing(points: PlanPoint[], clockwise: boolean) {
  const ring = points.map((point) => ({ ...point }));
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.east !== last.east || first.north !== last.north) ring.push({ ...first });
  const isClockwise = signedArea(ring) < 0;
  if (isClockwise !== clockwise) ring.reverse();
  return ring;
}

function offsetSide(points: PlanPoint[], distance: number, closed = false) {
  const offset: PlanPoint[] = [];
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const previous = points[closed ? (index - 1 + count) % count : Math.max(0, index - 1)];
    const next = points[closed ? (index + 1) % count : Math.min(count - 1, index + 1)];
    const current = points[index];
    const inEast = current.east - previous.east;
    const inNorth = current.north - previous.north;
    const outEast = next.east - current.east;
    const outNorth = next.north - current.north;
    const inLength = Math.hypot(inEast, inNorth) || 1;
    const outLength = Math.hypot(outEast, outNorth) || 1;
    const n1x = -inNorth / inLength;
    const n1y = inEast / inLength;
    const n2x = -outNorth / outLength;
    const n2y = outEast / outLength;
    const endpoint = !closed && (index === 0 || index === count - 1);
    if (endpoint || (inEast === 0 && inNorth === 0) || (outEast === 0 && outNorth === 0)) {
      const nx = index === 0 ? n2x : n1x;
      const ny = index === 0 ? n2y : n1y;
      offset.push({
        east: current.east + nx * distance,
        north: current.north + ny * distance,
      });
      continue;
    }
    const from = {
      east: current.east + n1x * distance,
      north: current.north + n1y * distance,
    };
    const to = {
      east: current.east + n2x * distance,
      north: current.north + n2y * distance,
    };
    const cross = inEast * outNorth - inNorth * outEast;
    const outerJoin = distance >= 0 ? cross < 0 : cross > 0;
    if (!outerJoin) {
      offset.push(miterOffset(current, n1x, n1y, n2x, n2y, distance));
      continue;
    }
    offset.push(from);
    offset.push(...joinArc(current, from, to));
    offset.push(to);
  }
  return offset;
}

function miterOffset(
  point: PlanPoint,
  n1x: number,
  n1y: number,
  n2x: number,
  n2y: number,
  distance: number,
) {
  let mx = n1x + n2x;
  let my = n1y + n2y;
  const mLength = Math.hypot(mx, my);
  if (mLength < 1e-6) {
    return { east: point.east + n1x * distance, north: point.north + n1y * distance };
  }
  mx /= mLength;
  my /= mLength;
  const dot = mx * n1x + my * n1y;
  const miter = Math.abs(distance) / Math.max(0.25, Math.abs(dot));
  const limited = Math.min(miter, Math.abs(distance) * MITER_LIMIT);
  const signed = distance >= 0 ? limited : -limited;
  return {
    east: point.east + mx * signed,
    north: point.north + my * signed,
  };
}

function joinArc(center: PlanPoint, from: PlanPoint, to: PlanPoint) {
  const startAngle = Math.atan2(from.north - center.north, from.east - center.east);
  const endAngle = Math.atan2(to.north - center.north, to.east - center.east);
  let delta = endAngle - startAngle;
  while (delta <= 0) delta += Math.PI * 2;
  if (delta > Math.PI) delta -= Math.PI * 2;
  const radius = Math.hypot(from.east - center.east, from.north - center.north);
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / ROUND_JOIN_STEP_RADIANS));
  const points: PlanPoint[] = [];
  for (let step = 1; step < steps; step += 1) {
    const angle = startAngle + delta * (step / steps);
    points.push({
      east: center.east + Math.cos(angle) * radius,
      north: center.north + Math.sin(angle) * radius,
    });
  }
  return points;
}

export function clipPolygonToRect(ring: PlanPoint[], rect: PlanRect) {
  const edges: Array<(point: PlanPoint) => boolean> = [
    (point) => point.east >= rect.minEast,
    (point) => point.east <= rect.maxEast,
    (point) => point.north >= rect.minNorth,
    (point) => point.north <= rect.maxNorth,
  ];
  const intersect = [
    (a: PlanPoint, b: PlanPoint) => interpolate(a, b, (rect.minEast - a.east) / ((b.east - a.east) || 1e-9)),
    (a: PlanPoint, b: PlanPoint) => interpolate(a, b, (rect.maxEast - a.east) / ((b.east - a.east) || 1e-9)),
    (a: PlanPoint, b: PlanPoint) => interpolate(a, b, (rect.minNorth - a.north) / ((b.north - a.north) || 1e-9)),
    (a: PlanPoint, b: PlanPoint) => interpolate(a, b, (rect.maxNorth - a.north) / ((b.north - a.north) || 1e-9)),
  ];
  let output = ring.slice();
  if (output.length > 1) {
    const first = output[0];
    const last = output[output.length - 1];
    if (first.east === last.east && first.north === last.north) output.pop();
  }
  for (let edge = 0; edge < 4; edge += 1) {
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      const currentInside = edges[edge](current);
      const previousInside = edges[edge](previous);
      if (currentInside) {
        if (!previousInside) output.push(intersect[edge](previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(intersect[edge](previous, current));
      }
    }
  }
  if (output.length >= 3) output.push({ ...output[0] });
  return output;
}

function interpolate(start: PlanPoint, end: PlanPoint, t: number): PlanPoint {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    east: start.east + (end.east - start.east) * clamped,
    north: start.north + (end.north - start.north) * clamped,
  };
}

export function clipPlanLineToRect(points: PlanPoint[], rect: PlanRect) {
  if (points.length < 2) return [];
  const parts: PlanPoint[][] = [];
  let current: PlanPoint[] = [];
  const pushPoint = (point: PlanPoint) => {
    const last = current[current.length - 1];
    if (last && last.east === point.east && last.north === point.north) return;
    current.push(point);
  };
  const flush = () => {
    if (current.length >= 2) parts.push(current);
    current = [];
  };
  for (let index = 1; index < points.length; index += 1) {
    const clipped = clipSegmentInside(points[index - 1], points[index], rect);
    if (!clipped) {
      flush();
      continue;
    }
    if (current.length === 0) {
      pushPoint(clipped[0]);
      pushPoint(clipped[1]);
    } else {
      const last = current[current.length - 1];
      if (Math.hypot(last.east - clipped[0].east, last.north - clipped[0].north) > 0.05) {
        flush();
        pushPoint(clipped[0]);
      }
      pushPoint(clipped[1]);
    }
  }
  flush();
  return parts;
}

function clipSegmentInside(start: PlanPoint, end: PlanPoint, rect: PlanRect): [PlanPoint, PlanPoint] | null {
  const startInside = pointInRect(start, rect);
  const endInside = pointInRect(end, rect);
  if (!startInside && !endInside && !segmentIntersectsRect(start, end, rect)) return null;
  const hits = segmentRectHits(start, end, rect);
  const points = [start, ...hits, end].sort((left, right) => {
    const leftT = paramOnSegment(start, end, left);
    const rightT = paramOnSegment(start, end, right);
    return leftT - rightT;
  });
  const unique: PlanPoint[] = [];
  for (const point of points) {
    const last = unique[unique.length - 1];
    if (last && Math.hypot(last.east - point.east, last.north - point.north) < 1e-6) continue;
    unique.push(point);
  }
  for (let index = 1; index < unique.length; index += 1) {
    const from = unique[index - 1];
    const to = unique[index];
    const mid = { east: (from.east + to.east) / 2, north: (from.north + to.north) / 2 };
    if (pointInRect(mid, rect)) return [from, to];
  }
  return null;
}

function planLength(points: PlanPoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].east - points[index - 1].east, points[index].north - points[index - 1].north);
  }
  return length;
}

export function clipLineOutsideRects(coordinates: Array<[number, number]>, rects: RoadWorkCell[], seamMetres: number) {
  if (coordinates.length < 2 || rects.length === 0) return [coordinates];
  const origin = planOriginFromLngLat(coordinates[0][0], coordinates[0][1]);
  let parts = [lngLatsToPlan(coordinates, origin)];
  for (const cell of rects) {
    const rect = insetRect(cellRect(cell, origin), -seamMetres);
    parts = parts.flatMap((part) => subtractRectFromLine(part, rect));
  }
  return parts
    .map((part) => part.map((point) => planToLngLat(point, origin)))
    .filter((part) => part.length >= 2);
}

function cellRect(cell: RoadWorkCell, origin: PlanOrigin): PlanRect {
  const corners = lngLatsToPlan([
    [cell.west, cell.south],
    [cell.east, cell.north],
  ], origin);
  return {
    minEast: Math.min(corners[0].east, corners[1].east),
    maxEast: Math.max(corners[0].east, corners[1].east),
    minNorth: Math.min(corners[0].north, corners[1].north),
    maxNorth: Math.max(corners[0].north, corners[1].north),
  };
}

function paddedCellRect(cell: RoadWorkCell, origin: PlanOrigin): PlanRect {
  return insetRect(cellRect(cell, origin), ROAD_CELL_PADDING_METRES);
}

function insetRect(rect: PlanRect, padding: number): PlanRect {
  return {
    minEast: rect.minEast - padding,
    maxEast: rect.maxEast + padding,
    minNorth: rect.minNorth - padding,
    maxNorth: rect.maxNorth + padding,
  };
}

function subtractRectFromLine(points: PlanPoint[], rect: PlanRect) {
  if (points.length < 2) return [];
  const parts: PlanPoint[][] = [];
  let current: PlanPoint[] = [];
  const pushPoint = (point: PlanPoint) => {
    const last = current[current.length - 1];
    if (last && last.east === point.east && last.north === point.north) return;
    current.push(point);
  };
  const flush = () => {
    if (current.length >= 2) parts.push(current);
    current = [];
  };
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const clipped = clipSegmentOutside(start, end, rect);
    if (clipped.length === 0) {
      flush();
      continue;
    }
    for (const [from, to] of clipped) {
      if (current.length === 0) pushPoint(from);
      else {
        const last = current[current.length - 1];
        if (Math.hypot(last.east - from.east, last.north - from.north) > 0.05) {
          flush();
          pushPoint(from);
        }
      }
      pushPoint(to);
    }
  }
  flush();
  return parts;
}

function clipSegmentOutside(start: PlanPoint, end: PlanPoint, rect: PlanRect): Array<[PlanPoint, PlanPoint]> {
  const startInside = pointInRect(start, rect);
  const endInside = pointInRect(end, rect);
  if (!startInside && !endInside && !segmentIntersectsRect(start, end, rect)) {
    return [[start, end]];
  }
  const hits = segmentRectHits(start, end, rect);
  const points = [start, ...hits, end].sort((left, right) => {
    const leftT = paramOnSegment(start, end, left);
    const rightT = paramOnSegment(start, end, right);
    return leftT - rightT;
  });
  const unique: PlanPoint[] = [];
  for (const point of points) {
    const last = unique[unique.length - 1];
    if (last && Math.hypot(last.east - point.east, last.north - point.north) < 1e-6) continue;
    unique.push(point);
  }
  const segments: Array<[PlanPoint, PlanPoint]> = [];
  for (let index = 1; index < unique.length; index += 1) {
    const from = unique[index - 1];
    const to = unique[index];
    const mid = { east: (from.east + to.east) / 2, north: (from.north + to.north) / 2 };
    if (!pointInRect(mid, rect)) segments.push([from, to]);
  }
  return segments;
}

function segmentRectHits(start: PlanPoint, end: PlanPoint, rect: PlanRect) {
  const hits: PlanPoint[] = [];
  const edges: Array<[PlanPoint, PlanPoint]> = [
    [{ east: rect.minEast, north: rect.minNorth }, { east: rect.maxEast, north: rect.minNorth }],
    [{ east: rect.maxEast, north: rect.minNorth }, { east: rect.maxEast, north: rect.maxNorth }],
    [{ east: rect.maxEast, north: rect.maxNorth }, { east: rect.minEast, north: rect.maxNorth }],
    [{ east: rect.minEast, north: rect.maxNorth }, { east: rect.minEast, north: rect.minNorth }],
  ];
  for (const [a, b] of edges) {
    const hit = segmentIntersection(start, end, a, b);
    if (hit) hits.push(hit);
  }
  return hits;
}

function segmentIntersection(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint) {
  const den = (a.east - b.east) * (c.north - d.north) - (a.north - b.north) * (c.east - d.east);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.east - c.east) * (c.north - d.north) - (a.north - c.north) * (c.east - d.east)) / den;
  const u = ((a.east - c.east) * (a.north - b.north) - (a.north - c.north) * (a.east - b.east)) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { east: a.east + (b.east - a.east) * t, north: a.north + (b.north - a.north) * t };
}

function paramOnSegment(start: PlanPoint, end: PlanPoint, point: PlanPoint) {
  const dx = end.east - start.east;
  const dy = end.north - start.north;
  const length = dx * dx + dy * dy || 1;
  return ((point.east - start.east) * dx + (point.north - start.north) * dy) / length;
}

function pointInRect(point: PlanPoint, rect: PlanRect) {
  return point.east >= rect.minEast && point.east <= rect.maxEast
    && point.north >= rect.minNorth && point.north <= rect.maxNorth;
}

function segmentIntersectsRect(start: PlanPoint, end: PlanPoint, rect: PlanRect) {
  if (pointInRect(start, rect) || pointInRect(end, rect)) return true;
  return segmentRectHits(start, end, rect).length > 0;
}

function polygonArea(ring: PlanPoint[]) {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) {
    area += ring[index - 1].east * ring[index].north - ring[index].east * ring[index - 1].north;
  }
  return Math.abs(area) / 2;
}

function closeRing(ring: Array<[number, number]>) {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

export function buildRoadCellPolygons(cell: RoadWorkCell, lines: RoadCenterline[]): RoadCellGeometry {
  const origin = planOriginFromLngLat((cell.west + cell.east) / 2, (cell.south + cell.north) / 2);
  const padded = paddedCellRect(cell, origin);
  const clip = cellRect(cell, origin);
  const nearby = lines.filter((line) => lineIntersectsRect(line.coordinates, origin, padded));
  if (nearby.length === 0) {
    return { cellKey: cell.key, polygons: [], centerlines: [], vertexCount: 0, skipped: false };
  }
  if (nearby.length > MAX_FEATURES_PER_CELL) {
    return { cellKey: cell.key, polygons: [], centerlines: [], vertexCount: 0, skipped: true };
  }
  const stitched = stitchRoadCenterlines(nearby);
  const polygons: RoadPolygonFeature[] = [];
  const centerlines: RoadCenterlineFeature[] = [];
  let vertexCount = 0;
  for (const line of stitched) {
    const simplified = simplifyPlanLine(lngLatsToPlan(line.coordinates, origin), ROAD_SIMPLIFY_METRES);
    const densified = densifyPlanLine(simplified, ROAD_DENSIFY_METRES);
    const surfaceWidth = estimatedRoadWidthMetres(line.properties);
    const casingWidth = estimatedRoadCasingWidthMetres(line.properties);
    for (const kind of ['casing', 'surface'] as const) {
      const halfWidth = (kind === 'casing' ? casingWidth : surfaceWidth) / 2;
      const rings = bufferPlanRings(densified, halfWidth)
        .map((ring) => clipPolygonToRect(ring, clip))
        .filter((ring) => ring.length >= 4 && polygonArea(ring) >= MIN_POLYGON_AREA_METRES);
      if (rings.length === 0) continue;
      vertexCount += rings.reduce((sum, ring) => sum + ring.length, 0);
      if (vertexCount > MAX_VERTICES_PER_CELL) {
        return { cellKey: cell.key, polygons: [], centerlines: [], vertexCount, skipped: true };
      }
      polygons.push({
        type: 'Feature',
        properties: {
          kind,
          class: line.properties.className,
          layer: line.properties.layer,
          surface: line.properties.surface,
          ramp: line.properties.ramp ? 1 : 0,
        },
        geometry: {
          type: 'Polygon',
          coordinates: rings.map((ring) => closeRing(ring.map((point) => planToLngLat(point, origin)))),
        },
      });
    }
    if (!shouldDrawRoadCenterline(line.properties)) continue;
    for (const part of clipPlanLineToRect(densified, clip)) {
      if (part.length < 2 || planLength(part) < MIN_CENTERLINE_LENGTH_METRES) continue;
      centerlines.push({
        type: 'Feature',
        properties: {
          kind: 'centerline',
          class: line.properties.className,
          layer: line.properties.layer,
        },
        geometry: {
          type: 'LineString',
          coordinates: part.map((point) => planToLngLat(point, origin)),
        },
      });
    }
  }
  return { cellKey: cell.key, polygons, centerlines, vertexCount, skipped: false };
}

export function fallbackLinesForCoverage(
  lines: RoadCenterline[],
  completedCells: RoadWorkCell[],
  range: { longitude: number; latitude: number; metres: number },
) {
  const scale = metresPerDegree(range.latitude);
  const nearby = lines.filter((line) => line.coordinates.some((point) => (
    Math.hypot(
      (point[0] - range.longitude) * scale.longitude,
      (point[1] - range.latitude) * scale.latitude,
    ) <= range.metres
  )));
  return nearby.flatMap((line) => (
    clipLineOutsideRects(line.coordinates, completedCells, ROAD_POLYGON_SEAM_METRES).map((coordinates) => ({
      type: 'Feature' as const,
      properties: {
        kind: 'fallback' as const,
        class: line.properties.className,
        layer: line.properties.layer,
        surface: line.properties.surface,
        ramp: line.properties.ramp ? 1 : 0,
      },
      geometry: { type: 'LineString' as const, coordinates },
    }))
  ));
}
