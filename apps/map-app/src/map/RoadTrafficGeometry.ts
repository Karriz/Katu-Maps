export type TrafficLngLat = [number, number];

const EARTH_RADIUS_M = 6_371_000;

export function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

export function destination(from: TrafficLngLat, bearingDegrees: number, distanceMeters: number): TrafficLngLat {
  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const bearing = toRadians(bearingDegrees);
  const fromLat = toRadians(from[1]);
  const fromLng = toRadians(from[0]);
  const toLat = Math.asin(
    Math.sin(fromLat) * Math.cos(angularDistance)
      + Math.cos(fromLat) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const toLng = fromLng + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(fromLat),
    Math.cos(angularDistance) - Math.sin(fromLat) * Math.sin(toLat),
  );
  return [((toDegrees(toLng) + 540) % 360) - 180, toDegrees(toLat)];
}

export function distanceMeters(a: TrafficLngLat, b: TrafficLngLat) {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b[0] - a[0]);
  const hav = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(hav)));
}

export function bearingDegrees(from: TrafficLngLat, to: TrafficLngLat) {
  const lat1 = toRadians(from[1]);
  const lat2 = toRadians(to[1]);
  const dLng = toRadians(to[0] - from[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function headingDifference(a: number, b: number) {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

export function lineLength(line: TrafficLngLat[]) {
  let length = 0;
  for (let i = 1; i < line.length; i += 1) {
    length += distanceMeters(line[i - 1], line[i]);
  }
  return length;
}

export type NearestOnLine = {
  point: TrafficLngLat;
  index: number;
  t: number;
  distance: number;
  distanceAlong: number;
};

function interpolate(a: TrafficLngLat, b: TrafficLngLat, t: number): TrafficLngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function toXY(point: TrafficLngLat, origin: TrafficLngLat): [number, number] {
  const x = (point[0] - origin[0]) * Math.cos(toRadians(origin[1])) * 111_320;
  const y = (point[1] - origin[1]) * 110_540;
  return [x, y];
}

export function nearestPointOnLine(point: TrafficLngLat, line: TrafficLngLat[]): NearestOnLine | undefined {
  if (line.length < 2) return undefined;
  let best: NearestOnLine | undefined;
  let traveled = 0;
  const px = toXY(point, point);
  for (let i = 0; i < line.length - 1; i += 1) {
    const start = line[i];
    const end = line[i + 1];
    const [ax, ay] = toXY(start, point);
    const [bx, by] = toXY(end, point);
    const vx = bx - ax;
    const vy = by - ay;
    const lengthSq = vx * vx + vy * vy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px[0] - ax) * vx + (px[1] - ay) * vy) / lengthSq));
    const candidate = interpolate(start, end, t);
    const distance = distanceMeters(point, candidate);
    const segmentLength = distanceMeters(start, end);
    if (!best || distance < best.distance) {
      best = {
        point: candidate,
        index: i,
        t,
        distance,
        distanceAlong: traveled + segmentLength * t,
      };
    }
    traveled += segmentLength;
  }
  return best;
}

export function lineHeadingAt(line: TrafficLngLat[], atPoint: TrafficLngLat) {
  const nearest = nearestPointOnLine(atPoint, line);
  if (!nearest) return 0;
  const start = line[nearest.index];
  const end = line[Math.min(line.length - 1, nearest.index + 1)];
  return bearingDegrees(start, end);
}

export function reverseLine(line: TrafficLngLat[]): TrafficLngLat[] {
  return line.slice().reverse();
}

export function orientLine(line: TrafficLngLat[], travelBearing: number, atPoint: TrafficLngLat) {
  const heading = lineHeadingAt(line, atPoint);
  return headingDifference(heading, travelBearing) > 90 ? reverseLine(line) : line;
}

function pointAlong(line: TrafficLngLat[], distance: number): { point: TrafficLngLat; index: number } {
  if (distance <= 0) return { point: line[0], index: 0 };
  let remaining = distance;
  for (let i = 0; i < line.length - 1; i += 1) {
    const span = distanceMeters(line[i], line[i + 1]);
    if (remaining <= span) {
      const t = span === 0 ? 0 : remaining / span;
      return { point: interpolate(line[i], line[i + 1], t), index: i };
    }
    remaining -= span;
  }
  return { point: line[line.length - 1], index: line.length - 2 };
}

export function sliceLineAround(line: TrafficLngLat[], point: TrafficLngLat, halfLengthMeters: number): TrafficLngLat[] {
  const nearest = nearestPointOnLine(point, line);
  if (!nearest) return line.slice(0, 2);
  const startDistance = Math.max(0, nearest.distanceAlong - halfLengthMeters);
  const endDistance = Math.min(lineLength(line), nearest.distanceAlong + halfLengthMeters);
  const start = pointAlong(line, startDistance);
  const end = pointAlong(line, endDistance);
  const sliced: TrafficLngLat[] = [start.point];
  const firstVertex = start.index + 1;
  const lastVertex = end.index;
  for (let i = firstVertex; i <= lastVertex; i += 1) {
    const vertex = line[i];
    const previous = sliced[sliced.length - 1];
    if (distanceMeters(previous, vertex) > 0.4) sliced.push(vertex);
  }
  const last = sliced[sliced.length - 1];
  if (distanceMeters(last, end.point) > 0.4) sliced.push(end.point);
  return sliced.length >= 2 ? sliced : [start.point, end.point];
}

export function offsetLine(line: TrafficLngLat[], offsetMeters: number): TrafficLngLat[] {
  if (line.length < 2 || offsetMeters === 0) return line.map((point) => [point[0], point[1]] as TrafficLngLat);
  return line.map((point, index) => {
    const prev = line[Math.max(0, index - 1)];
    const next = line[Math.min(line.length - 1, index + 1)];
    const heading = bearingDegrees(prev, next);
    return destination(point, (heading + 90) % 360, offsetMeters);
  });
}

function endpointsClose(a: TrafficLngLat, b: TrafficLngLat, toleranceMeters: number) {
  return distanceMeters(a, b) <= toleranceMeters;
}

export function stitchLines(lines: TrafficLngLat[][], joinToleranceMeters = 3): TrafficLngLat[][] {
  const remaining = lines.filter((line) => line.length >= 2).map((line) => line.slice());
  const merged: TrafficLngLat[][] = [];
  while (remaining.length) {
    let current = remaining.pop()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const other = remaining[i];
        const currentStart = current[0];
        const currentEnd = current[current.length - 1];
        const otherStart = other[0];
        const otherEnd = other[other.length - 1];
        let next: TrafficLngLat[] | null = null;
        if (endpointsClose(currentEnd, otherStart, joinToleranceMeters)) {
          next = current.concat(other.slice(1));
        } else if (endpointsClose(currentEnd, otherEnd, joinToleranceMeters)) {
          next = current.concat(other.slice(0, -1).reverse());
        } else if (endpointsClose(currentStart, otherEnd, joinToleranceMeters)) {
          next = other.concat(current.slice(1));
        } else if (endpointsClose(currentStart, otherStart, joinToleranceMeters)) {
          next = other.slice().reverse().concat(current.slice(1));
        }
        if (next) {
          current = next;
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    merged.push(current);
  }
  return merged;
}

export function maxDeviationMeters(candidate: TrafficLngLat[], reference: TrafficLngLat[]) {
  let max = 0;
  for (const point of candidate) {
    const nearest = nearestPointOnLine(point, reference);
    if (nearest) max = Math.max(max, nearest.distance);
  }
  return max;
}
