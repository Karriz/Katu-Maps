import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TransitRouteResult } from './transit';
import {
  isWalkingTransitMode,
  transitModeLabel,
  transitRouteOptionLabel,
  TransitRouteOptions,
} from './TransitRouteOptions';

function routeOption(
  provider: TransitRouteResult['provider'],
  transitLegs: TransitRouteResult['transitLegs'],
  transfers = 0,
): TransitRouteResult {
  return {
    geometry: { type: 'LineString', coordinates: [[23.7, 61.4], [23.8, 61.5]] },
    distanceKm: 1.2,
    durationSeconds: 1_080,
    departureTime: '2026-08-30T09:00:00.000Z',
    arrivalTime: '2026-08-30T09:18:00.000Z',
    transfers,
    provider,
    transitLegs,
  };
}

describe('transit route alternative presentation', () => {
  it('renders Digitransit and Transitous legs through the same view', () => {
    const digitransit = routeOption('digitransit', [
      { mode: 'TRAM', route: '3', routeColor: 'C92F40', routeTextColor: 'FFFFFF', provider: 'digitransit' },
      { mode: 'WALK', provider: 'digitransit' },
    ]);
    const transitous = routeOption('transitous', [
      { mode: 'FOOT', provider: 'transitous' },
      { mode: 'BUS', route: '7', routeColor: '#18734A', routeTextColor: '#FFFFFF', provider: 'transitous' },
      { mode: 'LIGHT_RAIL', route: 'T1', provider: 'transitous' },
    ], 1);

    const markup = renderToStaticMarkup(
      <TransitRouteOptions options={[digitransit, transitous]} selectedIndex={1} onSelect={() => undefined} />,
    );

    expect(markup).toContain('data-provider="digitransit"');
    expect(markup).toContain('data-provider="transitous"');
    expect(markup).toContain('aria-label="Tram 3"');
    expect(markup).toContain('aria-label="Bus 7"');
    expect(markup).toContain('aria-label="Tram T1"');
    expect(markup).toContain('background-color:#C92F40');
    expect(markup).toContain('background-color:#18734A');
    expect(markup).toContain('transit-option-walk');
    expect(markup).toContain('Direct');
    expect(markup).toContain('1 transfer');
    expect(markup).toContain('Selected');
  });

  it('handles provider mode aliases and missing route names', () => {
    expect(isWalkingTransitMode('foot')).toBe(true);
    expect(isWalkingTransitMode('PEDESTRIAN')).toBe(true);
    expect(transitModeLabel('SUBURBAN')).toBe('Train');
    expect(transitModeLabel('light_rail')).toBe('Tram');

    const option = routeOption('transitous', [
      { mode: 'REGIONAL_RAIL', provider: 'transitous' },
    ]);
    expect(transitRouteOptionLabel(option)).toContain('via Train');
  });
});
