import { describe, expect, it } from 'vitest';
import { railRouteFeatures } from './TransitRouteOverlay';

function encodePolyline(coordinates: [number, number][], precision = 5) {
  const factor = 10 ** precision;
  let latitude = 0;
  let longitude = 0;
  const encode = (difference: number) => {
    let value = difference < 0 ? ~(difference << 1) : difference << 1;
    let result = '';
    while (value >= 0x20) {
      result += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    return result + String.fromCharCode(value + 63);
  };
  return coordinates.map(([nextLongitude, nextLatitude]) => {
    const roundedLatitude = Math.round(nextLatitude * factor);
    const roundedLongitude = Math.round(nextLongitude * factor);
    const result = encode(roundedLatitude - latitude) + encode(roundedLongitude - longitude);
    latitude = roundedLatitude;
    longitude = roundedLongitude;
    return result;
  }).join('');
}

describe('TransitRouteOverlay', () => {
  it('keeps only rail-based route polylines and preserves their route color', () => {
    const features = railRouteFeatures({
      routes: [
        { mode: 'TRAM', transitRoutes: [{ shortName: '3', color: 'D93D3D' }] },
        { mode: 'BUS', transitRoutes: [{ shortName: '8', color: '0055CC' }] },
      ],
      polylines: [{
        polyline: { points: encodePolyline([[0, 0], [0.1, 0.1]]), precision: 5 },
        routeIndexes: [0, 1],
      }],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties).toEqual({ color: '#D93D3D', label: '3', mode: 'TRAM' });
    expect(features[0].geometry.coordinates).toEqual([[0, 0], [0.1, 0.1]]);
  });

  it('uses app-consistent mode colors when a route has no usable color', () => {
    const features = railRouteFeatures({
      routes: [
        { mode: 'SUBWAY', transitRoutes: [{ shortName: 'M' }] },
        { mode: 'TRAM', transitRoutes: [{ shortName: '3', color: 'not-a-color' }] },
        { mode: 'RAIL', transitRoutes: [{ shortName: 'IC' }] },
      ],
      polylines: [{
        polyline: { points: encodePolyline([[0, 0], [0.1, 0.1]]), precision: 5 },
        routeIndexes: [0, 1, 2],
      }],
    });

    expect(features.map((feature) => feature.properties.color)).toEqual([
      '#e87524', '#8554c7', '#4f9b70',
    ]);
  });

  it('splits rail geometry at implausibly long segments and preserves valid fragments', () => {
    const firstFragment: [number, number][] = [[24, 60], [24.1, 60.1]];
    const secondFragment: [number, number][] = [[25, 61], [25.1, 61.1]];
    const features = railRouteFeatures({
      routes: [{ mode: 'RAIL', transitRoutes: [{ shortName: 'IC' }] }],
      polylines: [{
        polyline: { points: encodePolyline([...firstFragment, ...secondFragment]), precision: 5 },
        routeIndexes: [0],
      }],
    });

    expect(features.map((feature) => feature.geometry.coordinates)).toEqual([
      firstFragment,
      secondFragment,
    ]);
    expect(features.map((feature) => feature.id)).toEqual(['0:0:0', '0:0:1']);
  });
});
