import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { LngLat, type Map } from 'maplibre-gl';
import type { FlightModelLayer } from './FlightModelLayer';
import {
  advanceFlight,
  createInitialFlightState,
  degreesToRadians,
  flightCameraPose,
  radiansToDegrees,
  FLIGHT_CRUISE_SPEED_METERS_PER_SECOND,
  FLIGHT_MIN_CLEARANCE_METERS,
  type FlightInput,
  type FlightState,
} from './FlightDynamics';

const EARTH_RADIUS_METERS = 6_378_137;

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

export type FlightControl = 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight' | 'throttleUp' | 'throttleDown';

export type FlightTelemetry = {
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  isStalling: boolean;
};

type FlightSimulatorOptions = {
  mapRef: RefObject<Map | null>;
  mapLoaded: boolean;
  modelLayerRef: RefObject<FlightModelLayer | null>;
  activeRef: RefObject<boolean>;
  terrainSourceRef: RefObject<string>;
  terrainEnabledRef: RefObject<boolean>;
};

type ToggleableHandler = {
  disable: () => void;
  enable: () => void;
  isEnabled: () => boolean;
};

function inputForControls(controls: Set<FlightControl>): FlightInput {
  return {
    pitch: Number(controls.has('pitchUp')) - Number(controls.has('pitchDown')),
    roll: Number(controls.has('rollRight')) - Number(controls.has('rollLeft')),
    throttle: Number(controls.has('throttleUp')) - Number(controls.has('throttleDown')),
  };
}

function telemetryForState(state: FlightState, terrainElevation: number): FlightTelemetry {
  return {
    altitude: Math.max(0, state.altitude - terrainElevation),
    heading: (radiansToDegrees(state.heading) + 360) % 360,
    pitch: radiansToDegrees(state.pitch),
    roll: radiansToDegrees(state.roll),
    speed: state.speed,
    throttle: state.throttle,
    isStalling: state.isStalling,
  };
}

function controlForCode(code: string, key?: string): FlightControl | undefined {
  const k = key?.toLowerCase();
  if (code === 'KeyS' || code === 'ArrowDown' || k === 's') return 'pitchUp';
  if (code === 'KeyW' || code === 'ArrowUp' || k === 'w') return 'pitchDown';
  if (code === 'KeyA' || code === 'ArrowLeft' || k === 'a') return 'rollLeft';
  if (code === 'KeyD' || code === 'ArrowRight' || k === 'd') return 'rollRight';
  if (code === 'KeyR' || code === 'ShiftLeft' || code === 'ShiftRight' || k === 'r') return 'throttleUp';
  if (code === 'KeyF' || code === 'ControlLeft' || code === 'ControlRight' || k === 'f') return 'throttleDown';
  return undefined;
}

