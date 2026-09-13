import { describe, expect, it } from 'vitest';
import {
  DRIVE_MAX_SPEED_METERS_PER_SECOND,
  advanceDrive,
  createInitialDriveState,
  driveCameraPose,
  driveTravelHeading,
  driveRearTireContacts,
  smoothDriveCameraRig,
} from './DriveDynamics';
import {
  driveInputForControlSources,
  sampleDriveGround,
  setDriveControlSource,
  type DriveControlSources,
} from './useDriveSimulator';

const idleInput = { steer: 0, throttle: 0, handbrake: 0 };

describe('drive dynamics', () => {
  it('accelerates forward and turns with steer input', () => {
    let state = createInitialDriveState([23.7609, 61.4981], 40, 0);
    for (let index = 0; index < 40; index += 1) {
      state = advanceDrive(state, { steer: 1, throttle: 1, handbrake: 0 }, 0.05, {
        elevation: 40,
        pitch: 0,
        roll: 0,
        onDeck: false,
        terrainElevation: 40,
      });
    }
    expect(state.speed).toBeGreaterThan(8);
    expect(state.speed).toBeLessThanOrEqual(DRIVE_MAX_SPEED_METERS_PER_SECOND);
    expect(state.heading).toBeGreaterThan(0);
    expect(state.longitude).toBeGreaterThan(23.7609);
    expect(state.altitude).toBeCloseTo(40.55, 5);
  });

  it('brakes to a stop then reverses when holding reverse', () => {
    let state = {
      ...createInitialDriveState([0, 0], 0, 0),
      speed: 12,
      velocityNorth: 12,
      throttle: 0.6,
    };
    for (let index = 0; index < 50; index += 1) {
      state = advanceDrive(state, { steer: 0, throttle: -1, handbrake: 0 }, 0.05, {
        elevation: 0,
        pitch: 0,
        roll: 0,
      });
    }
    expect(state.speed).toBeLessThan(0);
    expect(state.velocityNorth).toBeLessThan(0);
  });

  it('uses travel direction once moving so body yaw alone cannot mount a deck', () => {
    expect(driveTravelHeading({
      heading: Math.PI / 2,
      velocityEast: 0,
      velocityNorth: 20,
    })).toBeCloseTo(0, 5);
    expect(driveTravelHeading({
      heading: Math.PI / 2,
      velocityEast: 0,
      velocityNorth: 0,
    })).toBeCloseTo(Math.PI / 2, 5);
  });

  it('stays stable under straight full throttle', () => {
    let state = createInitialDriveState([0, 0], 0, 0);
    for (let index = 0; index < 120; index += 1) {
      state = advanceDrive(state, { steer: 0, throttle: 1, handbrake: 0 }, 0.05, {
        elevation: 0,
        pitch: 0,
        roll: 0,
      });
    }
    expect(state.speed).toBeGreaterThan(20);
    expect(Math.abs(state.heading)).toBeLessThan(0.02);
    expect(Math.abs(state.velocityEast)).toBeLessThan(0.35);
    expect(state.drift).toBeLessThan(0.1);
  });

  it('can break loose when steering hard at speed without handbrake', () => {
    let state = {
      ...createInitialDriveState([0, 0], 0, 0),
      speed: 28,
      velocityNorth: 28,
      throttle: 1,
    };
    let peakDrift = 0;
    let peakLateral = 0;
    for (let index = 0; index < 30; index += 1) {
      state = advanceDrive(state, { steer: 1, throttle: 0.85, handbrake: 0 }, 0.05, {
        elevation: 0,
        pitch: 0,
        roll: 0,
      });
      peakDrift = Math.max(peakDrift, state.drift);
      const sin = Math.sin(state.heading);
      const cos = Math.cos(state.heading);
      const lateral = state.velocityEast * cos - state.velocityNorth * sin;
      peakLateral = Math.max(peakLateral, Math.abs(lateral));
    }
    expect(peakLateral).toBeGreaterThan(1.5);
    expect(peakDrift).toBeGreaterThan(0.15);
    expect(state.heading).toBeGreaterThan(0.4);
  });

  it('keeps sideways inertia so the car can drift', () => {
    let state = {
      ...createInitialDriveState([0, 0], 0, 0),
      speed: 20,
      velocityNorth: 20,
      throttle: 0.8,
    };
    let peakDrift = 0;
    let peakRoll = 0;
    for (let index = 0; index < 24; index += 1) {
      state = advanceDrive(state, { steer: 1, throttle: 0.4, handbrake: 1 }, 0.05, {
        elevation: 0,
        pitch: 0,
        roll: 0,
      });
      peakDrift = Math.max(peakDrift, state.drift);
      peakRoll = Math.max(peakRoll, Math.abs(state.roll));
    }
    expect(Math.abs(state.velocityEast)).toBeGreaterThan(0.6);
    expect(peakDrift).toBeGreaterThan(0.1);
    expect(peakRoll).toBeGreaterThan(0);
  });

  it('spins harder with handbrake than with grip steering alone', () => {
    let gripped = {
      ...createInitialDriveState([0, 0], 0, 0),
      speed: 22,
      velocityNorth: 22,
      throttle: 0.7,
    };
    let locked = { ...gripped };
    for (let index = 0; index < 18; index += 1) {
      gripped = advanceDrive(gripped, { steer: 1, throttle: 0.3, handbrake: 0 }, 0.05, {
        elevation: 0,
        pitch: 0,
        roll: 0,
      });
      locked = advanceDrive(locked, { steer: 1, throttle: 0.3, handbrake: 1 }, 0.05, {
        elevation: 0,
        pitch: 0,
        roll: 0,
      });
    }
    expect(locked.heading).toBeGreaterThan(gripped.heading);
    expect(locked.drift).toBeGreaterThan(gripped.drift);
  });

  it('exposes rear tyre contacts while drifting', () => {
    const state = {
      ...createInitialDriveState([0, 0], 10, 0),
      drift: 0.8,
    };
    const contacts = driveRearTireContacts(state);
    expect(contacts).not.toBeNull();
    expect(contacts![0].longitude).toBeLessThan(0);
    expect(contacts![1].longitude).toBeGreaterThan(0);
    expect(driveRearTireContacts({ ...state, drift: 0 })).toBeNull();
  });

  it('follows ground pitch and elevation samples', () => {
    const state = createInitialDriveState([0, 0], 10, 90);
    // Idle follow is intentionally slow so DEM noise does not pop the car.
    const next = advanceDrive(state, idleInput, 0.05, {
      elevation: 10.4,
      pitch: 0.1,
      roll: 0,
    });
    expect(next.altitude).toBeGreaterThan(state.altitude);
    expect(next.altitude).toBeLessThan(10.4 + 0.55);
    expect(next.pitch).toBeGreaterThan(0);
    expect(next.pitch).toBeLessThan(0.1);
  });

  it('snaps onto bridge-sized elevation steps instead of easing through them', () => {
    const state = createInitialDriveState([0, 0], 10, 0);
    const next = advanceDrive(state, idleInput, 0.05, {
      elevation: 18,
      pitch: 0,
      roll: 0,
    });
    expect(next.altitude).toBeCloseTo(18.55, 5);
  });

  it('banks with ground roll samples', () => {
    let state = createInitialDriveState([0, 0], 10, 0);
    for (let index = 0; index < 40; index += 1) {
      state = advanceDrive(state, idleInput, 0.05, {
        elevation: 10,
        pitch: 0,
        roll: 0.12,
      });
    }
    expect(state.roll).toBeGreaterThan(0.08);
    expect(state.roll).toBeLessThanOrEqual(0.12);
  });

  it('eases onto DEM samples instead of snapping each frame', () => {
    let state = {
      ...createInitialDriveState([0, 0], 10, 0),
      speed: 12,
      velocityNorth: 12,
      throttle: 0.5,
    };
    for (let index = 0; index < 40; index += 1) {
      state = advanceDrive(state, { steer: 0, throttle: 0.2, handbrake: 0 }, 0.05, {
        elevation: 10.8,
        pitch: 0.08,
        roll: 0,
      });
    }
    expect(state.altitude).toBeGreaterThan(10.55);
    expect(state.altitude).toBeLessThan(10.8 + 0.55 + 0.01);
    expect(state.pitch).toBeGreaterThan(0.05);
    expect(state.pitch).toBeLessThanOrEqual(0.08);
  });

  it('keeps the chase camera behind the car', () => {
    const pose = driveCameraPose({
      longitude: 0,
      latitude: 0,
      altitude: 10,
      heading: 0,
      pitch: 0,
      roll: 0,
    });
    expect(pose.from[1]).toBeLessThan(0);
    expect(pose.target[1]).toBeGreaterThan(0);
    expect(pose.fromAltitude).toBeGreaterThan(10);
  });

  it('smooths camera motion toward the car pose', () => {
    const previous = {
      longitude: 0,
      latitude: 0,
      altitude: 10,
      heading: 0,
      pitch: 0,
      roll: 0,
    };
    const smoothed = smoothDriveCameraRig(previous, {
      longitude: 0.01,
      latitude: 0.01,
      altitude: 12,
      heading: 1,
      pitch: 0.05,
      roll: 0,
    }, 0.05);
    expect(smoothed.longitude).toBeGreaterThan(0);
    expect(smoothed.longitude).toBeLessThan(0.01);
    expect(smoothed.heading).toBeGreaterThan(0);
    expect(smoothed.heading).toBeLessThan(1);
  });
});

