import type { RouteMode } from './ValhallaRouting';
import type { TransitPositionStatus } from './transit';

export function MapCameraActions({
  routeMode,
  infoPanelOpen,
  vehicleFollowAvailable,
  vehicleFollowing,
  vehiclePositionStatus,
  onPauseVehicleFollow,
  onResumeVehicleFollow,
  onFitRoute,
}: {
  routeMode: RouteMode;
  infoPanelOpen: boolean;
  vehicleFollowAvailable: boolean;
  vehicleFollowing: boolean;
  vehiclePositionStatus: TransitPositionStatus;
  onPauseVehicleFollow: () => void;
  onResumeVehicleFollow: () => void;
  onFitRoute: () => void;
}) {
  return (
    <div className={`map-camera-actions${infoPanelOpen ? ' info-panel-open' : ''}`} aria-label="Map camera controls">
      {routeMode === 'transit' && vehicleFollowAvailable && (
        <button
          className="map-floating-action"
          type="button"
          aria-pressed={vehicleFollowing}
          onClick={vehicleFollowing ? onPauseVehicleFollow : onResumeVehicleFollow}
        >
          {vehicleFollowing
            ? `Following ${vehiclePositionStatus === 'live' ? 'live' : 'estimated'} vehicle`
            : `Follow ${vehiclePositionStatus === 'live' ? 'live' : 'estimated'} vehicle`}
        </button>
      )}
      <button className="map-floating-action" type="button" onClick={() => {
        onPauseVehicleFollow();
        onFitRoute();
      }}>
        Fit route
      </button>
    </div>
  );
}
