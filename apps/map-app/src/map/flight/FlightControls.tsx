import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LogOut, Plane } from 'lucide-react';
import type { FlightControl, FlightTelemetry } from './useFlightSimulator';

function HoldControl({
  control,
  label,
  onControlChange,
  children,
}: {
  control: FlightControl;
  label: string;
  onControlChange: (control: FlightControl, pressed: boolean) => void;
  children: React.ReactNode;
}) {
  const release = () => onControlChange(control, false);
  const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onControlChange(control, true);
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
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
  onControlChange: (control: FlightControl, pressed: boolean) => void;
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
          <div><strong>Flight mode</strong><span>Third-person camera</span></div>
        </div>
        <dl className="flight-telemetry">
          <div><dt>ALT</dt><dd>{Math.round(telemetry.altitude)} m</dd></div>
          <div><dt>SPD</dt><dd>{Math.round(telemetry.speed * 3.6)} km/h</dd></div>
          <div><dt>HDG</dt><dd>{String(Math.round(telemetry.heading) % 360).padStart(3, '0')}°</dd></div>
        </dl>
        <button ref={exitButtonRef} className="flight-exit" type="button" onClick={onExit}>
          <LogOut aria-hidden="true" />
          <span>Exit flight</span>
        </button>
      </header>

      <div className="flight-reticle" aria-hidden="true"><span /></div>

      <div className="flight-inputs">
        <div className="flight-input-group" aria-label="Roll controls">
          <span>Roll</span>
          <div>
            <HoldControl control="rollLeft" label="Roll left" onControlChange={onControlChange}>
              <ArrowLeft aria-hidden="true" />
            </HoldControl>
            <HoldControl control="rollRight" label="Roll right" onControlChange={onControlChange}>
              <ArrowRight aria-hidden="true" />
            </HoldControl>
          </div>
        </div>
        <p className="flight-key-help"><kbd>W</kbd><kbd>S</kbd> pitch · <kbd>A</kbd><kbd>D</kbd> roll</p>
        <div className="flight-input-group" aria-label="Pitch controls">
          <span>Pitch</span>
          <div>
            <HoldControl control="pitchUp" label="Pitch up" onControlChange={onControlChange}>
              <ArrowUp aria-hidden="true" />
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
