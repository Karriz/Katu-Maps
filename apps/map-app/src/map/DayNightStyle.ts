import type { LightSpecification, Map as MapLibreMap, SkySpecification } from 'maplibre-gl';
import {
  CARTOON_BUILDING_SHADOW_TRANSLATE,
  CARTOON_MAP_LIGHT_POSITION,
  CARTOON_SHADOW_COLOR,
  CARTOON_SUN_COLOR,
} from './CartoonLighting';
import { globeBiomeColor } from './GlobeBiomeStyle';
import { GLOBAL_MAP_STYLE, applyMapTheme, buildingColorPaint } from './GlobalMapStyle';
import type { DayNightAppearance, DayNightPalette } from './DayNightAppearance';
import { localStyleMix, nightFactor } from './DayNightAppearance';
import { Color } from 'three';
import { RAIL_BED_DAY, RAIL_BED_NIGHT, RAIL_SLEEPER_DAY, RAIL_SLEEPER_NIGHT } from './RailwayAppearance';
import { MAP_COLORS } from './MapPalette';

const DAYLIGHT_SKY: SkySpecification = {
  'sky-color': '#7ec8ea',
  'horizon-color': '#f3f8fb',
  'fog-color': '#eef6fa',
  'sky-horizon-blend': 0.7,
  'horizon-fog-blend': 1,
  'fog-ground-blend': 0.72,
  'atmosphere-blend': GLOBAL_MAP_STYLE.sky?.['atmosphere-blend'] ?? 0,
};

const capturedLighting = new WeakMap<MapLibreMap, {
  sky: SkySpecification | undefined;
  light: LightSpecification | undefined;
}>();
const paintMode = new WeakMap<MapLibreMap, { palette: boolean; buildingColorsEnabled: boolean }>();

function setPaint(map: MapLibreMap, id: string, property: string, value: unknown) {
  if (map.getLayer(id)) map.setPaintProperty(id, property as never, value as never);
}

function applyBuildingPalette(
  map: MapLibreMap,
  building: string,
  buildingBand: string,
  buildingColorsEnabled: boolean,
) {
  ['global-building-footprints', 'global-building-footprints-2d'].forEach((id) => {
    setPaint(map, id, 'fill-color', buildingColorPaint(building, buildingColorsEnabled));
  });
  setPaint(map, 'global-building-ground-storeys', 'fill-extrusion-color', buildingColorPaint(buildingBand, buildingColorsEnabled));
  setPaint(map, 'global-buildings', 'fill-extrusion-color', buildingColorPaint(building, buildingColorsEnabled));
}

function applyPalette(map: MapLibreMap, colors: DayNightPalette, night: number, buildingColorsEnabled: boolean) {
  setPaint(map, 'global-background', 'background-color', colors.background);
  setPaint(map, 'global-globe-biomes', 'fill-color',
    globeBiomeColor(colors.land, localStyleMix(map.getZoom()) * (0.2 + night * 0.65)));
  ['global-landcover', 'global-landuse', 'global-landuse-overlays'].forEach((id) => {
    setPaint(map, id, 'fill-color', colors.land);
  });
  ['global-protected-areas', 'global-parks', 'global-landcover-parks'].forEach((id) => {
    setPaint(map, id, 'fill-color', colors.park);
  });
  setPaint(map, 'global-aeroway-areas', 'fill-color', colors.aeroway);
  setPaint(map, 'global-aeroway-lines', 'line-color', colors.boundary);
  setPaint(map, 'global-aeroway-runways', 'line-color', colors.boundary);
  setPaint(map, 'terrain-hillshade', 'hillshade-shadow-color', night > 0.45 ? '#020b14' : '#7d8e82');
  setPaint(map, 'terrain-hillshade', 'hillshade-highlight-color', night > 0.45 ? '#173149' : '#f7f2db');
  setPaint(map, 'terrain-hillshade', 'hillshade-accent-color', night > 0.45 ? '#0b2033' : '#b3c0b5');
  ['global-water', 'global-waterway'].forEach((id) => {
    setPaint(map, id, id.endsWith('way') ? 'line-color' : 'fill-color', colors.water);
  });
  setPaint(map, 'global-water-edge-shade', 'fill-color', colors.waterEdge);
  ['global-pedestrian-areas', 'global-pier-areas', 'global-bridge-decks'].forEach((id) => {
    setPaint(map, id, 'fill-color', colors.land);
  });
  [
    'global-road-tunnel-casing', 'global-road-casing', 'global-road-bridge-casing',
    'global-overview-road-casing', 'global-overview-regional-road-casing',
  ].forEach((id) => setPaint(map, id, 'line-color', colors.roadCasing));
  [
    'global-road-tunnels', 'global-roads', 'global-road-bridges',
    'global-overview-roads', 'global-overview-regional-roads',
  ].forEach((id) => setPaint(map, id, 'line-color', colors.road));
  [
    'global-path-casing', 'global-cycleway-casing', 'global-footways',
    'global-steps', 'global-other-paths',
  ].forEach((id) => setPaint(map, id, 'line-color', colors.path));
  ['global-tracks', 'global-railways', 'global-overview-railways'].forEach((id) => {
    setPaint(map, id, 'line-color', colors.rail);
  });
  setPaint(map, 'global-railway-bed', 'line-color', `#${new Color(RAIL_BED_DAY).lerp(new Color(RAIL_BED_NIGHT), night).getHexString()}`);
  setPaint(map, 'global-railway-sleepers', 'line-color', `#${new Color(RAIL_SLEEPER_DAY).lerp(new Color(RAIL_SLEEPER_NIGHT), night).getHexString()}`);
  ['global-building-footprints', 'global-building-footprints-2d'].forEach((id) => {
    setPaint(map, id, 'fill-outline-color', colors.boundary);
  });
  applyBuildingPalette(map, colors.building, colors.buildingBand, buildingColorsEnabled);
  const verticalGradient = false;
  setPaint(map, 'global-building-ground-storeys', 'fill-extrusion-vertical-gradient', verticalGradient);
  setPaint(map, 'global-buildings', 'fill-extrusion-vertical-gradient', verticalGradient);
  ['global-building-shadow', 'global-building-contact-shadow'].forEach((id) => {
    setPaint(map, id, 'line-color', colors.shadow);
  });
  ['global-boundaries', 'global-boundaries-regional'].forEach((id) => {
    setPaint(map, id, 'line-color', colors.boundary);
  });
  (map.getStyle().layers ?? [])
    .filter((layer) => layer.id.startsWith('global-') && layer.id.includes('label'))
    .forEach((layer) => {
      setPaint(map, layer.id, 'text-color', colors.label);
      setPaint(map, layer.id, 'text-halo-color', colors.halo);
    });
}

