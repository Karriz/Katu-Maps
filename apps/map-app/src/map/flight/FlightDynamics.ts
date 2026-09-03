export const FLIGHT_MIN_CLEARANCE_METERS = 20;
export const FLIGHT_CRUISE_SPEED_METERS_PER_SECOND = 110;
export const FLIGHT_STALL_SPEED_METERS_PER_SECOND = 42;
export const FLIGHT_MAX_SPEED_METERS_PER_SECOND = 160;
export const FLIGHT_MIN_SPEED_METERS_PER_SECOND = 18;

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_FRAME_SECONDS = 0.05;
const MAX_LATITUDE = 85;
const PITCH_RATE_RADIANS_PER_SECOND = degreesToRadians(36);
const ROLL_RATE_RADIANS_PER_SECOND = degreesToRadians(120);
const MAX_COORDINATED_TURN_BANK_RADIANS = degreesToRadians(70);
const GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665;
const MAX_THRUST_ACCELERATION = 25;
const THROTTLE_CHANGE_RATE = 0.5;
const CAMERA_POSITION_FOLLOW_RATE = 12;
const CAMERA_ORIENTATION_FOLLOW_RATE = 6.5;
const CAMERA_CHASE_DISTANCE_METERS = 58;
const CAMERA_LOOK_AHEAD_METERS = 30;
const CAMERA_CLIMB_LOOK_AHEAD_METERS = 8;
const CAMERA_CHASE_HEIGHT_METERS = 22;
const CAMERA_LOOK_HEIGHT_METERS = 4;
const CAMERA_BANK_OFFSET_METERS = 16;
const CAMERA_MAX_TERRAIN_PITCH_RADIANS = degreesToRadians(85);
const CAMERA_ADAPTIVE_CLIMB_START_RADIANS = degreesToRadians(5);
const CAMERA_ADAPTIVE_CLIMB_END_RADIANS = degreesToRadians(20);

export type FlightState = {
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  isStalling: boolean;
};

export type FlightInput = {
  pitch: number;
  roll: number;
  throttle: number;
};

export type FlightCameraRig = {
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
};

