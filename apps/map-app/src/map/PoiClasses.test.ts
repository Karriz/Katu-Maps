import { describe, expect, it } from 'vitest';
import {
  HIKING_POI_CLASSES,
  NEARBY_SPORT_POI_TYPES,
  SPORT_FACILITY_POI_CLASSES,
  sportFacilityIconId,
} from './PoiClasses';

describe('OpenFreeMap sport and hiking POI classes', () => {
  it('treats playgrounds and public sport sites as default facilities', () => {
    expect(SPORT_FACILITY_POI_CLASSES).toEqual(expect.arrayContaining([
      'playground', 'sports_centre', 'pitch', 'golf', 'swimming', 'swimming_pool',
      'ice_rink', 'water_park', 'marina', 'tennis',
    ]));
    expect(SPORT_FACILITY_POI_CLASSES).not.toContain('dog_park');
    expect(SPORT_FACILITY_POI_CLASSES).not.toContain('winter_sports');
  });

  it('keeps leftover outdoor amenities on the hiking overlay', () => {
    expect(HIKING_POI_CLASSES).toEqual(expect.arrayContaining([
      'shelter', 'viewpoint', 'picnic_site', 'dog_park', 'bbq', 'winter_sports',
    ]));
    expect(HIKING_POI_CLASSES).not.toContain('playground');
    expect(HIKING_POI_CLASSES).not.toContain('sports_centre');
  });

  it('maps facility types onto a small icon set', () => {
    expect(sportFacilityIconId('playground')).toBe('playground');
    expect(sportFacilityIconId('golf_course')).toBe('golf');
    expect(sportFacilityIconId('swimming_pool')).toBe('swimming');
    expect(sportFacilityIconId('ice_hockey')).toBe('ice_rink');
    expect(sportFacilityIconId('tennis')).toBe('sports_centre');
    expect(sportFacilityIconId('soccer')).toBe('stadium');
  });

  it('limits nearby recreation to notable sport sites', () => {
    expect(NEARBY_SPORT_POI_TYPES).toEqual(expect.arrayContaining([
      'playground', 'sports_centre', 'golf', 'swimming', 'pitch',
    ]));
    expect(NEARBY_SPORT_POI_TYPES).not.toContain('tennis');
  });
});
