export const FLIGHT_MIN_CLEARANCE_METERS = 20;
export const FLIGHT_CRUISE_SPEED_METERS_PER_SECOND = 55;

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_FRAME_SECONDS = 0.05;
const MAX_LATITUDE = 85;
const MAX_PITCH_RADIANS = degreesToRadians(20);
const MAX_ROLL_RADIANS = degreesToRadians(45);
const PITCH_RESPONSE = 3.4;
const ROLL_RESPONSE = 4.6;
const GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665;

export type FlightState = {
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
};

export type FlightInput = {
  pitch: number;
  roll: number;
};

export type FlightCameraPose = {
  from: [number, number];
  fromAltitude: number;
  target: [number, number];
  targetAltitude: number;
};

export function degreesToRadians(degrees: number) {
  return degrees * Math.PI / 180;
}

export function radiansToDegrees(radians: number) {
  return radians * 180 / Math.PI;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapRadians(value: number) {
  const wrapped = value % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}

function wrapLongitude(value: number) {
  return ((value + 540) % 360) - 180;
}

/** Move a geographic coordinate by local east/north distances in metres. */
export function offsetCoordinate(
  coordinate: [number, number],
  eastMeters: number,
  northMeters: number,
): [number, number] {
  const latitudeRadians = degreesToRadians(coordinate[1]);
  const latitude = coordinate[1] + radiansToDegrees(northMeters / EARTH_RADIUS_METERS);
  const longitudeScale = Math.max(0.01, Math.cos(latitudeRadians));
  const longitude = coordinate[0]
    + radiansToDegrees(eastMeters / (EARTH_RADIUS_METERS * longitudeScale));
  return [wrapLongitude(longitude), clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE)];
}

export function createInitialFlightState(
  coordinate: [number, number],
  terrainElevation: number,
  headingDegrees: number,
): FlightState {
  return {
    longitude: wrapLongitude(coordinate[0]),
    latitude: clamp(coordinate[1], -MAX_LATITUDE, MAX_LATITUDE),
    altitude: terrainElevation + 180,
    heading: wrapRadians(degreesToRadians(headingDegrees)),
    pitch: 0,
    roll: 0,
    speed: FLIGHT_CRUISE_SPEED_METERS_PER_SECOND,
  };
}

export function advanceFlight(
  state: FlightState,
  input: FlightInput,
  elapsedSeconds: number,
  terrainElevation: number,
): FlightState {
  const deltaSeconds = clamp(elapsedSeconds, 0, MAX_FRAME_SECONDS);
  if (deltaSeconds === 0) return state;

  const targetPitch = clamp(input.pitch, -1, 1) * MAX_PITCH_RADIANS;
  const targetRoll = clamp(input.roll, -1, 1) * MAX_ROLL_RADIANS;
  const pitchAmount = 1 - Math.exp(-PITCH_RESPONSE * deltaSeconds);
  const rollAmount = 1 - Math.exp(-ROLL_RESPONSE * deltaSeconds);
  const pitch = state.pitch + (targetPitch - state.pitch) * pitchAmount;
  const roll = state.roll + (targetRoll - state.roll) * rollAmount;

  // A coordinated turn is enough to make banking feel aircraft-like without
  // introducing a separate yaw control or a full aerodynamic simulation.
  const turnRate = GRAVITY_METERS_PER_SECOND_SQUARED * Math.tan(roll)
    / Math.max(1, state.speed);
  const heading = wrapRadians(state.heading + turnRate * deltaSeconds);
  const horizontalDistance = state.speed * Math.cos(pitch) * deltaSeconds;
  const coordinate = offsetCoordinate(
    [state.longitude, state.latitude],
    Math.sin(heading) * horizontalDistance,
    Math.cos(heading) * horizontalDistance,
  );
  const altitude = Math.max(
    terrainElevation + FLIGHT_MIN_CLEARANCE_METERS,
    state.altitude + state.speed * Math.sin(pitch) * deltaSeconds,
  );

  return {
    ...state,
    longitude: coordinate[0],
    latitude: coordinate[1],
    altitude,
    heading,
    pitch,
    roll,
  };
}

export function flightCameraPose(state: FlightState): FlightCameraPose {
  const coordinate: [number, number] = [state.longitude, state.latitude];
  const forwardEast = Math.sin(state.heading);
  const forwardNorth = Math.cos(state.heading);
  const chaseDistance = 82;
  const lookAheadDistance = 42;
  return {
    from: offsetCoordinate(
      coordinate,
      -forwardEast * chaseDistance,
      -forwardNorth * chaseDistance,
    ),
    fromAltitude: state.altitude + 28,
    target: offsetCoordinate(
      coordinate,
      forwardEast * lookAheadDistance,
      forwardNorth * lookAheadDistance,
    ),
    targetAltitude: state.altitude + Math.sin(state.pitch) * lookAheadDistance,
  };
}
