import { useCallback, useRef } from 'react';
import type { RouteResult } from './ValhallaRouting';

type RouteVehicleRestore = { result: RouteResult; following: boolean };

export function useRouteVehicleRestore() {
  const restoreRef = useRef<RouteVehicleRestore | null>(null);
  const remember = useCallback((result: RouteResult, following: boolean) => {
    restoreRef.current = { result, following };
  }, []);
  const take = useCallback(() => {
    const restore = restoreRef.current;
    restoreRef.current = null;
    return restore;
  }, []);
  const clear = useCallback(() => { restoreRef.current = null; }, []);

  return { remember, take, clear };
}
