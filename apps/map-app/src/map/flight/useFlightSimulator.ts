import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { LngLat, type Map, type SkySpecification } from 'maplibre-gl';
import type { ResolvedTheme } from '../../theme';
import { runIndependentRestoreSteps } from './flightCleanup';
import { FlightModelLayer } from './FlightModelLayer';
import {
  advanceFlight,
  createInitialFlightState,
  degreesToRadians,
  flightCameraPose,
  radiansToDegrees,
  smoothFlightCameraRig,
  FLIGHT_CRUISE_SPEED_METERS_PER_SECOND,
  FLIGHT_MIN_CLEARANCE_METERS,
  type FlightCameraRig,
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

type MapCameraWithTerrain = { terrain: unknown };

type FlightTransform = {
  nearZ: number;
  farZ: number;
  cameraToCenterDistance: number;
  pixelsPerMeter: number;
  overrideNearFarZ?: (nearZ: number, farZ: number) => void;
  clearNearFarZOverride?: () => void;
};

/** Keep terrain ~this far ahead drawable from high-altitude chase views.
 * MapLibre otherwise pulls the far clip in to the look-at, which hides
 * distant ground before it reaches the fogged horizon. */
const FLIGHT_MIN_FAR_CLIP_METERS = 1_000_000;

function mapCamera(map: Map): MapCameraWithTerrain | undefined {
  return (map as Map & { _camera?: MapCameraWithTerrain })._camera;
}

function mapTransform(map: Map): FlightTransform | undefined {
  const withTransform = map as Map & {
    transform?: FlightTransform;
    _camera?: { transform?: FlightTransform };
  };
  return withTransform.transform ?? withTransform._camera?.transform;
}

function keepDistantTerrainVisible(map: Map) {
  const transform = mapTransform(map);
  if (!transform?.overrideNearFarZ) return;
  const near = Math.max(0.1, transform.cameraToCenterDistance * 0.01);
  const far = Math.max(
    transform.farZ,
    transform.cameraToCenterDistance * 8,
    transform.pixelsPerMeter * FLIGHT_MIN_FAR_CLIP_METERS,
  );
  transform.overrideNearFarZ(near, far);
}

function queryElevationSafe(map: Map, coordinate: [number, number], fallback: number) {
  try {
    return map.queryTerrainElevation(coordinate) ?? fallback;
  } catch {
    return fallback;
  }
}

/** jumpTo samples DEM at the destination zoom. From globe/space that zoom is
 * far above loaded terrain tiles, so the bilinear lookup throws and kills
 * the chase loop. We already pass elevation, so skip the sample. */
function jumpToFlightCamera(map: Map, options: Parameters<Map['jumpTo']>[0]) {
  const camera = mapCamera(map);
  if (!camera) {
    map.jumpTo(options, { flightMode: true });
    return;
  }
  const terrain = camera.terrain;
  camera.terrain = null;
  try {
    map.jumpTo(options, { flightMode: true });
  } finally {
    camera.terrain = terrain;
  }
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
  activeRef: RefObject<boolean>;
  terrainSourceRef: RefObject<string>;
  terrainEnabledRef: RefObject<boolean>;
  resolvedTheme: ResolvedTheme;
};

export function flightSkyForTheme(theme: ResolvedTheme): SkySpecification {
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
  // Do not spread a previous sky here. Dark mode writes sky-color and
  // atmosphere-blend; a partial daylight update leaves those night values.
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

function applyFlightSky(map: Map, theme: ResolvedTheme) {
  map.setSky(flightSkyForTheme(theme));
}

type ToggleableHandler = {
  disable: () => void;
  enable: () => void;
  isEnabled: () => boolean;
};

export type FlightControlSources = globalThis.Map<FlightControl, Set<string>>;

export function flightInputForControlSources(controls: FlightControlSources): FlightInput {
  const pressed = (control: FlightControl) => (controls.get(control)?.size ?? 0) > 0;
  return {
    pitch: Number(pressed('pitchUp')) - Number(pressed('pitchDown')),
    roll: Number(pressed('rollRight')) - Number(pressed('rollLeft')),
    throttle: Number(pressed('throttleUp')) - Number(pressed('throttleDown')),
  };
}

export function setFlightControlSource(
  controls: FlightControlSources,
  control: FlightControl,
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
  activeRef,
  terrainSourceRef,
  terrainEnabledRef,
  resolvedTheme,
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
  const modelLayerRef = useRef<FlightModelLayer | null>(null);
  const pressedControlsRef = useRef<FlightControlSources>(new globalThis.Map());
  const originalSkyRef = useRef<SkySpecification | undefined>(undefined);
  const sessionCleanupRef = useRef(false);

  const disposeAircraftLayer = useCallback(() => {
    const map = mapRef.current;
    const modelLayer = modelLayerRef.current;
    if (!modelLayer) return;
    try {
      modelLayer.setPose(null);
    } catch (error) {
      console.error('Flight mode restore failed (aircraft pose).', error);
    }
    if (map?.getLayer(modelLayer.id)) {
      try {
        map.removeLayer(modelLayer.id);
      } catch (error) {
        console.error('Flight mode restore failed (aircraft layer).', error);
      }
    }
    modelLayerRef.current = null;
  }, [mapRef]);

  const stop = useCallback(() => {
    activeRef.current = false;
    pressedControlsRef.current.clear();
    flightStateRef.current = null;
    // The session effect removes the aircraft on the way out. If start() never
    // reached that effect, drop the layer here so map mode is not left with it.
    if (!sessionCleanupRef.current) disposeAircraftLayer();
    setActive(false);
  }, [activeRef, disposeAircraftLayer]);

  const start = useCallback((coordinates?: [number, number]) => {
    const map = mapRef.current;
    if (!map || !mapLoaded || activeRef.current) return;
    const modelLayer = new FlightModelLayer();
    modelLayer.setTheme(resolvedTheme === 'dark');
    map.addLayer(
      modelLayer,
      map.getLayer('global-road-labels') ? 'global-road-labels' : undefined,
    );
    modelLayerRef.current = modelLayer;
    const center = map.getCenter();
    const spawn: [number, number] = coordinates ?? [center.lng, center.lat];
    const terrainElevation = queryElevationSafe(map, spawn, 0);
    const state = createInitialFlightState(
      spawn,
      terrainElevation,
      map.getBearing(),
    );
    flightStateRef.current = state;
    pressedControlsRef.current.clear();
    setTelemetry(telemetryForState(state, terrainElevation));
    activeRef.current = true;
    setActive(true);
  }, [activeRef, mapLoaded, mapRef, resolvedTheme]);

  const setControl = useCallback((control: FlightControl, pressed: boolean, source = 'control') => {
    setFlightControlSource(pressedControlsRef.current, control, source, pressed);
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
    applyFlightSky(map, resolvedTheme);
    if (map.getSource(terrainSourceRef.current)) {
      terrainEnabledRef.current = true;
      map.setTerrain({ source: terrainSourceRef.current, exaggeration: 1 });
    }
    // MapLibre accepts larger pitch limits, but terrain tile covering and
    // culling are not reliable once the camera looks beyond the horizon.
    // The adaptive chase rig keeps the aircraft aerobatic while the map
    // camera remains within this terrain-safe range.
    map.setMaxPitch(85);
    map.setMaxZoom(22);
    map.setCenterClampedToGround(false);
    modelLayer.setPose(initialState);

    let frame: number | undefined;
    let previousTime = performance.now();
    let previousTelemetryTime = 0;
    let cameraRig: FlightCameraRig | null = null;
    let lastTerrainElevation = queryElevationSafe(map, [
      initialState.longitude,
      initialState.latitude,
    ], 0);
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
      setFlightControlSource(pressedControlsRef.current, control, `keyboard:${event.code}`, true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const control = controlForCode(event.code, event.key);
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      setFlightControlSource(pressedControlsRef.current, control, `keyboard:${event.code}`, false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', clearControls);
    document.addEventListener('visibilitychange', handleVisibility);

    const update = (now: number) => {
      if (!activeRef.current) return;
      try {
        const current = flightStateRef.current;
        if (!current) return;
        lastTerrainElevation = queryElevationSafe(
          map,
          [current.longitude, current.latitude],
          lastTerrainElevation,
        );
        const elapsedSeconds = (now - previousTime) / 1_000;
        const next = advanceFlight(
          current,
          flightInputForControlSources(pressedControlsRef.current),
          elapsedSeconds,
          lastTerrainElevation,
        );
        previousTime = now;
        flightStateRef.current = next;
        modelLayer.setPose(next);

        cameraRig = smoothFlightCameraRig(cameraRig, next, elapsedSeconds);
        const camera = flightCameraPose(cameraRig);
        // The chase camera trails behind the aircraft, so terrain or a
        // building under that offset point can rise above the aircraft's own
        // ground clearance. Without this the camera ends up inside solid
        // geometry, causing near-plane clipping that looks like a flickering
        // duplicate scene from a slightly different perspective.
        const cameraGroundElevation = queryElevationSafe(map, camera.from, lastTerrainElevation);
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
          jumpToFlightCamera(map, {
            ...cameraOptions,
            pitch: nextPitch,
            zoom: Math.max(cameraOptions.zoom ?? map.getZoom(), 14),
            roll: camera.roll,
          });
          keepDistantTerrainVisible(map);
        }

        if (now - previousTelemetryTime >= 150) {
          previousTelemetryTime = now;
          setTelemetry(telemetryForState(next, lastTerrainElevation));
        }
      } catch (error) {
        console.error('Flight mode stopped after a rendering failure.', error);
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
      flightStateRef.current = null;
      disposeAircraftLayer();
      const skyToRestore = originalSkyRef.current;
      originalSkyRef.current = undefined;
      runIndependentRestoreSteps([
        { label: 'stop camera', run: () => map.stop() },
        { label: 'near/far clip', run: () => mapTransform(map)?.clearNearFarZOverride?.() },
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
        { label: 'camera', run: () => map.jumpTo(originalCamera, { flightModeRestore: true }) },
        ...handlers.map((handler, index) => ({
          label: `interaction handler ${index}`,
          run: () => {
            if (enabledHandlers[index]) handler.enable();
          },
        })),
      ]);
    };
  }, [active, activeRef, disposeAircraftLayer, mapLoaded, mapRef, stop, terrainEnabledRef, terrainSourceRef]);

  useEffect(() => {
    if (!active || !mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;
    applyFlightSky(map, resolvedTheme);
    modelLayerRef.current?.setTheme(resolvedTheme === 'dark');
  }, [active, mapLoaded, mapRef, resolvedTheme]);

  useEffect(() => {
    activeRef.current = active;
    return () => {
      activeRef.current = false;
    };
  }, [active, activeRef]);

  return { active, start, stop, setControl, telemetry };
}
