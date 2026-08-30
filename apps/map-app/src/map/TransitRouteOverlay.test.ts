import { describe, expect, it } from 'vitest';
import { railRouteFeatures } from './TransitRouteOverlay';

describe('TransitRouteOverlay', () => {
  it('keeps only rail-based route polylines and preserves their route color', () => {
    const features = railRouteFeatures({
      routes: [
        { mode: 'TRAM', transitRoutes: [{ shortName: '3', color: 'D93D3D' }] },
        { mode: 'BUS', transitRoutes: [{ shortName: '8', color: '0055CC' }] },
      ],
      polylines: [{
        polyline: { points: '??_ibE_ibE', precision: 5 },
        routeIndexes: [0, 1],
      }],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties).toEqual({ color: '#D93D3D', label: '3', mode: 'TRAM' });
    expect(features[0].geometry.coordinates).toEqual([[0, 0], [1, 1]]);
  });

  it('uses app-consistent mode colors when a route has no usable color', () => {
    const features = railRouteFeatures({
      routes: [
        { mode: 'SUBWAY', transitRoutes: [{ shortName: 'M' }] },
        { mode: 'TRAM', transitRoutes: [{ shortName: '3', color: 'not-a-color' }] },
        { mode: 'RAIL', transitRoutes: [{ shortName: 'IC' }] },
      ],
      polylines: [{
        polyline: { points: '??_ibE_ibE', precision: 5 },
        routeIndexes: [0, 1, 2],
      }],
    });

    expect(features.map((feature) => feature.properties.color)).toEqual([
      '#e87524', '#8554c7', '#4f9b70',
    ]);
  });
});