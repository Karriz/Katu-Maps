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
export const BUILDING_PASTEL_MIX = 0.72;

function rgbToHsl(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: hue, s: saturation, l: lightness };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const huePrime = h / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (huePrime < 1) [red, green, blue] = [chroma, x, 0];
  else if (huePrime < 2) [red, green, blue] = [x, chroma, 0];
  else if (huePrime < 3) [red, green, blue] = [0, chroma, x];
  else if (huePrime < 4) [red, green, blue] = [0, x, chroma];
  else if (huePrime < 5) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];
  const match = l - chroma / 2;
  return [
    Math.round((red + match) * 255),
    Math.round((green + match) * 255),
    Math.round((blue + match) * 255),
  ];
}

export function pastelizeBuildingHex(
  hex: number,
  ivoryHex = MAP_COLORS.building,
) {
  const hsl = rgbToHsl((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
  const [softR, softG, softB] = hslToRgb(
    hsl.h,
    Math.min(hsl.s, 0.24),
    Math.min(0.9, Math.max(hsl.l, 0.78)),
  );
  const ivory = Number.parseInt(ivoryHex.replace('#', ''), 16);
  const unify = 0.28;
  const mixChannel = (from: number, to: number) => Math.round(from + (to - from) * unify);
  const r = mixChannel(softR, (ivory >> 16) & 255);
  const g = mixChannel(softG, (ivory >> 8) & 255);
  const b = mixChannel(softB, ivory & 255);
  return (r << 16) | (g << 8) | b;
}
