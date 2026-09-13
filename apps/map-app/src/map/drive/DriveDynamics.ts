/** Contact height from model origin down to the tyre plane. */
export const DRIVE_WHEEL_CONTACT_OFFSET_METERS = 0.55;
export const DRIVE_MIN_CLEARANCE_METERS = 4;
export const DRIVE_MAX_SPEED_METERS_PER_SECOND = 42;
export const DRIVE_REVERSE_MAX_SPEED_METERS_PER_SECOND = 12;
export const DRIVE_CAR_LENGTH_METERS = 4.4;
/** Half-length of the ahead/behind DEM baseline used for pitch (metres). */
export const DRIVE_PITCH_SAMPLE_DISTANCE_METERS = 12;
/** Half-width of the left/right DEM baseline used for bank (metres). */
export const DRIVE_ROLL_SAMPLE_DISTANCE_METERS = 8;
/** Half-track width used for rear tyre mark placement (metres). */
export const DRIVE_TRACK_HALF_WIDTH_METERS = 0.85;
/** Rear axle offset behind the model origin along body forward (metres). */
export const DRIVE_REAR_AXLE_OFFSET_METERS = -1.25;
/** Lateral slip (m/s) above which tyre marks start to deposit. */
export const DRIVE_DRIFT_MARK_SPEED = 3.6;

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_FRAME_SECONDS = 0.05;
const MAX_LATITUDE = 85;
const MAX_THROTTLE_ACCELERATION = 13;
const BRAKE_DECELERATION = 22;
const HANDBRAKE_DECELERATION = 11;
const ROLLING_DRAG = 2.2;
const SPEED_DRAG = 0.035;
const REVERSE_ACCEL_FACTOR = 0.55;
/** Lateral velocity decay rate (1/s) when tyres have grip. */
const LATERAL_GRIP = 14;
const HANDBRAKE_LATERAL_GRIP = 2.6;
/** How quickly heading yaw tracks the steering target (1/s). */
const YAW_RESPONSE = 8;
const HANDBRAKE_YAW_RESPONSE = 5.5;
const MAX_STEER_YAW_RATE = degreesToRadians(78);
const HANDBRAKE_MAX_STEER_YAW_RATE = degreesToRadians(100);
const STEER_FULL_AUTHORITY_SPEED = 7;
const HIGH_SPEED_STEER_FACTOR = 0.58;
/**
 * Extra spin from sliding sideways. Strong enough that committed high-speed
 * turns can break loose; straight throttle still needs real slip (deadzone).
 */
const SLIP_YAW_GAIN = 0.048;
const HANDBRAKE_SLIP_YAW_GAIN = 0.085;
/** Ignore micro-slip below this when converting slide into yaw (m/s). */
const SLIP_YAW_DEADZONE = 0.85;
const YAW_DAMPING = 2.8;
const GRIP_YAW_DAMPING = 5.8;
const MAX_YAW_RATE = degreesToRadians(180);
const YAW_RATE_SLEEP = degreesToRadians(0.35);
const MAX_ROLL_RADIANS = degreesToRadians(22);
/** Slip lean — kept modest so drifts read without tipping the car over. */
const ROLL_FROM_LATERAL = 0.018;
const ROLL_FOLLOW_RATE = 9;
const GROUND_ROLL_FOLLOW_RATE = 5.5;
const CAMERA_POSITION_FOLLOW_RATE = 14;
const CAMERA_ORIENTATION_FOLLOW_RATE = 8;
const CAMERA_CHASE_DISTANCE_METERS = 14;
const CAMERA_LOOK_AHEAD_METERS = 10;
const CAMERA_CHASE_HEIGHT_METERS = 5.5;
const CAMERA_LOOK_HEIGHT_METERS = 1.2;
const MAX_PITCH_RADIANS = degreesToRadians(18);
/** Follow rates for DEM noise suppression — slower when nearly stopped. */
const GROUND_ELEVATION_FOLLOW_RATE = 7;
const GROUND_PITCH_FOLLOW_RATE = 5.5;
const GROUND_FOLLOW_MIN_BLEND = 0.28;
const GROUND_FOLLOW_FULL_SPEED = 10;
/**
 * Deck / kerb steps larger than DEM noise. Snap onto these so bridge mounts
 * are not eased through the span over several frames.
 */
const GROUND_ELEVATION_STEP_METERS = 1.25;
/** Tighter than transit default so underpasses do not mount from a glancing heading. */
export const DRIVE_DECK_MAX_HEADING_DIFF_RADIANS = Math.PI / 5;
/** Require sustained roadway hits before snapping up onto a deck. */
export const DRIVE_DECK_MOUNT_CONFIRM_SECONDS = 0.16;

