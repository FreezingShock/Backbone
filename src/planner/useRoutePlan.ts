import { useEffect, useState } from 'react';
import { planRouteOptions, type RouteOption } from './engine';
import type { PlanState } from './planState';

export interface PlanResult {
  /** Preferred route first. Empty until there are two stops and a plan has come back. */
  options: RouteOption[];
  error: string | null;
  loading: boolean;
}

const IDLE: PlanResult = { options: [], error: null, loading: false };
/** Waits this long after the last edit, so dragging a stop does not plan every frame. */
const SETTLE_MS = 120;

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not plan this route.';
}

/**
 * Plans the route whenever the stops, network or departure change. A stale result is dropped, so a slow plan
 * cannot overwrite a newer one.
 */
export function useRoutePlan(state: PlanState): PlanResult {
  const [result, setResult] = useState<PlanResult>(IDLE);

  useEffect(() => {
    if (state.stops.length < 2) {
      setResult(IDLE);
      return;
    }
    let cancelled = false;
    setResult((previous) => ({ ...previous, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      const departAt = state.depart.mode === 'at' ? state.depart.iso : new Date().toISOString();
      planRouteOptions(state.stops, { network: state.network, departAt })
        .then((options) => {
          if (!cancelled) setResult({ options, error: null, loading: false });
        })
        .catch((error: unknown) => {
          if (!cancelled) setResult({ options: [], error: messageOf(error), loading: false });
        });
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state.stops, state.network, state.depart]);

  return result;
}
