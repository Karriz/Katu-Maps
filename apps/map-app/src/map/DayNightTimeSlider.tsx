import { MoonStar, Sun, Sunrise, X } from 'lucide-react';
import { dayNightPhaseLabel, localMinutesAt, utcMsFromLocalMinutes, type DayNightPhase } from './DayNightSun';
import type { DayNightAppearance } from './DayNightAppearance';

function formatClock(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function phaseIcon(phase: DayNightPhase) {
  if (phase === 'day' || phase === 'golden') return Sun;
  if (phase === 'sunset' || phase === 'civil') return Sunrise;
  return MoonStar;
}

export function DayNightTimeSlider({
  appearance,
  timeZone,
  followNow,
  weatherOverlayOpen,
  onTimeChange,
  onFollowNow,
  onClose,
}: {
  appearance: DayNightAppearance;
  timeZone: string;
  followNow: boolean;
  weatherOverlayOpen: boolean;
  onTimeChange: (utcMs: number) => void;
  onFollowNow: () => void;
  onClose: () => void;
}) {
  const minutes = localMinutesAt(appearance.date, timeZone);
  const Icon = phaseIcon(appearance.phase);
  const zoneName = timeZone.replace(/_/g, ' ').split('/').pop() ?? timeZone;
  return (
    <div
      className={`weather-time-slider day-night-time-slider${weatherOverlayOpen ? ' with-weather-overlay' : ''}`}
      role="region"
      aria-label="Day and night time"
    >
      <div className="weather-time-slider-header">
        <div className="weather-time-slider-modes" role="group" aria-label="Clock">
          <span className="day-night-time-phase">
            <Icon aria-hidden="true" />
            {dayNightPhaseLabel(appearance.phase)}
          </span>
          <button type="button" aria-pressed={followNow} onClick={onFollowNow}>
            Now
          </button>
        </div>
        <button className="weather-time-slider-close" type="button" aria-label="Turn off day and night" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="weather-time-slider-body">
        <strong>{formatClock(appearance.date, timeZone)}</strong>
        <span>{zoneName} · sunlight, night shade and city lights</span>
      </div>
      <input
        aria-label="Time of day"
        max={1439}
        min={0}
        step={5}
        type="range"
        value={minutes}
        onChange={(event) => {
          onTimeChange(utcMsFromLocalMinutes(appearance.date.getTime(), timeZone, Number(event.currentTarget.value)));
        }}
      />
    </div>
  );
}