export function useFlightSimulator({
  mapRef,
  mapLoaded,
  modelLayerRef,
  activeRef,
  terrainSourceRef,
  terrainEnabledRef,
}: FlightSimulatorOptions) {
  const [active, setActive] = useState(false);
  const [telemetry, setTelemetry] = useState<FlightTelemetry>({
    altitude: 180,
    heading: 0,
    pitch: 0,
    roll: 0,
    speed: FLIGHT_CRUISE_SPEED_METERS_PER_SECOND,
    throttle: 0.75,
    isStalling: false,
  });
  const flightStateRef = useRef<FlightState | null>(null);
  const pressedControlsRef = useRef(new Set<FlightControl>());

  const stop = useCallback(() => {
    activeRef.current = false;
    pressedControlsRef.current.clear();
    setActive(false);
  }, [activeRef]);

  const start = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || activeRef.current) return;
    const center = map.getCenter();
    const terrainElevation = map.queryTerrainElevation(center) ?? 0;
    const state = createInitialFlightState(
      [center.lng, center.lat],
      terrainElevation,
      map.getBearing(),
    );
    flightStateRef.current = state;
    pressedControlsRef.current.clear();
    setTelemetry(telemetryForState(state, terrainElevation));
    activeRef.current = true;
    setActive(true);
  }, [activeRef, mapLoaded, mapRef]);

  const setControl = useCallback((control: FlightControl, pressed: boolean) => {
    if (pressed) pressedControlsRef.current.add(control);
    else pressedControlsRef.current.delete(control);
  }, []);

  useEffect(() => {
    if (!active || !mapLoaded) return;
    const map = mapRef.current;
    const modelLayer = modelLayerRef.current;
    const initialState = flightStateRef.current;
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
    };
    const originalProjection = map.getProjection();
    const originalTerrain = map.getTerrain();
    const originalMaxPitch = map.getMaxPitch();
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
    map.setProjection({ type: 'mercator' });
    if (map.getSource(terrainSourceRef.current)) {
      terrainEnabledRef.current = true;
      map.setTerrain({ source: terrainSourceRef.current, exaggeration: 1 });
    }
    map.setMaxPitch(85);
    map.setCenterClampedToGround(false);
    modelLayer.setPose(initialState);

    let frame: number | undefined;
    let previousTime = performance.now();
    let previousTelemetryTime = 0;
    let lastTerrainElevation = map.queryTerrainElevation([
      initialState.longitude,
      initialState.latitude,
    ]) ?? 0;
    // MapLibre's terrain-aware camera math (calculateCameraOptionsFromTo)
    // samples DEM elevation for the current position. While flying into
    // freshly-streamed terrain that sample can transiently fall back to sea
    // level for a single frame, which briefly computes a wildly different
    // zoom/pitch and flashes as a duplicate scene from another perspective.
    // Reject single-frame jumps that are far larger than normal flight
    // motion instead of applying them, but give up after a few frames in a
    // row so the camera cannot get stuck if the aircraft genuinely needs a
    // large adjustment (e.g. right after entering flight mode).
    let previousCameraOptions: { zoom: number; pitch: number; center: [number, number] } | null = null;
    let consecutiveRejectedFrames = 0;
    const MAX_ZOOM_CHANGE_PER_FRAME = 0.4;
    const MAX_PITCH_CHANGE_PER_FRAME_DEGREES = 12;
    const MAX_CENTER_JUMP_METERS = 250;
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
      pressedControlsRef.current.add(control);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const control = controlForCode(event.code, event.key);
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      pressedControlsRef.current.delete(control);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', clearControls);
    document.addEventListener('visibilitychange', handleVisibility);

    const update = (now: number) => {
      const current = flightStateRef.current;
      if (!current || !activeRef.current) return;
      const terrainElevation = map.queryTerrainElevation([
        current.longitude,
        current.latitude,
      ]);
      if (terrainElevation !== null) lastTerrainElevation = terrainElevation;
      const next = advanceFlight(
        current,
        inputForControls(pressedControlsRef.current),
        (now - previousTime) / 1_000,
        lastTerrainElevation,
      );
      previousTime = now;
      flightStateRef.current = next;
      modelLayer.setPose(next);

      const camera = flightCameraPose(next);
      // The chase camera trails behind the aircraft, so terrain or a
      // building under that offset point can rise above the aircraft's own
      // ground clearance. Without this the camera ends up inside solid
      // geometry, causing near-plane clipping that looks like a flickering
      // duplicate scene from a slightly different perspective.
      const cameraGroundElevation = map.queryTerrainElevation(camera.from) ?? lastTerrainElevation;
      const fromAltitude = Math.max(
        camera.fromAltitude,
        cameraGroundElevation + FLIGHT_MIN_CLEARANCE_METERS,
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
        map.jumpTo({
          ...cameraOptions,
          roll: radiansToDegrees(next.roll) * 0.3,
        }, { flightMode: true });
      }

      if (now - previousTelemetryTime >= 150) {
        previousTelemetryTime = now;
        setTelemetry(telemetryForState(next, lastTerrainElevation));
      }
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', clearControls);
      document.removeEventListener('visibilitychange', handleVisibility);
      pressedControlsRef.current.clear();
      modelLayer.setPose(null);
      map.stop();
      map.setTerrain(originalTerrain);
      terrainEnabledRef.current = originalTerrainEnabled;
      map.setProjection(originalProjection);
      map.setMaxPitch(originalMaxPitch);
      map.setCenterClampedToGround(originalCenterClampedToGround);
      map.jumpTo(originalCamera, { flightModeRestore: true });
      handlers.forEach((handler, index) => {
        if (enabledHandlers[index]) handler.enable();
      });
    };
  }, [active, activeRef, mapLoaded, mapRef, modelLayerRef, stop, terrainEnabledRef, terrainSourceRef]);

  useEffect(() => () => {
    activeRef.current = false;
  }, [activeRef]);

  return { active, start, stop, setControl, telemetry };
}
