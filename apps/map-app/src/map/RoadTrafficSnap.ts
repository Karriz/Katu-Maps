import {
  headingDifference,
  lineHeadingAt,
  maxDeviationMeters,
  nearestPointOnLine,
  offsetLine,
  orientLine,
  sliceLineAround,
  stitchLines,
  type TrafficLngLat,
} from './RoadTrafficGeometry';
import { trafficSegmentCoordinates, type RoadTrafficStation } from './RoadTraffic';

export type RoadTrafficWay = {
  id: string;
  ref?: string;
  name?: string;
  highway?: string;
  coordinates: TrafficLngLat[];
};

const SNAP_MAX_M = 75;
const SLICE_HALF_M = 260;
const LANE_OFFSET_M = 9;
const HIGHWAY_RANK: Record<string, number> = {
  motorway: 6,
  trunk: 5,
  primary: 4,
  secondary: 3,
  tertiary: 2,
};

function refTokens(ref: string | undefined) {
  if (!ref) return [];
  return ref.split(/[;/]/).map((part) => part.trim().replace(/^(vt|kt|st|yt|mt)\s*/i, ''));
}

function refsMatch(way: RoadTrafficWay, roadNumber: number | undefined) {
  if (!roadNumber) return false;
  const wanted = String(roadNumber);
  return refTokens(way.ref).some((token) => token === wanted || token === `E${wanted}`);
}

function highwayRank(highway: string | undefined) {
  return highway ? HIGHWAY_RANK[highway] ?? 0 : 0;
}

export function mergeRoadNetwork(ways: RoadTrafficWay[]): RoadTrafficWay[] {
  const groups = new Map<string, RoadTrafficWay[]>();
  for (const way of ways) {
    if (way.coordinates.length < 2) continue;
    const key = way.ref ? `ref:${way.ref}` : `id:${way.id}`;
    const group = groups.get(key) ?? [];
    group.push(way);
    groups.set(key, group);
  }
  const merged: RoadTrafficWay[] = [];
  for (const group of groups.values()) {
    const stitched = stitchLines(group.map((way) => way.coordinates));
    const sample = group[0];
    stitched.forEach((coordinates, index) => {
      merged.push({
        id: `${sample.id}:${index}`,
        ref: sample.ref,
        name: sample.name,
        highway: sample.highway,
        coordinates,
      });
    });
  }
  return merged;
}

function scoreWay(way: RoadTrafficWay, station: RoadTrafficStation, nearestDistance: number) {
  const refBonus = refsMatch(way, station.roadNumber) ? 40 : 0;
  return nearestDistance - refBonus - highwayRank(way.highway) * 4;
}

function pickWay(station: RoadTrafficStation, ways: RoadTrafficWay[]) {
  let best: { way: RoadTrafficWay; distance: number } | undefined;
  for (const way of ways) {
    const nearest = nearestPointOnLine(station.coordinates, way.coordinates);
    if (!nearest || nearest.distance > SNAP_MAX_M) continue;
    if (station.bearing !== undefined) {
      const heading = lineHeadingAt(way.coordinates, nearest.point);
      const aligned = Math.min(
        headingDifference(heading, station.bearing),
        headingDifference(heading, (station.bearing + 180) % 360),
      );
      if (aligned > 55 && !refsMatch(way, station.roadNumber)) continue;
    }
    const score = scoreWay(way, station, nearest.distance);
    if (!best || score < scoreWay(best.way, station, best.distance)) {
      best = { way, distance: nearest.distance };
    }
  }
  return best?.way;
}

function oppositeCarriageway(
  station: RoadTrafficStation,
  primary: RoadTrafficWay,
  ways: RoadTrafficWay[],
  travelBearing: number,
) {
  const opposite = (travelBearing + 180) % 360;
  let best: RoadTrafficWay | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const way of ways) {
    if (way.id === primary.id) continue;
    if (primary.ref && way.ref && way.ref !== primary.ref) continue;
    const nearest = nearestPointOnLine(station.coordinates, way.coordinates);
    if (!nearest || nearest.distance < 10 || nearest.distance > 42) continue;
    const heading = lineHeadingAt(way.coordinates, nearest.point);
    const matchesOpposite = headingDifference(heading, opposite) <= 35
      || headingDifference(heading, travelBearing) <= 35;
    if (!matchesOpposite) continue;
    if (nearest.distance < bestDistance) {
      best = way;
      bestDistance = nearest.distance;
    }
  }
  return best;
}

function alignedCoordinates(line: TrafficLngLat[], station: RoadTrafficStation, direction: 1 | 2): TrafficLngLat[] {
  const travel = ((station.bearing ?? 90) + (direction === 2 ? 180 : 0) + 360) % 360;
  const oriented = orientLine(line, travel, station.coordinates);
  const sliced = sliceLineAround(oriented, station.coordinates, SLICE_HALF_M);
  return offsetLine(sliced, LANE_OFFSET_M);
}

export function snapStation(
  station: RoadTrafficStation,
  ways: RoadTrafficWay[],
  alreadyMerged = false,
) {
  const network = alreadyMerged ? ways : (ways.length ? mergeRoadNetwork(ways) : []);
  const way = pickWay(station, network);
  if (!way) return {};
  const travel = station.bearing ?? lineHeadingAt(way.coordinates, station.coordinates);
  const opposite = oppositeCarriageway(station, way, network, travel);
  return {
    way,
    direction1: alignedCoordinates(way.coordinates, station, 1),
    direction2: alignedCoordinates((opposite ?? way).coordinates, station, 2),
  };
}

export function stationSegmentCoordinates(
  station: RoadTrafficStation,
  direction: 1 | 2,
  network: RoadTrafficWay[],
): TrafficLngLat[] {
  const snapped = snapStation(station, network, true);
  const aligned = direction === 1 ? snapped.direction1 : snapped.direction2;
  if (aligned && aligned.length >= 2) return aligned;
  return trafficSegmentCoordinates(station.coordinates[0], station.coordinates[1], station.bearing, direction);
}

export function pointsAreColinear(line: TrafficLngLat[], toleranceMeters = 4) {
  if (line.length < 3) return true;
  return maxDeviationMeters(line, [line[0], line[line.length - 1]]) <= toleranceMeters;
}

export { maxDeviationMeters };
