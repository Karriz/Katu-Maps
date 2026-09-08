import {
  CARTOON_BUILDING_SHADOW_TRANSLATE,
  CARTOON_MAP_LIGHT_POSITION,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_COLOR,
  CARTOON_SUN_POLAR_DEGREES,
} from './CartoonLighting';
import { MAP_COLORS } from './MapPalette';
import {
  dayNightPhase,
  sunEcefDirection,
  sunPosition,
  type DayNightPhase,
} from './DayNightSun';

export type DayNightPalette = {
  background: string;
  land: string;
  park: string;
  water: string;
  waterEdge: string;
  road: string;
  roadCasing: string;
  path: string;
  rail: string;
  building: string;
  buildingBand: string;
  label: string;
  halo: string;
  shadow: string;
  boundary: string;
  aeroway: string;
  sky: string;
  horizon: string;
  fog: string;
  sun: string;
};

const DAY_PALETTE: DayNightPalette = {
  background: '#a9c58e',
  land: MAP_COLORS.ground,
  park: MAP_COLORS.park,
  water: MAP_COLORS.water,
  waterEdge: MAP_COLORS.waterEdge,
  road: MAP_COLORS.road,
  roadCasing: MAP_COLORS.roadCasing,
  path: '#fff8e8',
  rail: '#8ea097',
  building: MAP_COLORS.building,
  buildingBand: MAP_COLORS.buildingBand,
  label: MAP_COLORS.label,
  halo: MAP_COLORS.labelHalo,
  shadow: MAP_COLORS.shadow,
  boundary: '#8ea097',
  aeroway: '#dfe4dc',
  sky: '#7ec8ea',
  horizon: '#f3f8fb',
  fog: '#eef6fa',
  sun: CARTOON_SUN_COLOR,
};

const GOLDEN_PALETTE: DayNightPalette = {
  ...DAY_PALETTE,
  background: '#c9b07a',
  land: '#d7c48a',
  park: '#c4b56e',
  water: '#6ea7c4',
  waterEdge: '#4e829c',
  road: '#f3e6c8',
  building: '#f7e6c4',
  buildingBand: '#e0c49a',
  sky: '#f0a05a',
  horizon: '#ffd19a',
  fog: '#f7c48a',
  sun: '#ffd7a0',
};

const SUNSET_PALETTE: DayNightPalette = {
  background: '#9c9c87',
  land: '#b3ba94',
  park: '#879568',
  water: '#3e5e86',
  waterEdge: '#2a4668',
  road: '#e8c8a0',
  roadCasing: '#8a6e5a',
  path: '#e2c2a0',
  rail: '#7a6a68',
  building: '#ded1b6',
  buildingBand: '#bca88d',
  label: '#f4e6d8',
  halo: '#5a3a32',
  shadow: '#3a2428',
  boundary: '#8a6a62',
  aeroway: '#c4a090',
  sky: '#8c91b0',
  horizon: '#e8b48c',
  fog: '#b8adb0',
  sun: '#ffe1b8',
};

const CIVIL_PALETTE: DayNightPalette = {
  background: '#4a3a62',
  land: '#3e4a5e',
  park: '#2e4450',
  water: '#1c3556',
  waterEdge: '#162844',
  road: '#d2b48c',
  roadCasing: '#5a5348',
  path: '#c8b49a',
  rail: '#6a7888',
  building: '#5a4a58',
  buildingBand: '#7a5a52',
  label: '#e6dcec',
  halo: '#241828',
  shadow: '#140c18',
  boundary: '#6a7088',
  aeroway: '#3a4458',
  sky: '#2a2458',
  horizon: '#8a4a78',
  fog: '#3a2a58',
  sun: '#f0a0c0',
};

const NAUTICAL_PALETTE: DayNightPalette = {
  background: '#12203a',
  land: '#173044',
  park: '#14303c',
  water: '#0c243c',
  waterEdge: '#12344c',
  road: '#c4ae80',
  roadCasing: '#4e4a42',
  path: '#9aa8a6',
  rail: '#5a7082',
  building: '#2c3c50',
  buildingBand: '#5a5248',
  label: '#d4e4f4',
  halo: '#0e1c2c',
  shadow: '#060e18',
  boundary: '#5a7388',
  aeroway: '#243848',
  sky: '#0c1838',
  horizon: '#243868',
  fog: '#15243c',
  sun: '#c8d4f0',
};

