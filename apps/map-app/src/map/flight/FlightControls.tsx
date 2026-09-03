import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LogOut, Minus, Plane, Plus } from 'lucide-react';
import type { FlightControl, FlightTelemetry } from './useFlightSimulator';

function HoldControl({
  control,
  label,
  onControlChange,
  children,
}: {
  control: FlightControl;
  label: string;
  onControlChange: (control: FlightControl, pressed: boolean, source?: string) => void;
  children: React.ReactNode;
}) {
  const keyboardSourcesRef = useRef(new Set<string>());
  const releasePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onControlChange(control, false, `pointer:${event.pointerId}`);
  };
  const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onControlChange(control, true, `pointer:${event.pointerId}`);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.code !== 'Enter' && event.code !== 'Space') return;
    event.preventDefault();
    const source = `button-keyboard:${event.code}`;
    keyboardSourcesRef.current.add(source);
    onControlChange(control, true, source);
  };
  const handleKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.code !== 'Enter' && event.code !== 'Space') return;
    event.preventDefault();
    const source = `button-keyboard:${event.code}`;
    keyboardSourcesRef.current.delete(source);
    onControlChange(control, false, source);
  };
  const releaseKeyboard = () => {
    keyboardSourcesRef.current.forEach((source) => onControlChange(control, false, source));
    keyboardSourcesRef.current.clear();
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={press}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onLostPointerCapture={releasePointer}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={releaseKeyboard}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  );
}

export function FlightControls({
  telemetry,
  onControlChange,
  onExit,
}: {
  telemetry: FlightTelemetry;
  onControlChange: (control: FlightControl, pressed: boolean, source?: string) => void;
  onExit: () => void;
}) {
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    exitButtonRef.current?.focus();
  }, []);

  return (
    <section className="flight-controls" aria-label="Flight simulator controls">
      <header className="flight-hud">
        <div className="flight-hud-title">
          <Plane aria-hidden="true" />
          <div><strong>Flight mode</strong><span>Realistic aerobatic dynamics</span></div>
        </div>
        <dl className="flight-telemetry">
          <div><dt>ALT</dt><dd>{Math.round(telemetry.altitude)} m</dd></div>
          <div><dt>SPD</dt><dd>{Math.round(telemetry.speed * 3.6)} km/h</dd></div>
          <div><dt>THR</dt><dd>{Math.round(telemetry.throttle * 100)}%</dd></div>
          <div><dt>HDG</dt><dd>{String(Math.round(telemetry.heading) % 360).padStart(3, '0')}°</dd></div>
        </dl>
        <button
          ref={exitButtonRef}
          className="flight-exit"
          type="button"
          aria-label="Exit flight"
          title="Exit flight"
          onClick={onExit}
        >
          <LogOut aria-hidden="true" />
          <span>Exit flight</span>
        </button>
      </header>

      {telemetry.isStalling && (
        <div className="flight-stall-warning" role="alert" aria-live="assertive">
          <AlertTriangle aria-hidden="true" />
          <span>STALL WARNING</span>
        </div>
      )}

      <div className="flight-throttle-bar" aria-label={`Throttle ${Math.round(telemetry.throttle * 100)} percent`}>
        <div className="flight-throttle-track">
          <div
            className="flight-throttle-fill"
            style={{ height: `${Math.round(telemetry.throttle * 100)}%` }}
          />
          <div className="flight-throttle-ticks">
            <span className="tick-100" />
            <span className="tick-75" title="Cruise power" />
            <span className="tick-50" />
            <span className="tick-25" />
          </div>
        </div>
        <div className="flight-throttle-label">
          <span className="label-text">PWR</span>
          <span className="label-value">{Math.round(telemetry.throttle * 100)}%</span>
        </div>
      </div>

      <div className="flight-reticle" aria-hidden="true"><span /></div>

      <div className="flight-inputs">
        <div className="flight-input-group" aria-label="Throttle controls">
          <span>Throttle</span>
          <div className="flight-throttle-buttons">
            <HoldControl control="throttleUp" label="Increase throttle" onControlChange={onControlChange}>
              <Plus aria-hidden="true" />
            </HoldControl>
            <HoldControl control="throttleDown" label="Decrease throttle" onControlChange={onControlChange}>
              <Minus aria-hidden="true" />
            </HoldControl>
          </div>
        </div>

        <p className="flight-key-help">
          <kbd>W</kbd><kbd>S</kbd> pitch · <kbd>A</kbd><kbd>D</kbd> roll · <kbd>R</kbd><kbd>F</kbd> throttle
        </p>

        <div className="flight-input-group flight-stick-control" aria-label="Pitch and roll controls">
          <span>Pitch &amp; roll</span>
          <div className="flight-stick-grid">
            <HoldControl control="pitchUp" label="Pitch up" onControlChange={onControlChange}>
              <ArrowUp aria-hidden="true" />
            </HoldControl>
            <HoldControl control="rollLeft" label="Roll left" onControlChange={onControlChange}>
              <ArrowLeft aria-hidden="true" />
            </HoldControl>
            <span className="flight-stick-center" aria-hidden="true"><Plane /></span>
            <HoldControl control="rollRight" label="Roll right" onControlChange={onControlChange}>
              <ArrowRight aria-hidden="true" />
            </HoldControl>
            <HoldControl control="pitchDown" label="Pitch down" onControlChange={onControlChange}>
              <ArrowDown aria-hidden="true" />
            </HoldControl>
          </div>
        </div>
      </div>
    </section>
  );
}