function applyHillshadeDirection(map: MapLibreMap, azimuth: number) {
  setPaint(map, 'terrain-hillshade', 'hillshade-illumination-direction', ((azimuth % 360) + 360) % 360);
}

function applyBuildingShadows(map: MapLibreMap, appearance: DayNightAppearance) {
  // Match the offset to the outline width so it still overlaps the footprint.
  const scale = Math.min(1, Math.max(0.45, 0.45 + (map.getZoom() - 13) * 0.275));
  setPaint(map, 'global-building-shadow', 'line-translate',
    appearance.buildingShadowTranslate.map((offset) => offset * scale));
  const night = nightFactor(appearance.elevation);
  const opacity = [
    'interpolate', ['linear'], ['zoom'],
    13, 0,
    13.5, appearance.buildingShadowOpacity * (0.7 + (1 - night) * 0.3),
    18, appearance.buildingShadowOpacity * (1.4 + (1 - night) * 0.6),
  ];
  setPaint(map, 'global-building-shadow', 'line-opacity', opacity);
}

function captureLighting(map: MapLibreMap) {
  if (capturedLighting.has(map)) return;
  capturedLighting.set(map, {
    sky: map.getSky ? map.getSky() : undefined,
    light: map.getLight ? map.getLight() : undefined,
  });
}

export function applyDayNightStyle(map: MapLibreMap, appearance: DayNightAppearance, buildingColorsEnabled = true) {
  captureLighting(map);
  const styleMix = localStyleMix(map.getZoom());
  const night = nightFactor(appearance.elevation);
  const wantPalette = styleMix >= 0.03 && !(night < 0.08 && appearance.elevation > 10);
  if (!wantPalette) {
    const currentMode = paintMode.get(map);
    if (currentMode?.palette !== false || currentMode.buildingColorsEnabled !== buildingColorsEnabled) {
      applyMapTheme(map, 'light', { refresh: false });
      applyBuildingPalette(map, MAP_COLORS.building, MAP_COLORS.buildingBand, buildingColorsEnabled);
      paintMode.set(map, { palette: false, buildingColorsEnabled });
    }
  } else {
    applyPalette(map, appearance.palette, night, buildingColorsEnabled);
    paintMode.set(map, { palette: true, buildingColorsEnabled });
  }
  applyHillshadeDirection(map, appearance.azimuth);
  applyBuildingShadows(map, appearance);
  map.setLight({
    anchor: 'map',
    position: appearance.lightPosition,
    color: appearance.palette.sun,
    intensity: appearance.lightIntensity,
  });
  map.setSky({
    'sky-color': appearance.palette.sky,
    'horizon-color': appearance.palette.horizon,
    'fog-color': appearance.palette.fog,
    'sky-horizon-blend': 0.62 + night * 0.16,
    'horizon-fog-blend': 0.55 + (1 - night) * 0.45,
    'fog-ground-blend': 0.68,
    'atmosphere-blend': appearance.atmosphereBlend,
  });
}

export function restoreDayNightStyle(map: MapLibreMap, theme: 'light' | 'dark') {
  const captured = capturedLighting.get(map);
  applyMapTheme(map, theme);
  setPaint(map, 'global-building-shadow', 'line-translate', CARTOON_BUILDING_SHADOW_TRANSLATE);
  setPaint(map, 'terrain-hillshade', 'hillshade-illumination-direction', 225);
  setPaint(map, 'global-building-shadow', 'line-color', theme === 'dark' ? '#061322' : CARTOON_SHADOW_COLOR);
  map.setLight(captured?.light ?? {
    anchor: 'map',
    position: CARTOON_MAP_LIGHT_POSITION,
    color: CARTOON_SUN_COLOR,
    intensity: 0.34,
  });
  map.setSky(captured?.sky ?? DAYLIGHT_SKY);
  paintMode.delete(map);
}
