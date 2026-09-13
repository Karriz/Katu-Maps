import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Car, X } from 'lucide-react';
import type { DriveControl, DriveTelemetry } from './useDriveSimulator';

function HoldControl({
  control,
  label,
  onControlChange,
  children,
  className,
}: {
  control: DriveControl;
  label: string;
  onControlChange: (control: DriveControl, pressed: boolean, source?: string) => void;
  children: React.ReactNode;
  className?: string;
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
      className={className}
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

export function DriveControls({
  telemetry,
  onControlChange,
  onExit,
}: {
  telemetry: DriveTelemetry;
  onControlChange: (control: DriveControl, pressed: boolean, source?: string) => void;
  onExit: () => void;
}) {
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    exitButtonRef.current?.focus();
  }, []);

  return (
    <section className="drive-controls" aria-label="Drive simulator controls">
      <button
        ref={exitButtonRef}
        className="drive-exit"
        type="button"
        aria-label="Exit drive"
        title="Exit drive"
        onClick={onExit}
      >
        <X aria-hidden="true" />
      </button>

      <dl className="drive-telemetry" aria-label="Drive meters">
        <div><dt>SPD</dt><dd>{Math.round(Math.abs(telemetry.speed) * 3.6)} km/h</dd></div>
        <div><dt>PWR</dt><dd>{Math.round(telemetry.throttle * 100)}%</dd></div>
        <div><dt>HDG</dt><dd>{String(Math.round(telemetry.heading) % 360).padStart(3, '0')}°</dd></div>
      </dl>

      <div className="drive-inputs">
        <div className="drive-input-group drive-handbrake-control" aria-label="Handbrake">
          <span>Brake</span>
          <HoldControl
            control="handbrake"
            label="Handbrake"
            className={telemetry.handbrake ? 'is-active' : undefined}
            onControlChange={onControlChange}
          >
            HB
          </HoldControl>
        </div>

        <div className="drive-input-stack">
          <p className="drive-key-help">
            <kbd>W</kbd> gas · <kbd>S</kbd> brake · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> handbrake
          </p>

          <div className="drive-input-group drive-stick-control" aria-label="Drive controls">
            <span>Drive</span>
            <div className="drive-stick-grid">
              <HoldControl control="throttleUp" label="Accelerate" onControlChange={onControlChange}>
                <ArrowUp aria-hidden="true" />
              </HoldControl>
              <HoldControl control="steerLeft" label="Steer left" onControlChange={onControlChange}>
                <ArrowLeft aria-hidden="true" />
              </HoldControl>
              <span className="drive-stick-center" aria-hidden="true"><Car /></span>
              <HoldControl control="steerRight" label="Steer right" onControlChange={onControlChange}>
                <ArrowRight aria-hidden="true" />
              </HoldControl>
              <HoldControl control="throttleDown" label="Brake or reverse" onControlChange={onControlChange}>
                <ArrowDown aria-hidden="true" />
              </HoldControl>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