export type FlightCameraPose = {
  from: [number, number];
  fromAltitude: number;
  target: [number, number];
  targetAltitude: number;
  bearing: number;
  roll: number;
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

export function wrapSignedRadians(value: number) {
  const wrapped = wrapRadians(value + Math.PI) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
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
    throttle: 0.75,
    isStalling: false,
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

  // Throttle adjustments
  const throttle = clamp(
    state.throttle + clamp(input.throttle, -1, 1) * THROTTLE_CHANGE_RATE * deltaSeconds,
    0,
    1,
  );

  // Body angular rates: q = body pitch (W/S), p = body roll (A/D), r = coordinated yaw
  const q = clamp(input.pitch, -1, 1) * PITCH_RATE_RADIANS_PER_SECOND;
  const p = clamp(input.roll, -1, 1) * ROLL_RATE_RADIANS_PER_SECOND;
  const r = (GRAVITY_METERS_PER_SECOND_SQUARED
    * Math.tan(MAX_COORDINATED_TURN_BANK_RADIANS)
    * Math.sin(state.roll))
    / Math.max(1, state.speed);

  // Transform body rates into Euler angle rates (pitch, heading, roll)
  const cosRoll = Math.cos(state.roll);
  const sinRoll = Math.sin(state.roll);
  const rawCosPitch = Math.cos(state.pitch);
  // Euler rates are singular at ±90°. Bound the denominator without
  // discarding its sign so inverted flight turns in the correct direction.
  const cosPitch = Math.abs(rawCosPitch) < 0.05
    ? Math.sign(rawCosPitch || 1) * 0.05
    : rawCosPitch;
  const tanPitch = clamp(Math.tan(state.pitch), -10, 10);

  const pitchRate = q * cosRoll - r * sinRoll;
  const headingRate = (q * sinRoll + r * cosRoll) / cosPitch;
  const rollRate = p + (q * sinRoll + r * cosRoll) * tanPitch;

  const pitch = wrapSignedRadians(state.pitch + pitchRate * deltaSeconds);
  const roll = wrapSignedRadians(state.roll + rollRate * deltaSeconds);
  const heading = wrapRadians(state.heading + headingRate * deltaSeconds);

  // Airspeed calculations (Thrust, Gravity/Pitch exchange, Drag)
  const thrustAcc = throttle * MAX_THRUST_ACCELERATION;
  const cruiseDragEquilibrium = 0.75 * MAX_THRUST_ACCELERATION;
  const speedRatio = state.speed / FLIGHT_CRUISE_SPEED_METERS_PER_SECOND;
  const parasiteDrag = (speedRatio ** 2) * cruiseDragEquilibrium;
  const inducedDrag = Math.abs(Math.sin(pitch)) * 3 + (1 - Math.abs(Math.cos(roll))) * 3;
  const gravitySpeedAcc = -GRAVITY_METERS_PER_SECOND_SQUARED * Math.sin(pitch);
  const netAcceleration = thrustAcc - parasiteDrag - inducedDrag + gravitySpeedAcc;

  const speed = clamp(
    state.speed + netAcceleration * deltaSeconds,
    FLIGHT_MIN_SPEED_METERS_PER_SECOND,
    FLIGHT_MAX_SPEED_METERS_PER_SECOND,
  );

  // Lift & Stall physics
  const liftFactor = Math.min(1.5, (speed / FLIGHT_CRUISE_SPEED_METERS_PER_SECOND) ** 2);
  const criticalAoAExceeded = pitch > degreesToRadians(28) && speedRatio < 0.7;
  const isStalling = speed < FLIGHT_STALL_SPEED_METERS_PER_SECOND || criticalAoAExceeded;

  let verticalSpeed: number;
  if (isStalling) {
    verticalSpeed = speed * Math.sin(pitch) - GRAVITY_METERS_PER_SECOND_SQUARED * (1 - liftFactor * 0.4);
  } else {
    const bankLiftPenalty = (Math.cos(roll) - 1) * GRAVITY_METERS_PER_SECOND_SQUARED * 0.45;
    verticalSpeed = speed * Math.sin(pitch) + bankLiftPenalty;
  }

  const horizontalDistance = speed * Math.cos(pitch) * deltaSeconds;
  const coordinate = offsetCoordinate(
    [state.longitude, state.latitude],
    Math.sin(heading) * horizontalDistance,
    Math.cos(heading) * horizontalDistance,
  );

  const altitude = Math.max(
    terrainElevation + FLIGHT_MIN_CLEARANCE_METERS,
    state.altitude + verticalSpeed * deltaSeconds,
  );

  return {
    longitude: coordinate[0],
    latitude: coordinate[1],
    altitude,
    heading,
    pitch,
    roll,
    speed,
    throttle,
    isStalling,
  };
}

export function smoothFlightCameraRig(
  previous: FlightCameraRig | null,
  state: FlightCameraRig,
  elapsedSeconds: number,
): FlightCameraRig {
  if (!previous) {
    return {
      longitude: state.longitude,
      latitude: state.latitude,
      altitude: state.altitude,
      heading: state.heading,
      pitch: state.pitch,
      roll: state.roll,
    };
  }
  const deltaSeconds = clamp(elapsedSeconds, 0, MAX_FRAME_SECONDS);
  if (deltaSeconds === 0) return previous;
  const follow = 1 - Math.exp(-CAMERA_POSITION_FOLLOW_RATE * deltaSeconds);
  const turn = 1 - Math.exp(-CAMERA_ORIENTATION_FOLLOW_RATE * deltaSeconds);
  return {
    longitude: wrapLongitude(
      previous.longitude + wrapLongitude(state.longitude - previous.longitude) * follow,
    ),
    latitude: previous.latitude + (state.latitude - previous.latitude) * follow,
    altitude: previous.altitude + (state.altitude - previous.altitude) * follow,
    heading: wrapRadians(previous.heading + wrapSignedRadians(state.heading - previous.heading) * turn),
    pitch: wrapSignedRadians(previous.pitch + wrapSignedRadians(state.pitch - previous.pitch) * turn),
    roll: wrapSignedRadians(previous.roll + wrapSignedRadians(state.roll - previous.roll) * turn),
  };
}

export function flightCameraPose(state: FlightCameraRig): FlightCameraPose {
  const coordinate: [number, number] = [state.longitude, state.latitude];
  const forwardEast = Math.sin(state.heading);
  const forwardNorth = Math.cos(state.heading);
  const rightEast = Math.cos(state.heading);
  const rightNorth = -Math.sin(state.heading);
  const sinPitch = Math.sin(state.pitch);
  const cosPitch = Math.cos(state.pitch);
  const bankOffset = Math.sin(state.roll) * CAMERA_BANK_OFFSET_METERS;
  const climbAdaptation = clamp(
    (sinPitch - Math.sin(CAMERA_ADAPTIVE_CLIMB_START_RADIANS))
      / (
        Math.sin(CAMERA_ADAPTIVE_CLIMB_END_RADIANS)
        - Math.sin(CAMERA_ADAPTIVE_CLIMB_START_RADIANS)
      ),
    0,
    1,
  );
  const lookAheadDistance = CAMERA_LOOK_AHEAD_METERS * (1 - climbAdaptation)
    + CAMERA_CLIMB_LOOK_AHEAD_METERS * climbAdaptation;
  const lookHeight = CAMERA_LOOK_HEIGHT_METERS * cosPitch * (1 - climbAdaptation);
  const targetAltitude = state.altitude
    + lookHeight
    + lookAheadDistance * sinPitch;
  const desiredFromAltitude = state.altitude
    + CAMERA_CHASE_HEIGHT_METERS * cosPitch
    - CAMERA_CHASE_DISTANCE_METERS * sinPitch;
  const cameraHorizontalDistance = Math.hypot(
    CAMERA_CHASE_DISTANCE_METERS + lookAheadDistance,
    bankOffset * 0.8,
  );
  const minimumTerrainDrop = cameraHorizontalDistance
    / Math.tan(CAMERA_MAX_TERRAIN_PITCH_RADIANS);
  const fromAltitude = Math.max(
    desiredFromAltitude,
    targetAltitude + minimumTerrainDrop,
  );
  return {
    from: offsetCoordinate(
      coordinate,
      -forwardEast * CAMERA_CHASE_DISTANCE_METERS + rightEast * bankOffset,
      -forwardNorth * CAMERA_CHASE_DISTANCE_METERS + rightNorth * bankOffset,
    ),
    fromAltitude,
    target: offsetCoordinate(
      coordinate,
      forwardEast * lookAheadDistance + rightEast * bankOffset * 0.2,
      forwardNorth * lookAheadDistance + rightNorth * bankOffset * 0.2,
    ),
    targetAltitude,
    bearing: radiansToDegrees(state.heading),
    roll: radiansToDegrees(state.roll),
  };
}