describe('drive ground pitch', () => {
  it('pitches nose-up when the ground rises ahead', () => {
    const map = {
      queryTerrainElevation: (coordinate: [number, number]) => (
        coordinate[1] * 111_320 * 0.1
      ),
    };
    const ground = sampleDriveGround(map as any, 0, 0, 0, null, 0);
    expect(ground.pitch).toBeGreaterThan(0);
  });

  it('pitches nose-down when the ground falls ahead', () => {
    const map = {
      queryTerrainElevation: (coordinate: [number, number]) => (
        -coordinate[1] * 111_320 * 0.1
      ),
    };
    const ground = sampleDriveGround(map as any, 0, 0, 0, null, 0);
    expect(ground.pitch).toBeLessThan(0);
  });

  it('banks when the ground rises to the left', () => {
    const map = {
      queryTerrainElevation: (coordinate: [number, number]) => (
        // Heading 0: left is west (−lng).
        -coordinate[0] * 111_320 * 0.1
      ),
    };
    const ground = sampleDriveGround(map as any, 0, 0, 0, null, 0);
    expect(ground.roll).toBeGreaterThan(0);
  });

  it('banks the other way when the ground rises to the right', () => {
    const map = {
      queryTerrainElevation: (coordinate: [number, number]) => (
        coordinate[0] * 111_320 * 0.1
      ),
    };
    const ground = sampleDriveGround(map as any, 0, 0, 0, null, 0);
    expect(ground.roll).toBeLessThan(0);
  });

  it('rejects a shallow underpass heading that the default transit gate would accept', () => {
    const centerLng = 23.77;
    const centerLat = 61.5;
    const metresPerDegLat = (Math.PI / 180) * 6_378_137;
    const cosLat = Math.cos(centerLat * Math.PI / 180);
    const lngOff = (metres: number) => metres / (metresPerDegLat * cosLat);
    const bridge = {
      deckPlacementAt: (
        _lng: number,
        _lat: number,
        heading: number,
        maxHeadingDiffRadians = Math.PI / 3,
      ) => (
        Math.min(
          Math.abs(heading),
          Math.abs(Math.abs(heading) - Math.PI),
        ) <= maxHeadingDiffRadians
          ? 20
          : null
      ),
      hasBridges: () => true,
    };
    const map = { queryTerrainElevation: () => 5 };
    // ~50° off the span: transit default (60°) would mount; drive (36°) must not.
    const shallow = sampleDriveGround(
      map as any,
      centerLng + lngOff(2),
      centerLat,
      Math.PI / 3.6,
      bridge as any,
      5,
    );
    expect(shallow.onDeck).toBe(false);
    expect(shallow.elevation).toBe(5);
  });
});

describe('drive control sources', () => {
  it('keeps a control pressed until every physical source releases it', () => {
    const controls: DriveControlSources = new Map();
    setDriveControlSource(controls, 'throttleUp', 'keyboard:KeyW', true);
    setDriveControlSource(controls, 'throttleUp', 'pointer:1', true);

    setDriveControlSource(controls, 'throttleUp', 'keyboard:KeyW', false);
    expect(driveInputForControlSources(controls).throttle).toBe(1);

    setDriveControlSource(controls, 'throttleUp', 'pointer:1', false);
    expect(driveInputForControlSources(controls).throttle).toBe(0);
  });

  it('maps handbrake as a separate binary input', () => {
    const controls: DriveControlSources = new Map();
    expect(driveInputForControlSources(controls).handbrake).toBe(0);
    setDriveControlSource(controls, 'handbrake', 'keyboard:Space', true);
    expect(driveInputForControlSources(controls).handbrake).toBe(1);
  });
});
