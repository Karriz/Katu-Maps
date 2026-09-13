import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { LngLat, type Map, type SkySpecification } from 'maplibre-gl';
import { dayNightAppearance, paletteForElevation, nightFactor } from '../DayNightAppearance';
import { sunPosition } from '../DayNightSun';
import type { ResolvedTheme } from '../../theme';
import { runIndependentRestoreSteps } from '../flight/flightCleanup';
import type { BridgeDeckSource } from '../TransitVehicleModelLayer';
import { DriveModelLayer } from './DriveModelLayer';
import {
  advanceDrive,
  createInitialDriveState,
  degreesToRadians,
  driveCameraPose,
  driveTravelHeading,
  radiansToDegrees,
  smoothDriveCameraRig,
  DRIVE_DECK_MAX_HEADING_DIFF_RADIANS,
  DRIVE_DECK_MOUNT_CONFIRM_SECONDS,
  DRIVE_MIN_CLEARANCE_METERS,
  DRIVE_PITCH_SAMPLE_DISTANCE_METERS,
  DRIVE_ROLL_SAMPLE_DISTANCE_METERS,
  DRIVE_WHEEL_CONTACT_OFFSET_METERS,
  offsetCoordinate,
  type DriveCameraRig,
  type DriveGroundSample,
  type DriveInput,
  type DriveState,
} from './DriveDynamics';

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_PITCH_RADIANS = degreesToRadians(18);

