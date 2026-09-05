import { describe, expect, it } from 'vitest';
import { destination, maxDeviationMeters, sliceLineAround, stitchLines, type TrafficLngLat } from './RoadTrafficGeometry';
import { pointsAreColinear, snapStation, stationSegmentCoordinates } from './RoadTrafficSnap';
import { trafficSegmentCoordinates, type RoadTrafficStation } from './RoadTraffic';

const malmi: TrafficLngLat = [25.029364, 60.241347];

function kehaI(): TrafficLngLat[] {
  const line: TrafficLngLat[] = [];
  for (let i = -10; i <= 10; i += 1) {
    const along = i * 32;
    const sag = (along * along) / 900;
    line.push(destination(destination(malmi, 90, along), 180, sag));
  }
  return line;
}

const station: RoadTrafficStation = {
  id: '23149',
  name: 'Regional road 101 Malmi',
  coordinates: malmi,
  roadNumber: 101,
  bearing: 90,
  collectionStatus: 'GATHERING',
  direction1: { speedKmh: 38, freeFlowKmh: 80, congestion: 'heavy' },
  direction2: { speedKmh: 74, freeFlowKmh: 80, congestion: 'free' },
};

describe('traffic road snapping', () => {
  it('follows a curved carriageway instead of the 520 m bearing chord', () => {
    const road = kehaI();
    const snapped = snapStation(station, [{
      id: 'keha',
      ref: '101',
      highway: 'trunk',
      name: 'Kehä I',
      coordinates: road,
    }]);
    expect(snapped.direction1?.length).toBeGreaterThan(2);
    expect(pointsAreColinear(snapped.direction1 ?? [])).toBe(false);
    const straight = trafficSegmentCoordinates(malmi[0], malmi[1], 90, 1);
    expect(maxDeviationMeters(straight, road)).toBeGreaterThan(40);
    expect(maxDeviationMeters(snapped.direction1 ?? [], road)).toBeLessThan(20);
  });

  it('falls back to a two-point chord when no road is nearby', () => {
    const coordinates = stationSegmentCoordinates(station, 1, []);
    expect(coordinates).toHaveLength(2);
    expect(sliceLineAround(kehaI(), malmi, 240).length).toBeGreaterThan(2);
    expect(stitchLines([
      [malmi, destination(malmi, 90, 80)],
      [destination(malmi, 90, 80), destination(malmi, 90, 160)],
    ])[0]).toHaveLength(3);
  });
});
