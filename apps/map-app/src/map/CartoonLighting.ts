// One deliberately simple sun model keeps MapLibre extrusions and Three.js
// models in the same diorama. Map anchoring makes the lit side of an object
// stable while the camera rotates.
export const CARTOON_SUN_AZIMUTH_DEGREES = 225;
export const CARTOON_SUN_POLAR_DEGREES = 35;
export const CARTOON_SUN_COLOR = '#fff2d6';
export const CARTOON_AMBIENT_SKY_COLOR = 0xfff4df;
export const CARTOON_AMBIENT_GROUND_COLOR = 0x7c8878;
export const CARTOON_SHADOW_COLOR = '#46534d';

export const CARTOON_MAP_LIGHT_POSITION: [number, number, number] = [
  1.25,
  CARTOON_SUN_AZIMUTH_DEGREES,
  CARTOON_SUN_POLAR_DEGREES,
];

// Keep the inexpensive footprint shadows centered. They read as soft ambient
// occlusion and remain coherent with the circular shadows under model trees.
export const CARTOON_BUILDING_SHADOW_TRANSLATE: [number, number] = [0, 0];