function haversineMeters(a: [number, number], b: [number, number]) {
  const lat1 = degreesToRadians(a[1]);
  const lat2 = degreesToRadians(b[1]);
  const deltaLat = lat2 - lat1;
  const deltaLng = degreesToRadians(b[0] - a[0]);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

type MapCameraWithTerrain = { terrain: unknown };

function mapCamera(map: Map): MapCameraWithTerrain | undefined {
  return (map as Map & { _camera?: MapCameraWithTerrain })._camera;
}

function queryElevationSafe(map: Map, coordinate: [number, number], fallback: number) {
  try {
    return map.queryTerrainElevation(coordinate) ?? fallback;
  } catch {
    return fallback;
  }
}

function sampleGroundElevation(
  map: Map,
  longitude: number,
  latitude: number,
  heading: number,
  bridgeDeckSource: BridgeDeckSource | null | undefined,
  fallback: number,
  options?: {
    allowDeck?: boolean;
    maxHeadingDiffRadians?: number;
  },
) {
  if (options?.allowDeck !== false) {
    const deck = bridgeDeckSource?.deckPlacementAt(
      longitude,
      latitude,
      heading,
      options?.maxHeadingDiffRadians ?? DRIVE_DECK_MAX_HEADING_DIFF_RADIANS,
    );
    if (deck != null) return deck;
  }
  return queryElevationSafe(map, [longitude, latitude], fallback);
}

function sampleDriveSupportElevation(
  map: Map,
  longitude: number,
  latitude: number,
  heading: number,
  bridgeDeckSource: BridgeDeckSource | null | undefined,
  fallback: number,
  options: {
    onDeck: boolean;
    deckElevation: number;
    allowDeck: boolean;
    maxHeadingDiffRadians: number;
  },
) {
  if (options.allowDeck) {
    const deck = bridgeDeckSource?.deckPlacementAt(
      longitude, latitude, heading, options.maxHeadingDiffRadians,
    );
    if (deck != null) return deck;
    // While on a bridge, pitch/roll arms must not fall through to the riverbed
    // just because the sample left the painted centerline.
    if (options.onDeck) return options.deckElevation;
  }
  return queryElevationSafe(map, [longitude, latitude], fallback);
}

export function sampleDriveGround(
  map: Map,
  longitude: number,
  latitude: number,
  heading: number,
  bridgeDeckSource: BridgeDeckSource | null | undefined,
  fallback: number,
  options?: {
    allowDeck?: boolean;
    maxHeadingDiffRadians?: number;
  },
): DriveGroundSample {
  const allowDeck = options?.allowDeck !== false;
  const maxHeadingDiffRadians = options?.maxHeadingDiffRadians ?? DRIVE_DECK_MAX_HEADING_DIFF_RADIANS;
  const terrainElevation = queryElevationSafe(map, [longitude, latitude], fallback);
  const deckElevation = allowDeck
    ? (bridgeDeckSource?.deckPlacementAt(
      longitude, latitude, heading, maxHeadingDiffRadians,
    ) ?? null)
    : null;
  const onDeck = deckElevation != null;
  const elevation = onDeck ? deckElevation : terrainElevation;
  // Longer baseline than the car itself so DEM texel noise averages out.
  const pitchDistance = DRIVE_PITCH_SAMPLE_DISTANCE_METERS;
  const rollDistance = DRIVE_ROLL_SAMPLE_DISTANCE_METERS;
  const sinHeading = Math.sin(heading);
  const cosHeading = Math.cos(heading);
  const ahead = offsetCoordinate(
    [longitude, latitude],
    sinHeading * pitchDistance,
    cosHeading * pitchDistance,
  );
  const behind = offsetCoordinate(
    [longitude, latitude],
    -sinHeading * pitchDistance,
    -cosHeading * pitchDistance,
  );
  // Body-right is +east when heading north: (cos, -sin).
  const right = offsetCoordinate(
    [longitude, latitude],
    cosHeading * rollDistance,
    -sinHeading * rollDistance,
  );
  const left = offsetCoordinate(
    [longitude, latitude],
    -cosHeading * rollDistance,
    sinHeading * rollDistance,
  );
  const support = {
    onDeck,
    deckElevation: elevation,
    allowDeck,
    maxHeadingDiffRadians,
  };
  const elevAhead = sampleDriveSupportElevation(
    map, ahead[0], ahead[1], heading, bridgeDeckSource, elevation, support,
  );
  const elevBehind = sampleDriveSupportElevation(
    map, behind[0], behind[1], heading, bridgeDeckSource, elevation, support,
  );
  const elevRight = sampleDriveSupportElevation(
    map, right[0], right[1], heading, bridgeDeckSource, elevation, support,
  );
  const elevLeft = sampleDriveSupportElevation(
    map, left[0], left[1], heading, bridgeDeckSource, elevation, support,
  );
  // Positive pitch = nose up (flight convention). DriveModelLayer applies -pitch
  // on rotation.x, matching the aircraft layer.
  const pitch = Math.max(-MAX_PITCH_RADIANS, Math.min(MAX_PITCH_RADIANS,
    Math.atan2(elevAhead - elevBehind, pitchDistance * 2)));
  // Higher ground on the right lifts the right side (negative roll / lean left),
  // matching DriveModelLayer's -roll on Z with positive = lean right.
  const roll = Math.max(-MAX_PITCH_RADIANS, Math.min(MAX_PITCH_RADIANS,
    Math.atan2(elevLeft - elevRight, rollDistance * 2)));
  return { elevation, pitch, roll, onDeck, terrainElevation };
}

function jumpToDriveCamera(map: Map, options: Parameters<Map['jumpTo']>[0]) {
  const camera = mapCamera(map);
  if (!camera) {
    map.jumpTo(options, { driveMode: true });
    return;
  }
  const terrain = camera.terrain;
  camera.terrain = null;
  try {
    map.jumpTo(options, { driveMode: true });
  } finally {
    camera.terrain = terrain;
  }
}

export type DriveControl =
  | 'steerLeft'
  | 'steerRight'
  | 'throttleUp'
  | 'throttleDown'
  | 'handbrake';

export type DriveTelemetry = {
  speed: number;
  throttle: number;
  heading: number;
  altitude: number;
  drift: number;
  handbrake: boolean;
};

type DriveSimulatorOptions = {
  mapRef: RefObject<Map | null>;
  mapLoaded: boolean;
  activeRef: RefObject<boolean>;
  terrainSourceRef: RefObject<string>;
  terrainEnabledRef: RefObject<boolean>;
  bridgeDeckSourceRef: RefObject<BridgeDeckSource | null>;
  resolvedTheme: ResolvedTheme;
  dayNightUtcMs?: number;
  /** When another immersive mode is active, refuse to start. */
  blockedRef?: RefObject<boolean>;
};

export function driveSkyForTheme(theme: ResolvedTheme, elevation?: number): SkySpecification {
  if (elevation !== undefined) {
    const palette = paletteForElevation(elevation);
    const night = nightFactor(elevation);
    return {
      'sky-color': palette.sky,
      'horizon-color': palette.horizon,
      'fog-color': palette.fog,
      'sky-horizon-blend': 0.7 + night * 0.08,
      'horizon-fog-blend': 1 - night * 0.45,
      'fog-ground-blend': 0.72 + night * 0.06,
      'atmosphere-blend': 0,
    };
  }
  if (theme === 'dark') {
    return {
      'sky-color': '#071525',
      'horizon-color': '#274860',
      'fog-color': '#1a3348',
      'sky-horizon-blend': 0.78,
      'horizon-fog-blend': 0.55,
      'fog-ground-blend': 0.78,
      'atmosphere-blend': 0,
    };
  }
  return {
    'sky-color': '#7ec8ea',
    'horizon-color': '#f3f8fb',
    'fog-color': '#eef6fa',
    'sky-horizon-blend': 0.7,
    'horizon-fog-blend': 1,
    'fog-ground-blend': 0.72,
    'atmosphere-blend': 0,
  };
}

type ToggleableHandler = {
  disable: () => void;
  enable: () => void;
  isEnabled: () => boolean;
};

export type DriveControlSources = globalThis.Map<DriveControl, Set<string>>;

export function driveInputForControlSources(controls: DriveControlSources): DriveInput {
  const pressed = (control: DriveControl) => (controls.get(control)?.size ?? 0) > 0;
  return {
    steer: Number(pressed('steerRight')) - Number(pressed('steerLeft')),
    throttle: Number(pressed('throttleUp')) - Number(pressed('throttleDown')),
    handbrake: Number(pressed('handbrake')),
  };
}

export function setDriveControlSource(
  controls: DriveControlSources,
  control: DriveControl,
  source: string,
  pressed: boolean,
) {
  if (pressed) {
    const sources = controls.get(control) ?? new Set<string>();
    sources.add(source);
    controls.set(control, sources);
    return;
  }
  const sources = controls.get(control);
  if (!sources) return;
  sources.delete(source);
  if (sources.size === 0) controls.delete(control);
}

function telemetryForState(
  state: DriveState,
  terrainElevation: number,
  handbrake: boolean,
): DriveTelemetry {
  return {
    speed: state.speed,
    throttle: state.throttle,
    heading: (radiansToDegrees(state.heading) + 360) % 360,
    altitude: Math.max(0, state.altitude - terrainElevation - DRIVE_WHEEL_CONTACT_OFFSET_METERS),
    drift: state.drift,
    handbrake,
  };
}

function controlForCode(code: string, key?: string): DriveControl | undefined {
  const k = key?.toLowerCase();
  if (code === 'KeyW' || code === 'ArrowUp' || k === 'w') return 'throttleUp';
  if (code === 'KeyS' || code === 'ArrowDown' || k === 's') return 'throttleDown';
  if (code === 'KeyA' || code === 'ArrowLeft' || k === 'a') return 'steerLeft';
  if (code === 'KeyD' || code === 'ArrowRight' || k === 'd') return 'steerRight';
  if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight' || k === ' ') {
    return 'handbrake';
  }
  return undefined;
}

