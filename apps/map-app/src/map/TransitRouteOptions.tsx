import { Check, Footprints } from 'lucide-react';
import type { TransitRouteResult } from './transit';

type TransitRouteLeg = TransitRouteResult['transitLegs'][number];

type TransitRouteOptionsProps = {
  options: TransitRouteResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

function normalizedTransitMode(mode: string) {
  return mode.trim().toUpperCase();
}

export function isWalkingTransitMode(mode: string) {
  return ['WALK', 'FOOT', 'PEDESTRIAN'].includes(normalizedTransitMode(mode));
}

export function transitModeLabel(mode: string) {
  const normalized = normalizedTransitMode(mode);
  if (isWalkingTransitMode(normalized)) return 'Walk';
  if (['TRAM', 'LIGHT_RAIL'].includes(normalized)) return 'Tram';
  if (['BUS', 'COACH', 'TROLLEYBUS'].includes(normalized)) return 'Bus';
  if (['SUBWAY', 'METRO'].includes(normalized)) return 'Metro';
  if (['RAIL', 'TRAIN', 'SUBURBAN', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL'].includes(normalized)) return 'Train';
  if (['FERRY', 'WATER'].includes(normalized)) return 'Ferry';
  if (['FUNICULAR', 'CABLE_CAR', 'GONDOLA'].includes(normalized)) return 'Cable car';
  return normalized.replaceAll('_', ' ').toLocaleLowerCase().replace(/^./, (letter) => letter.toLocaleUpperCase());
}

function transitModeStyle(mode: string) {
  const normalized = normalizedTransitMode(mode);
  if (['TRAM', 'LIGHT_RAIL'].includes(normalized)) return 'tram';
  if (['BUS', 'COACH', 'TROLLEYBUS'].includes(normalized)) return 'bus';
  if (['SUBWAY', 'METRO'].includes(normalized)) return 'metro';
  if (['RAIL', 'TRAIN', 'SUBURBAN', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL'].includes(normalized)) return 'rail';
  if (['FERRY', 'WATER'].includes(normalized)) return 'ferry';
  return 'transit';
}

function normalizedRouteColor(value?: string) {
  if (!value) return undefined;
  const color = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

function transitTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function transitDuration(durationSeconds: number) {
  const minutes = Math.max(0, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const remainingMinutes = minutes % 60;
  return `${Math.floor(minutes / 60)} h${remainingMinutes ? ` ${remainingMinutes} min` : ''}`;
}

export function transitTransferLabel(transfers: number) {
  if (transfers <= 0) return 'Direct';
  return `${transfers} ${transfers === 1 ? 'transfer' : 'transfers'}`;
}

function legLabel(leg: TransitRouteLeg) {
  const mode = transitModeLabel(leg.mode);
  return isWalkingTransitMode(leg.mode) || !leg.route ? mode : `${mode} ${leg.route}`;
}

export function transitRouteOptionLabel(option: TransitRouteResult) {
  const departure = transitTime(option.departureTime);
  const arrival = transitTime(option.arrivalTime);
  const times = departure && arrival ? `${departure} to ${arrival}` : departure || arrival || 'Time unavailable';
  const sequence = option.transitLegs.map(legLabel).join(', ') || 'Transit route';
  return `${times}, ${transitDuration(option.durationSeconds)}, ${transitTransferLabel(option.transfers)}, via ${sequence}`;
}

function TransitLegSequence({ legs }: { legs: TransitRouteLeg[] }) {
  if (!legs.length) return <span className="transit-option-route-fallback">Transit route</span>;
  return legs.map((leg, index) => {
    const walking = isWalkingTransitMode(leg.mode);
    const label = legLabel(leg);
    return (
      <span className="transit-option-sequence-part" key={`${leg.mode}-${leg.route ?? ''}-${index}`}>
        {index > 0 && <span className="transit-option-connector" aria-hidden="true">›</span>}
        {walking ? (
          <span className="transit-option-walk" aria-label={label}>
            <Footprints aria-hidden="true" />
            <span>Walk</span>
          </span>
        ) : (
          <span
            className={`transit-option-route-badge ${transitModeStyle(leg.mode)}`}
            aria-label={label}
            style={{
              backgroundColor: normalizedRouteColor(leg.routeColor),
              color: normalizedRouteColor(leg.routeTextColor),
            }}
            title={label}
          >
            {leg.route || transitModeLabel(leg.mode)}
          </span>
        )}
      </span>
    );
  });
}

export function TransitRouteOptions({ options, selectedIndex, onSelect }: TransitRouteOptionsProps) {
  return (
    <div className="transit-route-options" aria-label="Transit route options">
      <strong className="transit-route-options-heading">Choose a trip</strong>
      {options.slice(0, 3).map((option, index) => {
        const selected = selectedIndex === index;
        const departure = transitTime(option.departureTime);
        const arrival = transitTime(option.arrivalTime);
        return (
          <button
            className={`transit-route-option${selected ? ' active' : ''}`}
            aria-label={transitRouteOptionLabel(option)}
            aria-pressed={selected}
            data-provider={option.provider}
            key={`${option.provider}-${option.departureTime}-${option.arrivalTime}-${index}`}
            type="button"
            onClick={() => onSelect(index)}
          >
            <span className="transit-option-heading">
              <span className="transit-option-times">
                {departure && <time dateTime={option.departureTime}>{departure}</time>}
                <span aria-hidden="true">–</span>
                {arrival && <time dateTime={option.arrivalTime}>{arrival}</time>}
                {!departure && !arrival && <strong>Time unavailable</strong>}
              </span>
              <span className="transit-option-duration">{transitDuration(option.durationSeconds)}</span>
              <span className="transit-option-transfer">{transitTransferLabel(option.transfers)}</span>
              {selected && (
                <span className="transit-option-selected" aria-hidden="true">
                  <Check /> Selected
                </span>
              )}
            </span>
            <span className="transit-option-sequence" aria-hidden="true">
              <TransitLegSequence legs={option.transitLegs} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