const NIGHT_PALETTE: DayNightPalette = {
  background: '#071525',
  land: '#10253a',
  park: '#163944',
  water: '#0a2c46',
  waterEdge: '#164c66',
  road: '#b8aa80',
  roadCasing: '#625e53',
  path: '#8b9e9d',
  rail: '#6b8295',
  building: '#293f53',
  buildingBand: '#625f52',
  label: '#d9e8f5',
  halo: '#10253a',
  shadow: '#061322',
  boundary: '#7391a5',
  aeroway: '#29465a',
  sky: '#071525',
  horizon: '#274860',
  fog: '#1a3348',
  sun: '#d7e4f4',
};

const PALETTE_STOPS: Array<{ elevation: number; palette: DayNightPalette }> = [
  { elevation: 16, palette: DAY_PALETTE },
  { elevation: 8, palette: GOLDEN_PALETTE },
  { elevation: 1.5, palette: SUNSET_PALETTE },
  { elevation: -4, palette: CIVIL_PALETTE },
  { elevation: -10, palette: NAUTICAL_PALETTE },
  { elevation: -18, palette: NIGHT_PALETTE },
];

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const normalized = value.length === 3
    ? value.split('').map((part) => part + part).join('')
    : value;
  const numeric = Number.parseInt(normalized, 16);
  return [(numeric >> 16) & 255, (numeric >> 8) & 255, numeric & 255];
}

function rgbToHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

