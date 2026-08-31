import { useRef, useState } from 'react';
import type { TransitVehiclePose } from './TransitStopsLayer';
import type { TransitPositionStatus } from './transit';

export function useTransitVehicleFollow() {
  const vehicleFollowEnabledRef = useRef(false);
  const latestVehiclePoseRef = useRef<TransitVehiclePose | null>(null);
  const [vehicleFollowing, setVehicleFollowing] = useState(false);
  const [vehicleFollowAvailable, setVehicleFollowAvailable] = useState(false);
  const vehicleFollowingRef = useRef(vehicleFollowing);
  vehicleFollowingRef.current = vehicleFollowing;
  const [vehiclePositionStatus, setVehiclePositionStatus] = useState<TransitPositionStatus>('unavailable');

  return {
    vehicleFollowEnabledRef,
    latestVehiclePoseRef,
    vehicleFollowing,
    setVehicleFollowing,
    vehicleFollowingRef,
    vehicleFollowAvailable,
    setVehicleFollowAvailable,
    vehiclePositionStatus,
    setVehiclePositionStatus,
  };
}