export type DriveState = {
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
  /** Body-forward speed (m/s); negative = reverse. */
  speed: number;
  velocityEast: number;
  velocityNorth: number;
  yawRate: number;
  throttle: number;
  /** 0..1 sideways slip used for VFX / tyre marks. */
  drift: number;
};

export type DriveInput = {
  /** -1 left … +1 right */
  steer: number;
  /** +1 accelerate … -1 brake / reverse */
  throttle: number;
  /** 0 released … 1 held */
  handbrake: number;
};

export type DriveCameraRig = {
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
};

export type DriveCameraPose = {
  from: [number, number];
  fromAltitude: number;
  target: [number, number];
  targetAltitude: number;
  bearing: number;
  roll: number;
};

export type DriveGroundSample = {
  elevation: number;
  pitch: number;
  roll: number;
  /** True when the elevation comes from a bridge roadway placement. */
  onDeck?: boolean;
  /** DEM / terrain height ignoring bridge decks. */
  terrainElevation?: number;
};

export type DriveTireContact = {
  longitude: number;
  latitude: number;
  altitude: number;
  intensity: number;
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

export function createInitialDriveState(
  coordinate: [number, number],
  terrainElevation: number,
  headingDegrees: number,
): DriveState {
  return {
    longitude: wrapLongitude(coordinate[0]),
    latitude: clamp(coordinate[1], -MAX_LATITUDE, MAX_LATITUDE),
    altitude: terrainElevation + DRIVE_WHEEL_CONTACT_OFFSET_METERS,
    heading: wrapRadians(degreesToRadians(headingDegrees)),
    pitch: 0,
    roll: 0,
    speed: 0,
    velocityEast: 0,
    velocityNorth: 0,
    yawRate: 0,
    throttle: 0,
    drift: 0,
  };
}

/** Prefer travel direction for deck on/under checks once moving. */
export function driveTravelHeading(state: {
  heading: number;
  velocityEast: number;
  velocityNorth: number;
}) {
  const speed = Math.hypot(state.velocityEast, state.velocityNorth);
  if (speed < 1.5) return state.heading;
  return Math.atan2(state.velocityEast, state.velocityNorth);
}

/** Rear tyre ground contacts while sliding hard enough to leave marks. */
export function driveRearTireContacts(state: DriveState): [DriveTireContact, DriveTireContact] | null {
  if (state.drift < 0.12) return null;
  const sinHeading = Math.sin(state.heading);
  const cosHeading = Math.cos(state.heading);
  const axle = DRIVE_REAR_AXLE_OFFSET_METERS;
  const intensity = state.drift;
  const contacts = ([-1, 1] as const).map((side) => {
    const right = side * DRIVE_TRACK_HALF_WIDTH_METERS;
    const east = sinHeading * axle + cosHeading * right;
    const north = cosHeading * axle - sinHeading * right;
    const [longitude, latitude] = offsetCoordinate(
      [state.longitude, state.latitude],
      east,
      north,
    );
    return {
      longitude,
      latitude,
      altitude: state.altitude - DRIVE_WHEEL_CONTACT_OFFSET_METERS + 0.04,
      intensity,
    };
  });
  return [contacts[0], contacts[1]];
}

export function advanceDrive(
  state: DriveState,
  input: DriveInput,
  elapsedSeconds: number,
  ground: DriveGroundSample,
): DriveState {
  const deltaSeconds = clamp(elapsedSeconds, 0, MAX_FRAME_SECONDS);
  if (deltaSeconds === 0) return state;

  const throttleInput = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);
  const handbrake = clamp(input.handbrake, 0, 1);
  const throttle = clamp(state.throttle + throttleInput * 1.8 * deltaSeconds, 0, 1);

  const sinHeading = Math.sin(state.heading);
  const cosHeading = Math.cos(state.heading);
  let forward = state.velocityEast * sinHeading + state.velocityNorth * cosHeading;
  let lateral = state.velocityEast * cosHeading - state.velocityNorth * sinHeading;

  if (throttleInput > 0.05) {
    const headroom = 1 - Math.max(0, forward) / DRIVE_MAX_SPEED_METERS_PER_SECOND;
    forward += throttleInput * MAX_THROTTLE_ACCELERATION * Math.max(0, headroom) * deltaSeconds;
  } else if (throttleInput < -0.05) {
    if (forward > 0.35) {
      forward -= Math.abs(throttleInput) * BRAKE_DECELERATION * deltaSeconds;
    } else {
      const reverseHeadroom = 1 - Math.max(0, -forward) / DRIVE_REVERSE_MAX_SPEED_METERS_PER_SECOND;
      forward -= Math.abs(throttleInput) * MAX_THROTTLE_ACCELERATION * REVERSE_ACCEL_FACTOR
        * Math.max(0, reverseHeadroom) * deltaSeconds;
    }
  }

  if (handbrake > 0.05 && Math.abs(forward) > 0.2) {
    const brake = handbrake * HANDBRAKE_DECELERATION * deltaSeconds;
    if (Math.abs(forward) <= brake) forward = 0;
    else forward -= Math.sign(forward) * brake;
  }

  const speedAlongBody = Math.abs(forward);
  const drag = ROLLING_DRAG + speedAlongBody * SPEED_DRAG * speedAlongBody;
  if (Math.abs(throttleInput) <= 0.05 && handbrake < 0.05) {
    if (Math.abs(forward) <= drag * deltaSeconds) forward = 0;
    else forward -= Math.sign(forward) * drag * deltaSeconds;
  }

  forward = clamp(
    forward,
    -DRIVE_REVERSE_MAX_SPEED_METERS_PER_SECOND,
    DRIVE_MAX_SPEED_METERS_PER_SECOND,
  );

  const speedAuthority = clamp(Math.abs(forward) / STEER_FULL_AUTHORITY_SPEED, 0, 1);
  const highSpeedBlend = clamp(
    (Math.abs(forward) - STEER_FULL_AUTHORITY_SPEED)
      / (DRIVE_MAX_SPEED_METERS_PER_SECOND - STEER_FULL_AUTHORITY_SPEED),
    0,
    1,
  );
  const steerLoad = Math.min(1, Math.abs(steer));
  // Planted when straight; shed grip under steering load so fast corners slide.
  const cornerGrip = LATERAL_GRIP * (1 - steerLoad * 0.55 * Math.max(speedAuthority, highSpeedBlend));
  const grip = cornerGrip + (HANDBRAKE_LATERAL_GRIP - cornerGrip) * handbrake;
  lateral *= Math.exp(-grip * deltaSeconds);

  const steerAuthority = speedAuthority * (1 - highSpeedBlend * (1 - HIGH_SPEED_STEER_FACTOR));
  const maxYaw = MAX_STEER_YAW_RATE
    + (HANDBRAKE_MAX_STEER_YAW_RATE - MAX_STEER_YAW_RATE) * handbrake;
  // Reverse steering feels mirrored so the rear still follows the wheel.
  const steerSign = forward >= -0.35 ? 1 : -1;
  const targetYawRate = steer * steerSign * steerAuthority * maxYaw;
  const yawFollow = YAW_RESPONSE + (HANDBRAKE_YAW_RESPONSE - YAW_RESPONSE) * handbrake;
  let yawRate = state.yawRate
    + (targetYawRate - state.yawRate) * (1 - Math.exp(-yawFollow * deltaSeconds));

  const slipYawGain = SLIP_YAW_GAIN + (HANDBRAKE_SLIP_YAW_GAIN - SLIP_YAW_GAIN) * handbrake;
  const slipForYaw = Math.max(0, Math.abs(lateral) - SLIP_YAW_DEADZONE * (1 - steerLoad * 0.5));
  yawRate += -Math.sign(lateral || 1) * slipForYaw * slipYawGain;
  const yawDamping = YAW_DAMPING + (1 - handbrake) * (1 - steerLoad) * GRIP_YAW_DAMPING;
  yawRate *= Math.exp(-yawDamping * deltaSeconds);
  if (Math.abs(yawRate) < YAW_RATE_SLEEP && Math.abs(steer) < 0.05 && handbrake < 0.05) {
    yawRate = 0;
  }
  yawRate = clamp(yawRate, -MAX_YAW_RATE, MAX_YAW_RATE);

  // Keep world velocity through the yaw step so turning creates inertial slip.
  const velocityEast = forward * sinHeading + lateral * cosHeading;
  const velocityNorth = forward * cosHeading - lateral * sinHeading;
  const heading = wrapRadians(state.heading + yawRate * deltaSeconds);
  const nextSin = Math.sin(heading);
  const nextCos = Math.cos(heading);
  const bodyForward = velocityEast * nextSin + velocityNorth * nextCos;
  const bodyLateral = velocityEast * nextCos - velocityNorth * nextSin;

  const coordinate = offsetCoordinate(
    [state.longitude, state.latitude],
    velocityEast * deltaSeconds,
    velocityNorth * deltaSeconds,
  );

  const planarSpeed = Math.hypot(velocityEast, velocityNorth);
  const speedBlend = GROUND_FOLLOW_MIN_BLEND
    + (1 - GROUND_FOLLOW_MIN_BLEND)
      * clamp(planarSpeed / GROUND_FOLLOW_FULL_SPEED, 0, 1);
  const elevationFollow = 1 - Math.exp(-GROUND_ELEVATION_FOLLOW_RATE * speedBlend * deltaSeconds);
  const pitchFollow = 1 - Math.exp(-GROUND_PITCH_FOLLOW_RATE * speedBlend * deltaSeconds);
  const targetAltitude = ground.elevation + DRIVE_WHEEL_CONTACT_OFFSET_METERS;
  const targetPitch = clamp(ground.pitch, -MAX_PITCH_RADIANS, MAX_PITCH_RADIANS);
  const elevationError = Math.abs(targetAltitude - state.altitude);
  // Bridge decks and similar hard steps must land immediately; easing here is
  // what made the car drive through the span at terrain height.
  const altitude = elevationError >= GROUND_ELEVATION_STEP_METERS
    ? targetAltitude
    : state.altitude + (targetAltitude - state.altitude) * elevationFollow;
  const pitch = wrapSignedRadians(
    state.pitch + wrapSignedRadians(targetPitch - state.pitch) * pitchFollow,
  );

  // Lean toward the velocity vector (into the slide), not away from it.
  // DriveModelLayer applies -roll on Z, so positive roll here tips the body
  // toward +bodyLateral (rightward travel relative to the nose).
  // Ground bank is sampled left/right so the car also sits on side slopes.
  const slipRoll = bodyLateral * ROLL_FROM_LATERAL;
  const groundRoll = clamp(ground.roll, -MAX_ROLL_RADIANS, MAX_ROLL_RADIANS);
  const targetRoll = clamp(groundRoll + slipRoll, -MAX_ROLL_RADIANS, MAX_ROLL_RADIANS);
  const rollFollow = 1 - Math.exp(
    -(ROLL_FOLLOW_RATE * 0.55 + GROUND_ROLL_FOLLOW_RATE * speedBlend) * deltaSeconds,
  );
  const roll = wrapSignedRadians(
    state.roll + wrapSignedRadians(targetRoll - state.roll) * rollFollow,
  );

  const slipRatio = Math.abs(bodyLateral) / Math.max(3.5, planarSpeed);
  const drift = clamp(
    slipRatio * 1.6
      + Math.max(0, Math.abs(bodyLateral) - DRIVE_DRIFT_MARK_SPEED * 0.45)
        / (DRIVE_DRIFT_MARK_SPEED * 1.8)
      + handbrake * speedAuthority * Math.abs(steer) * 0.25,
    0,
    1,
  );

  return {
    longitude: coordinate[0],
    latitude: coordinate[1],
    altitude,
    heading,
    pitch,
    roll,
    speed: bodyForward,
    velocityEast,
    velocityNorth,
    yawRate,
    throttle: throttleInput > 0.05
      ? Math.max(throttle, throttleInput)
      : Math.max(0, throttle - 1.2 * deltaSeconds),
    drift,
  };
}