export function mixHex(from: string, to: string, amount: number) {
  const t = Math.min(1, Math.max(0, amount));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

function mixPalette(from: DayNightPalette, to: DayNightPalette, amount: number): DayNightPalette {
  return {
    background: mixHex(from.background, to.background, amount),
    land: mixHex(from.land, to.land, amount),
    park: mixHex(from.park, to.park, amount),
    water: mixHex(from.water, to.water, amount),
    waterEdge: mixHex(from.waterEdge, to.waterEdge, amount),
    road: mixHex(from.road, to.road, amount),
    roadCasing: mixHex(from.roadCasing, to.roadCasing, amount),
    path: mixHex(from.path, to.path, amount),
    rail: mixHex(from.rail, to.rail, amount),
    building: mixHex(from.building, to.building, amount),
    buildingBand: mixHex(from.buildingBand, to.buildingBand, amount),
    label: mixHex(from.label, to.label, amount),
    halo: mixHex(from.halo, to.halo, amount),
    shadow: mixHex(from.shadow, to.shadow, amount),
    boundary: mixHex(from.boundary, to.boundary, amount),
    aeroway: mixHex(from.aeroway, to.aeroway, amount),
    sky: mixHex(from.sky, to.sky, amount),
    horizon: mixHex(from.horizon, to.horizon, amount),
    fog: mixHex(from.fog, to.fog, amount),
    sun: mixHex(from.sun, to.sun, amount),
  };
}

export function paletteForElevation(elevation: number): DayNightPalette {
  if (elevation >= PALETTE_STOPS[0].elevation) return PALETTE_STOPS[0].palette;
  const last = PALETTE_STOPS[PALETTE_STOPS.length - 1];
  if (elevation <= last.elevation) return last.palette;
  for (let index = 0; index < PALETTE_STOPS.length - 1; index += 1) {
    const high = PALETTE_STOPS[index];
    const low = PALETTE_STOPS[index + 1];
    if (elevation <= high.elevation && elevation >= low.elevation) {
      const span = high.elevation - low.elevation;
      return mixPalette(low.palette, high.palette, span === 0 ? 1 : (elevation - low.elevation) / span);
    }
  }
  return DAY_PALETTE;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function globeShadeOpacity(zoom: number) {
  return 1 - smoothstep(4.2, 8.6, zoom);
}

export function localStyleMix(zoom: number) {
  return smoothstep(4.6, 9.2, zoom);
}

export function nightFactor(elevation: number) {
  return 1 - smoothstep(-12, 4, elevation);
}

export type DayNightAppearance = {
  date: Date;
  phase: DayNightPhase;
  elevation: number;
  azimuth: number;
  polar: number;
  palette: DayNightPalette;
  shadeOpacity: number;
  lightsIntensity: number;
  lightIntensity: number;
  lightPosition: [number, number, number];
  buildingShadowTranslate: [number, number];
  buildingShadowOpacity: number;
  treeShadowOffset: [number, number];
  treeNightMix: number;
  sunDirection: [number, number, number];
  atmosphereBlend: number;
};

function wrapAzimuth(value: number) {
  return ((value % 360) + 360) % 360;
}

export function buildingShadowTranslate(azimuth: number, polar: number): [number, number] {
  const elevation = Math.max(8, 90 - polar) * Math.PI / 180;
  const cartoonElevation = (90 - CARTOON_SUN_POLAR_DEGREES) * Math.PI / 180;
  const length = Math.min(2.4, Math.hypot(...CARTOON_BUILDING_SHADOW_TRANSLATE)
    * Math.tan(cartoonElevation)
    / Math.tan(elevation));
  const radians = azimuth * Math.PI / 180;
  return [-Math.sin(radians) * length, Math.cos(radians) * length];
}

export function dayNightAppearance(date: Date, latitude: number, longitude: number, zoom: number): DayNightAppearance {
  const sun = sunPosition(date, latitude, longitude);
  const localPalette = paletteForElevation(sun.elevation);
  const styleMix = localStyleMix(zoom);
  const palette = mixPalette(DAY_PALETTE, localPalette, styleMix);
  const night = nightFactor(sun.elevation);
  const polar = sun.elevation >= 0
    ? Math.min(88, 90 - sun.elevation)
    : 88 - night * 30;
  const azimuth = sun.elevation > 0 ? sun.azimuth : wrapAzimuth(sun.azimuth + 180);
  const shadeOpacity = globeShadeOpacity(zoom);
  const shadowTranslate = buildingShadowTranslate(azimuth, polar);
  const shadowScale = 0.55 + (1 - night) * 0.45;
  return {
    date,
    phase: dayNightPhase(sun.elevation),
    elevation: sun.elevation,
    azimuth,
    polar,
    palette,
    shadeOpacity,
    lightsIntensity: night * (0.35 + shadeOpacity * 0.65),
    // Let wall orientation do more of the shading work than the extrusion
    // gradient while retaining a gentle ambient floor at night.
    lightIntensity: 0.12 + (1 - night) * 0.32,
    lightPosition: [CARTOON_MAP_LIGHT_POSITION[0], azimuth, polar],
    buildingShadowTranslate: [
      shadowTranslate[0] * shadowScale,
      shadowTranslate[1] * shadowScale,
    ],
    buildingShadowOpacity: (1 - night * 0.72) * (0.16 + (1 - night) * 0.16),
    treeShadowOffset: [
      shadowTranslate[0] * 1.15,
      -shadowTranslate[1] * 1.15,
    ],
    treeNightMix: night,
    sunDirection: sunEcefDirection(date),
    // The geographic shade layer owns globe sunlight; MapLibre uses a different light frame.
    atmosphereBlend: 0,
  };
}

export function cartoonDayNightAppearance(): Pick<
  DayNightAppearance,
  'azimuth' | 'polar' | 'lightPosition' | 'buildingShadowTranslate' | 'treeShadowOffset' | 'treeNightMix'
> {
  return {
    azimuth: CARTOON_SUN_AZIMUTH_DEGREES,
    polar: CARTOON_SUN_POLAR_DEGREES,
    lightPosition: CARTOON_MAP_LIGHT_POSITION,
    buildingShadowTranslate: CARTOON_BUILDING_SHADOW_TRANSLATE,
    treeShadowOffset: [0, 0],
    treeNightMix: 0,
  };
}
