export const MAP_COLORS = {
  ground: '#c9e0b4',
  forest: '#a8c88c',
  scrub: '#bed49e',
  grass: '#cce4aa',
  meadow: '#d3e8ae',
  farmland: '#eee9b5',
  urban: '#e4e8dc',
  commercial: '#e9e9e0',
  industrial: '#e0e4dd',
  park: '#bfdda0',
  water: '#7fc4d6',
  waterEdge: '#5d9fb3',
  road: '#f7f5ee',
  roadCasing: '#adb8af',
  building: '#fffdf8',
  buildingAlt: '#f6f3ec',
  buildingBand: '#dedad1',
  label: '#30495b',
  labelHalo: '#fbfcf5',
  transitBlue: '#1769e8',
  trafficCamera: '#0f766e',
  roadWeather: '#0369a1',
  roadWeatherIce: '#0284c7',
  weather: '#0ea5e9',
  roadTraffic: '#dc2626',
  roadWork: '#ea580c',
  roadIncident: '#e11d48',
  chargingStation: '#059669',
  chargingOperational: '#059669',
  chargingLimited: '#d97706',
  chargingUnavailable: '#dc2626',
  chargingUnknown: '#64748b',
  sun: '#fff5dc',
  ambientSky: 0xfff7e8,
  ambientGround: 0x8a9b7f,
  shadow: '#4b5d52',
} as const;

/** Mix toward ivory for OSM-mapped building colours (0 = raw, 1 = ivory). */
export const BUILDING_PASTEL_MIX = 0.78;

export function pastelizeBuildingHex(
  hex: number,
  ivoryHex = MAP_COLORS.building,
  mix = BUILDING_PASTEL_MIX,
) {
  const t = Math.min(1, Math.max(0, mix));
  const ivory = Number.parseInt(ivoryHex.replace('#', ''), 16);
  const mixChannel = (from: number, to: number) => Math.round(from + (to - from) * t);
  const r = mixChannel((hex >> 16) & 255, (ivory >> 16) & 255);
  const g = mixChannel((hex >> 8) & 255, (ivory >> 8) & 255);
  const b = mixChannel(hex & 255, ivory & 255);
  return (r << 16) | (g << 8) | b;
}