export function smoothDriveCameraRig(
  previous: DriveCameraRig | null,
  state: DriveCameraRig,
  elapsedSeconds: number,
): DriveCameraRig {
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

export function driveCameraPose(state: DriveCameraRig): DriveCameraPose {
  const coordinate: [number, number] = [state.longitude, state.latitude];
  const sinHeading = Math.sin(state.heading);
  const cosHeading = Math.cos(state.heading);
  const sinPitch = Math.sin(state.pitch);
  const cosPitch = Math.cos(state.pitch);

  const forwardEast = sinHeading * cosPitch;
  const forwardNorth = cosHeading * cosPitch;
  const forwardUp = sinPitch;
  const upEast = -sinHeading * sinPitch;
  const upNorth = -cosHeading * sinPitch;
  const upUp = cosPitch;

  const fromEast = -forwardEast * CAMERA_CHASE_DISTANCE_METERS
    + upEast * CAMERA_CHASE_HEIGHT_METERS;
  const fromNorth = -forwardNorth * CAMERA_CHASE_DISTANCE_METERS
    + upNorth * CAMERA_CHASE_HEIGHT_METERS;
  const fromUp = -forwardUp * CAMERA_CHASE_DISTANCE_METERS
    + upUp * CAMERA_CHASE_HEIGHT_METERS;
  const targetEast = forwardEast * CAMERA_LOOK_AHEAD_METERS
    + upEast * CAMERA_LOOK_HEIGHT_METERS;
  const targetNorth = forwardNorth * CAMERA_LOOK_AHEAD_METERS
    + upNorth * CAMERA_LOOK_HEIGHT_METERS;
  const targetUp = forwardUp * CAMERA_LOOK_AHEAD_METERS
    + upUp * CAMERA_LOOK_HEIGHT_METERS;

  return {
    from: offsetCoordinate(coordinate, fromEast, fromNorth),
    fromAltitude: state.altitude + fromUp,
    target: offsetCoordinate(coordinate, targetEast, targetNorth),
    targetAltitude: state.altitude + targetUp,
    bearing: radiansToDegrees(state.heading),
    roll: radiansToDegrees(state.roll),
  };
}
