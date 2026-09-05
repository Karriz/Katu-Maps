/**
 * OpenFreeMap follows the OpenMapTiles `poi` schema. Sport and outdoor
 * features arrive as `class`/`subclass`, not a dedicated `sport` attribute.
 * These lists are the values the map actually filters on.
 */

/** Public and commercial sport sites shown with default location POIs. */
export const SPORT_FACILITY_POI_CLASSES = [
  'playground',
  'sports_centre',
  'pitch',
  'golf',
  'golf_course',
  'miniature_golf',
  'swimming',
  'swimming_area',
  'swimming_pool',
  'ice_rink',
  'water_park',
  'marina',
  'harbor',
  'american_football',
  'archery',
  'athletics',
  'australian_football',
  'badminton',
  'baseball',
  'basketball',
  'beachvolleyball',
  'billiards',
  'bmx',
  'boules',
  'bowls',
  'boxing',
  'canadian_football',
  'canoe',
  'chess',
  'climbing',
  'climbing_adventure',
  'cricket',
  'cricket_nets',
  'croquet',
  'curling',
  'disc_golf',
  'diving',
  'dog_racing',
  'equestrian',
  'field_hockey',
  'free_flying',
  'gaelic_games',
  'gymnastics',
  'handball',
  'hockey',
  'horse_racing',
  'horseshoes',
  'ice_hockey',
  'ice_stock',
  'judo',
  'karting',
  'korfball',
  'long_jump',
  'model_aerodrome',
  'motocross',
  'motor',
  'multi',
  'netball',
  'orienteering',
  'paddle_tennis',
  'paintball',
  'paragliding',
  'pelota',
  'racquet',
  'rc_car',
  'rowing',
  'rugby',
  'rugby_league',
  'rugby_union',
  'running',
  'sailing',
  'scuba_diving',
  'shooting',
  'shooting_range',
  'skateboard',
  'skating',
  'skiing',
  'soccer',
  'surfing',
  'table_soccer',
  'table_tennis',
  'team_handball',
  'tennis',
  'toboggan',
  'volleyball',
  'water_ski',
  'yoga',
] as const;

/** Trail amenities shown on the hiking overlay, then again as default POIs. */
export const HIKING_POI_CLASSES = [
  'shelter',
  'wilderness_hut',
  'alpine_hut',
  'viewpoint',
  'information',
  'guidepost',
  'picnic_site',
  'campsite',
  'camp_site',
  'drinking_water',
  'toilets',
  'dog_park',
  'bbq',
  'winter_sports',
] as const;

/** Nearby ranking uses this shorter sport set so tennis courts do not crowd parks. */
export const NEARBY_SPORT_POI_TYPES = [
  'playground',
  'sports_centre',
  'stadium',
  'golf',
  'golf_course',
  'miniature_golf',
  'swimming',
  'swimming_area',
  'swimming_pool',
  'ice_rink',
  'water_park',
  'pitch',
  'marina',
  'harbor',
] as const;

const GOLF_ICON_CLASSES = new Set(['golf', 'golf_course', 'miniature_golf', 'disc_golf']);
const SWIMMING_ICON_CLASSES = new Set(['swimming', 'swimming_area', 'swimming_pool', 'water_park', 'diving', 'scuba_diving', 'surfing', 'water_ski']);
const ICE_ICON_CLASSES = new Set(['ice_rink', 'ice_hockey', 'ice_stock', 'skating', 'curling', 'skiing', 'toboggan']);
const WATER_SPORT_ICON_CLASSES = new Set(['marina', 'harbor', 'sailing', 'rowing', 'canoe']);
const STADIUM_ICON_CLASSES = new Set(['stadium', 'american_football', 'soccer']);

/** Icon definition id for a sport or playground POI class. */
export function sportFacilityIconId(className: string) {
  if (className === 'playground') return 'playground';
  if (GOLF_ICON_CLASSES.has(className)) return 'golf';
  if (SWIMMING_ICON_CLASSES.has(className)) return 'swimming';
  if (ICE_ICON_CLASSES.has(className)) return 'ice_rink';
  if (WATER_SPORT_ICON_CLASSES.has(className)) return 'marina';
  if (STADIUM_ICON_CLASSES.has(className)) return 'stadium';
  return 'sports_centre';
}
