/**
 * Latitude-based climate proxy for procedural roof type selection.
 *
 * Hot regions (low absolute latitude) predominantly have flat roofs,
 * while cold regions (high absolute latitude, e.g. Finland) favour
 * pitched/gabled roofs for snow shedding. Temperate bands get a mix.
 */

export type RoofType = 'flat' | 'hipped' | 'pitched';

export type RoofClimateProfile = {
  type: RoofType;
  /** Roof pitch in degrees for non-flat roofs. */
  pitchDegrees: number;
  /**
   * Fraction of eligible buildings that get a procedural roof rather
   * than the default flat extrusion top. Even in pitched regions some
   * buildings (garages, sheds, commercial) are flat.
   */
  pitchedFraction: number;
};

/**
 * Map absolute latitude to a climate-based roof profile.
 *
 * Bands are intentionally coarse — this is a stylistic heuristic, not
 * an architectural model. The boundaries can be refined later.
 */
export function roofClimateForLatitude(latitude: number): RoofClimateProfile {
  const absLat = Math.abs(latitude);

  if (absLat < 23.5) {
    // Tropical / hot: almost entirely flat roofs.
    return { type: 'flat', pitchDegrees: 0, pitchedFraction: 0 };
  }

  if (absLat < 35) {
    // Subtropical / hot-arid: mostly flat, occasional low-pitch hipped.
    return { type: 'hipped', pitchDegrees: 18, pitchedFraction: 0.2 };
  }

  if (absLat < 45) {
    // Warm-temperate / Mediterranean: mix of hipped and flat.
    return { type: 'hipped', pitchDegrees: 25, pitchedFraction: 0.5 };
  }

  // Cold-temperate / boreal (Finland, Nordic, Canada, Russia):
  // predominantly pitched roofs for snow load.
  return { type: 'pitched', pitchDegrees: 35, pitchedFraction: 0.75 };
}
