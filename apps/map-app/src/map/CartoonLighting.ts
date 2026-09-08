import { MAP_COLORS } from './MapPalette';

// One deliberately simple sun model keeps MapLibre extrusions and Three.js
// models in the same diorama. Map anchoring makes the lit side of an object
// stable while the camera rotates.
export const CARTOON_SUN_AZIMUTH_DEGREES = 225;
export const CARTOON_SUN_POLAR_DEGREES = 35;
export const CARTOON_SUN_COLOR = MAP_COLORS.sun;
export const CARTOON_AMBIENT_SKY_COLOR = MAP_COLORS.ambientSky;
export const CARTOON_AMBIENT_GROUND_COLOR = MAP_COLORS.ambientGround;
export const CARTOON_SHADOW_COLOR = MAP_COLORS.shadow;
export const CARTOON_NIGHT_SHADOW_COLOR = '#081522';
// Shared balance for Three.js models: a softer sun keeps faceted trees and
// bridge walls from becoming much darker than MapLibre building faces.
export const CARTOON_AMBIENT_BASE_INTENSITY = 0.7;
export const CARTOON_AMBIENT_DAY_INTENSITY = 1.35;
export const CARTOON_SUN_BASE_INTENSITY = 0.45;
export const CARTOON_SUN_DAY_INTENSITY = 1.65;

export const CARTOON_MAP_LIGHT_POSITION: [number, number, number] = [
  1.25,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_POLAR_DEGREES,
];

// A small map-anchored offset gives buildings direction while the separate
// contact line keeps their bases visually attached to the ground.
export const CARTOON_BUILDING_SHADOW_TRANSLATE: [number, number] = [1.4, -1.4];

export function sunCartesian(
  azimuthDegrees: number,
  polarDegrees: number,
  distance = 140,
) {
  const azimuth = azimuthDegrees * Math.PI / 180;
  const polar = polarDegrees * Math.PI / 180;
  const horizontal = Math.sin(polar) * distance;
  return {
    x: Math.sin(azimuth) * horizontal,
    y: Math.cos(polar) * distance,
    z: Math.cos(azimuth) * horizontal,
  };
}
