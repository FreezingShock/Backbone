// The planner's view of the routing engine (src/routing/, owned by the routing thread). The engine is synchronous
// and needs its road graph loaded first, so these wrappers load it once and then call through. The planner's
// Network choice maps onto the engine's PlanOptions flags.
import { customStop as engineCustomStop, loadRoutingGraph, planRoute as enginePlanRoute, suggestStops as engineSuggest } from '../routing';
import type { SuggestNear } from '../routing/types';
import type { Network, PlanOptions, Route, Stop } from './types';

export interface PlanRequest {
  network: Network;
  /** ISO 8601 time. Default: now. */
  departAt?: string;
}

/**
 * Canyon roads: no highways and no local streets. The engine has no crossings-only switch, so arterials and
 * collectors still count. All roads: no highways, local streets included.
 */
function optionsFor(network: Network, departAt?: string): PlanOptions {
  return { avoidHighways: true, avoidLocal: network === 'canyons', departAt };
}

export async function planRoute(stops: readonly Stop[], request: PlanRequest): Promise<Route> {
  await loadRoutingGraph();
  return enginePlanRoute([...stops], optionsFor(request.network, request.departAt));
}

/** Suggestions for the search box. Network is accepted for the same shape as planRoute; the engine's list is shared. */
export async function suggestStops(query: string, _request: { network: Network }, near?: SuggestNear, limit = 8): Promise<Stop[]> {
  await loadRoutingGraph();
  return engineSuggest(query, near, limit);
}

/** A stop from a map click. The engine snaps it to the nearest junction when routing. */
export function customStop(lon: number, lat: number): Stop {
  return engineCustomStop(lon, lat, 'Dropped pin');
}
