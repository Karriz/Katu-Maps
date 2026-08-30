import type { Ref } from 'react';
import { ArrowDown, ArrowLeft, MapPin } from 'lucide-react';
import type { RouteResult } from './ValhallaRouting';
import type { TransitRouteResult } from './transit';
import {
  isWalkingTransitMode,
  transitDuration,
  transitModeLabel,
  transitTransferLabel,
} from './TransitRouteOptions';
import { formatDistance } from './DistanceMeasurement';

type TransitJourneyDetailsProps = {
  routeResult: RouteResult;
  originName?: string;
  destinationName?: string;
  selectedOption?: TransitRouteResult;
  backButtonRef: Ref<HTMLButtonElement>;
  onBack: () => void;
};

type TransitJourneyTimelineProps = Pick<TransitJourneyDetailsProps, 'routeResult' | 'destinationName' | 'selectedOption'>;

function routeColor(value?: string) {
  if (!value) return undefined;
  const color = value.trim().replace(/^#/, '');
  return /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? `#${color}` : undefined;
}

function transitTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function legDuration(startTime?: string, endTime?: string) {
  const start = startTime ? Date.parse(startTime) : NaN;
  const end = endTime ? Date.parse(endTime) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  return transitDuration((end - start) / 1000);
}

export function TransitJourneyHeader({
  originName,
  destinationName,
  selectedOption,
  backButtonRef,
  onBack,
}: Pick<TransitJourneyDetailsProps, 'originName' | 'destinationName' | 'selectedOption' | 'backButtonRef' | 'onBack'>) {
  return (
    <div className="transit-journey-header">
      <button ref={backButtonRef} className="transit-journey-back" type="button" aria-label="Back to route options" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
      </button>
      <div className="transit-journey-heading">
        <strong>Journey details</strong>
        <span>{originName || 'Start'} to {destinationName || 'Destination'}</span>
        {selectedOption && (
          <small>
            {transitTime(selectedOption.departureTime)}–{transitTime(selectedOption.arrivalTime)}
            {' · '}{transitDuration(selectedOption.durationSeconds)}
            {' · '}{transitTransferLabel(selectedOption.transfers)}
          </small>
        )}
      </div>
    </div>
  );
}

export function TransitJourneyDetails({
  routeResult,
  destinationName,
  selectedOption,
}: TransitJourneyTimelineProps) {
  const legs = routeResult.transitLegs ?? [];
  return (
    <div className="transit-route-legs" aria-label="Transit route legs">
        {legs.map((leg, index) => {
          const walking = isWalkingTransitMode(leg.mode);
          const color = routeColor(leg.routeColor);
          const duration = legDuration(leg.startTime, leg.endTime);
          const distance = typeof leg.distanceMeters === 'number' && Number.isFinite(leg.distanceMeters)
            ? formatDistance(leg.distanceMeters)
            : '';
          const from = leg.from?.name || (index === 0 ? 'Start' : 'Transfer point');
          const to = leg.to?.name || (index === legs.length - 1 ? 'Destination' : 'Next stop');
          const previousLeg = legs[index - 1];
          const transfer = index > 0 && !walking && previousLeg && (
            !isWalkingTransitMode(previousLeg.mode)
            || (index > 1 && isWalkingTransitMode(previousLeg.mode) && !isWalkingTransitMode(legs[index - 2].mode))
          );
          return (
            <div key={`${leg.mode}-${leg.route}-${index}`}>
              {transfer && <div className="transit-transfer-marker"><ArrowDown aria-hidden="true" /><span>Change at {from}</span></div>}
              <div className={`transit-route-leg ${walking ? 'walking' : 'vehicle'}`}>
                <div
                  className="transit-route-leg-marker"
                  aria-hidden="true"
                  style={!walking && color ? { backgroundColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
                >
                  {walking ? '·' : index + 1}
                </div>
                <div className="transit-route-leg-copy">
                  <div className="transit-route-leg-title">
                    <strong>{walking ? `Walk${[duration, distance].filter(Boolean).join(' · ') ? ` · ${[duration, distance].filter(Boolean).join(' · ')}` : ''}` : `${transitModeLabel(leg.mode)}${leg.route ? ` ${leg.route}` : ''}`}</strong>
                    <time>{transitTime(leg.startTime)}{leg.endTime ? `–${transitTime(leg.endTime)}` : ''}</time>
                  </div>
                  {!walking && <span className="transit-route-leg-headsign">{leg.headsign || 'Towards destination'}{leg.cancelled ? ' · Cancelled' : leg.delaySeconds && leg.delaySeconds > 0 ? ` · +${Math.ceil(leg.delaySeconds / 60)} min` : leg.realTime ? ' · Realtime' : ''}</span>}
                  <div className="transit-route-stations">
                    <div><small>{walking ? 'From' : 'Board at'}</small><strong>{from}</strong></div>
                    <div className="transit-route-station-line" aria-hidden="true" />
                    <div><small>{walking ? 'To' : 'Exit at'}</small><strong>{to}</strong></div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div className="transit-route-arrival">
          <MapPin aria-hidden="true" />
          <div><small>Arrive</small><strong>{destinationName || legs.at(-1)?.to?.name || 'Destination'}</strong></div>
          {selectedOption?.arrivalTime && <time>{transitTime(selectedOption.arrivalTime)}</time>}
        </div>
    </div>
  );
}