export function useDriveSimulator({
  mapRef,
  mapLoaded,
  activeRef,
  terrainSourceRef,
  terrainEnabledRef,
  bridgeDeckSourceRef,
  resolvedTheme,
  dayNightUtcMs,
  blockedRef,
}: DriveSimulatorOptions) {
  const [active, setActive] = useState(false);
  const [telemetry, setTelemetry] = useState<DriveTelemetry>({
    speed: 0,
    throttle: 0,
    heading: 0,
    altitude: 0,
    drift: 0,
    handbrake: false,
  });
  const driveStateRef = useRef<DriveState | null>(null);
  const modelLayerRef = useRef<DriveModelLayer | null>(null);
  const pressedControlsRef = useRef<DriveControlSources>(new globalThis.Map());
  const originalSkyRef = useRef<SkySpecification | undefined>(undefined);
  const sessionCleanupRef = useRef(false);

  const disposeCarLayer = useCallback(() => {
    const map = mapRef.current;
    const modelLayer = modelLayerRef.current;
    if (!modelLayer) return;
    try {
      modelLayer.setPose(null);
    } catch (error) {
      console.error('Drive mode restore failed (car pose).', error);
    }
    if (map?.getLayer(modelLayer.id)) {
      try {
        map.removeLayer(modelLayer.id);
      } catch (error) {
        console.error('Drive mode restore failed (car layer).', error);
      }
    }
    modelLayerRef.current = null;
  }, [mapRef]);

  const stop = useCallback(() => {
    activeRef.current = false;
    pressedControlsRef.current.clear();
    driveStateRef.current = null;
    if (!sessionCleanupRef.current) disposeCarLayer();
    setActive(false);
  }, [activeRef, disposeCarLayer]);

  const start = useCallback((coordinates?: [number, number]) => {
    const map = mapRef.current;
    if (!map || !mapLoaded || activeRef.current || blockedRef?.current) return;
    const modelLayer = new DriveModelLayer();
    modelLayer.setTheme(resolvedTheme === 'dark');
    map.addLayer(
      modelLayer,
      map.getLayer('global-road-labels') ? 'global-road-labels' : undefined,
    );
    modelLayerRef.current = modelLayer;
    const center = map.getCenter();
    const spawn: [number, number] = coordinates ?? [center.lng, center.lat];
    const heading = degreesToRadians(map.getBearing());
    const ground = sampleDriveGround(
      map, spawn[0], spawn[1], heading, bridgeDeckSourceRef.current, 0,
    );
    const state = createInitialDriveState(spawn, ground.elevation, map.getBearing());
    state.pitch = ground.pitch;
    state.roll = ground.roll;
    driveStateRef.current = state;
    pressedControlsRef.current.clear();
    setTelemetry(telemetryForState(state, ground.elevation, false));
    activeRef.current = true;
    setActive(true);
  }, [activeRef, blockedRef, bridgeDeckSourceRef, mapLoaded, mapRef, resolvedTheme]);

  const setControl = useCallback((control: DriveControl, pressed: boolean, source = 'control') => {
    setDriveControlSource(pressedControlsRef.current, control, source, pressed);
  }, []);

  useEffect(() => {
    if (!active || !mapLoaded) return;
    const map = mapRef.current;
    const modelLayer = modelLayerRef.current;
    const initialState = driveStateRef.current;
    if (!map || !modelLayer || !initialState) {
      stop();
      return;
    }

    const originalCamera = {
      center: map.getCenter().toArray() as [number, number],
      elevation: map.getCenterElevation(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      roll: map.getRoll(),
      padding: map.getPadding(),
    };
    const originalProjection = map.getProjection();
    const originalTerrain = map.getTerrain();
    const originalSky = map.getSky();
    originalSkyRef.current = originalSky;
    const originalMaxPitch = map.getMaxPitch();
    const originalMaxZoom = map.getMaxZoom();
    const originalCenterClampedToGround = map.getCenterClampedToGround();
    const originalTerrainEnabled = terrainEnabledRef.current;
    const handlers: ToggleableHandler[] = [
      map.boxZoom,
      map.doubleClickZoom,
      map.dragPan,
      map.dragRotate,
      map.scrollZoom,
      map.touchZoomRotate,
    ];
    const enabledHandlers = handlers.map((handler) => handler.isEnabled());

    map.stop();
    handlers.forEach((handler) => handler.disable());
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    map.setProjection({ type: 'mercator' });
    map.setSky(driveSkyForTheme(resolvedTheme));
    if (map.getSource(terrainSourceRef.current)) {
      terrainEnabledRef.current = true;
      map.setTerrain({ source: terrainSourceRef.current, exaggeration: 1 });
    }
    map.setMaxPitch(85);
    map.setMaxZoom(22);
    map.setCenterClampedToGround(false);

    let frame: number | undefined;
    let previousTime = performance.now();
    let previousTelemetryTime = 0;
    let cameraRig: DriveCameraRig | null = null;
    let lastTerrainElevation = sampleDriveGround(
      map,
      initialState.longitude,
      initialState.latitude,
      initialState.heading,
      bridgeDeckSourceRef.current,
      0,
      { maxHeadingDiffRadians: DRIVE_DECK_MAX_HEADING_DIFF_RADIANS },
    ).terrainElevation ?? 0;
    modelLayer.setPose(initialState, lastTerrainElevation);

    let previousCameraOptions: { zoom: number; pitch: number; center: [number, number] } | null = null;
    let consecutiveRejectedFrames = 0;
    let deckMountSeconds = 0;
    let deckLatched = false;
    const MAX_ZOOM_CHANGE_PER_FRAME = 0.35;
    const MAX_PITCH_CHANGE_PER_FRAME_DEGREES = 12;
    const MAX_CENTER_JUMP_METERS = 80;
    const MAX_CONSECUTIVE_REJECTIONS = 4;

    const clearControls = () => pressedControlsRef.current.clear();
    const handleVisibility = () => {
      clearControls();
      previousTime = performance.now();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        stop();
        return;
      }
      const control = controlForCode(event.code, event.key);
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      setDriveControlSource(pressedControlsRef.current, control, `keyboard:${event.code}`, true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const control = controlForCode(event.code, event.key);
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      setDriveControlSource(pressedControlsRef.current, control, `keyboard:${event.code}`, false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', clearControls);
    document.addEventListener('visibilitychange', handleVisibility);

    const update = (now: number) => {
      if (!activeRef.current) return;
      try {
        const current = driveStateRef.current;
        if (!current) return;
        const travelHeading = driveTravelHeading(current);
        const probe = sampleDriveGround(
          map,
          current.longitude,
          current.latitude,
          travelHeading,
          bridgeDeckSourceRef.current,
          lastTerrainElevation,
          {
            allowDeck: true,
            maxHeadingDiffRadians: DRIVE_DECK_MAX_HEADING_DIFF_RADIANS,
          },
        );
        const elapsedSeconds = (now - previousTime) / 1_000;
        if (probe.onDeck) {
          deckMountSeconds += elapsedSeconds;
          if (deckMountSeconds >= DRIVE_DECK_MOUNT_CONFIRM_SECONDS) deckLatched = true;
        } else {
          deckMountSeconds = 0;
          deckLatched = false;
        }
        const ground = deckLatched
          ? probe
          : (probe.onDeck
            ? sampleDriveGround(
              map,
              current.longitude,
              current.latitude,
              travelHeading,
              bridgeDeckSourceRef.current,
              lastTerrainElevation,
              {
                allowDeck: false,
                maxHeadingDiffRadians: DRIVE_DECK_MAX_HEADING_DIFF_RADIANS,
              },
            )
            : probe);
        lastTerrainElevation = ground.terrainElevation ?? ground.elevation;
        const next = advanceDrive(
          current,
          driveInputForControlSources(pressedControlsRef.current),
          elapsedSeconds,
          ground,
        );
        previousTime = now;
        driveStateRef.current = next;
        modelLayer.setPose(next, lastTerrainElevation);

        cameraRig = smoothDriveCameraRig(cameraRig, next, elapsedSeconds);
        const camera = driveCameraPose(cameraRig);
        const cameraGroundElevation = sampleGroundElevation(
          map,
          camera.from[0],
          camera.from[1],
          driveTravelHeading(next),
          bridgeDeckSourceRef.current,
          lastTerrainElevation,
          {
            allowDeck: deckLatched,
            maxHeadingDiffRadians: DRIVE_DECK_MAX_HEADING_DIFF_RADIANS,
          },
        );
        const fromAltitude = Math.max(
          camera.fromAltitude,
          cameraGroundElevation + DRIVE_MIN_CLEARANCE_METERS,
        );
        const cameraOptions = map.calculateCameraOptionsFromTo(
          new LngLat(camera.from[0], camera.from[1]),
          fromAltitude,
          new LngLat(camera.target[0], camera.target[1]),
          camera.targetAltitude,
        );
        const nextZoom = cameraOptions.zoom ?? map.getZoom();
        const nextPitch = cameraOptions.pitch ?? map.getPitch();
        const nextCenter = cameraOptions.center
          ? (Array.isArray(cameraOptions.center)
            ? cameraOptions.center as [number, number]
            : [(cameraOptions.center as { lng: number }).lng, (cameraOptions.center as { lat: number }).lat] as [number, number])
          : [camera.from[0], camera.from[1]] as [number, number];
        const centerJumpMeters = previousCameraOptions
          ? haversineMeters(previousCameraOptions.center, nextCenter)
          : 0;
        const isAnomalousJump = previousCameraOptions !== null
          && consecutiveRejectedFrames < MAX_CONSECUTIVE_REJECTIONS
          && (Math.abs(nextZoom - previousCameraOptions.zoom) > MAX_ZOOM_CHANGE_PER_FRAME
            || Math.abs(nextPitch - previousCameraOptions.pitch) > MAX_PITCH_CHANGE_PER_FRAME_DEGREES
            || centerJumpMeters > MAX_CENTER_JUMP_METERS);
        if (isAnomalousJump) {
          consecutiveRejectedFrames += 1;
        } else {
          consecutiveRejectedFrames = 0;
          previousCameraOptions = { zoom: nextZoom, pitch: nextPitch, center: nextCenter };
          jumpToDriveCamera(map, {
            ...cameraOptions,
            zoom: Math.max(nextZoom, 16.5),
            roll: camera.roll,
          });
        }

        if (now - previousTelemetryTime >= 150) {
          previousTelemetryTime = now;
          const input = driveInputForControlSources(pressedControlsRef.current);
          setTelemetry(telemetryForState(next, lastTerrainElevation, input.handbrake > 0.5));
        }
      } catch (error) {
        console.error('Drive mode stopped after a rendering failure.', error);
        stop();
      }
      if (activeRef.current) frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);

    sessionCleanupRef.current = true;
    return () => {
      sessionCleanupRef.current = false;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', clearControls);
      document.removeEventListener('visibilitychange', handleVisibility);
      pressedControlsRef.current.clear();
      driveStateRef.current = null;
      disposeCarLayer();
      const skyToRestore = originalSkyRef.current;
      originalSkyRef.current = undefined;
      runIndependentRestoreSteps([
        { label: 'stop camera', run: () => map.stop() },
        {
          label: 'terrain',
          run: () => {
            map.setTerrain(originalTerrain);
            terrainEnabledRef.current = originalTerrainEnabled;
          },
        },
        { label: 'sky', run: () => { if (skyToRestore) map.setSky(skyToRestore); } },
        { label: 'projection', run: () => map.setProjection(originalProjection) },
        { label: 'max pitch', run: () => map.setMaxPitch(originalMaxPitch) },
        { label: 'max zoom', run: () => map.setMaxZoom(originalMaxZoom) },
        { label: 'ground clamp', run: () => map.setCenterClampedToGround(originalCenterClampedToGround) },
        { label: 'camera', run: () => map.jumpTo(originalCamera, { driveModeRestore: true }) },
        ...handlers.map((handler, index) => ({
          label: `interaction handler ${index}`,
          run: () => {
            if (enabledHandlers[index]) handler.enable();
          },
        })),
      ]);
    };
  }, [
    active,
    activeRef,
    bridgeDeckSourceRef,
    disposeCarLayer,
    mapLoaded,
    mapRef,
    resolvedTheme,
    stop,
    terrainEnabledRef,
    terrainSourceRef,
  ]);

  useEffect(() => {
    if (!active || !mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;
    modelLayerRef.current?.setTheme(dayNightUtcMs === undefined && resolvedTheme === 'dark');
    let previousSky = '';
    let previousLighting = '';
    const updateSky = () => {
      const center = map.getCenter();
      const elevation = dayNightUtcMs === undefined ? undefined
        : sunPosition(new Date(dayNightUtcMs), center.lat, center.lng).elevation;
      const sky = driveSkyForTheme(resolvedTheme,
        elevation === undefined ? undefined : Math.round(elevation * 10) / 10);
      const appearance = dayNightUtcMs === undefined ? null
        : dayNightAppearance(new Date(dayNightUtcMs), center.lat, center.lng, 16);
      const lightingKey = appearance
        ? `${Math.round(appearance.azimuth * 10)}:${Math.round(appearance.polar * 10)}:${Math.round(appearance.treeNightMix * 1000)}:${appearance.palette.sun}`
        : 'theme';
      if (lightingKey !== previousLighting) {
        previousLighting = lightingKey;
        modelLayerRef.current?.setDayNightLighting(appearance);
      }
      const key = JSON.stringify(sky);
      if (key === previousSky) return;
      previousSky = key;
      map.setSky(sky);
    };
    updateSky();
    map.on('move', updateSky);
    return () => { map.off('move', updateSky); };
  }, [active, dayNightUtcMs, mapLoaded, mapRef, resolvedTheme]);

  useEffect(() => {
    activeRef.current = active;
    return () => {
      activeRef.current = false;
    };
  }, [active, activeRef]);

  return { active, start, stop, setControl, telemetry };
}
