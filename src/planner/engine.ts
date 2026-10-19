// The planner's view of the routing engine (src/routing/, owned by the routing thread). The engine is synchronous
// and needs its road graph loaded first, so these wrappers load it once and then call through. The planner's
// Network choice maps onto the engine's PlanOptions flags.
import {
  customStop as engineCustomStop,
  intersectionId,
  loadRoutingGraph,
  planRoute as enginePlanRoute,
  suggestStops as engineSuggest,
} from '../routing';
import { metersBetween } from '../routing/geo';
import type { RoutingGraph } from '../routing/graph';
import type { SuggestNear } from '../routing/types';
import { EXTRA_STOPS } from './extraStops';
import type { Network, PlanOptions, Route, Stop } from './types';

/** A junction counts as a branch-off spot when at least this many road pieces meet there. */
const BRANCH_MIN_ROADS = 3;
/** Branch-off spots are only offered this close to the last stop. */
const BRANCH_RADIUS_M = 15000;

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

/**
 * Junctions where three or more roads meet, nearest first. These are the spots a route can branch from.
 * Degree comes from the routing graph's adjacency, so it counts road pieces, not names.
 */
function branchSpotsNear(graph: RoutingGraph, near: SuggestNear, limit: number): Stop[] {
  const found: { stop: Stop; meters: number }[] = [];
  for (const { node, label } of graph.intersections) {
    const degree = graph.adjacencyOffset[node + 1] - graph.adjacencyOffset[node];
    if (degree < BRANCH_MIN_ROADS) continue;
    const lon = graph.lon[node];
    const lat = graph.lat[node];
    const meters = metersBetween([near.lon, near.lat], [lon, lat]);
    if (meters > BRANCH_RADIUS_M) continue;
    found.push({ stop: { id: intersectionId(lon, lat), name: label, kind: 'intersection', lon, lat }, meters });
  }
  found.sort((a, b) => a.meters - b.meters);
  return found.slice(0, limit).map((entry) => entry.stop);
}

/**
 * Suggestions for the search box. With no query: branch-off spots near the last stop, then city centers. With a
 * query: matching cities, places and junctions from the routing engine, then the extra stops that match.
 */
export async function suggestStops(
  query: string,
  request: { network: Network; near?: SuggestNear },
  limit = 8,
): Promise<Stop[]> {
  const graph = await loadRoutingGraph();
  const typed = query.trim().toLowerCase();
  const tokens = typed.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    const branches = request.near ? branchSpotsNear(graph, request.near, Math.ceil(limit / 2)) : [];
    const cities = engineSuggest('', request.near, limit - branches.length);
    return [...branches, ...cities].slice(0, limit);
  }

  const fromEngine = engineSuggest(query, request.near, limit);
  const seen = new Set(fromEngine.map((stop) => stop.name.toLowerCase()));
  const extras = EXTRA_STOPS.filter((extra) => {
    const name = extra.name.toLowerCase();
    return !seen.has(name) && tokens.every((token) => name.includes(token));
  });
  return [...fromEngine, ...extras].slice(0, limit);
}

/** One route the rider can choose. `label` names the main road, such as "via Lynn Rd". */
export interface RouteOption {
  route: Route;
  label: string;
}

/**
 * Route options for the chooser, preferred first. Today the engine returns one route, so this is a list of one.
 * When the routing engine's planRoutes lands, this returns its alternatives, each with the road it goes through.
 */
export async function planRouteOptions(stops: readonly Stop[], request: PlanRequest): Promise<RouteOption[]> {
  const route = await planRoute(stops, request);
  return [{ route, label: mainRoadLabel(route) }];
}

/** The road the route spends the most distance on, as "via X". Falls back to "Canyon route" with no named road. */
export function mainRoadLabel(route: Route): string {
  const meters = new Map<string, number>();
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      if (!step.roadName) continue;
      meters.set(step.roadName, (meters.get(step.roadName) ?? 0) + step.distanceM);
    }
  }
  let best: string | null = null;
  let bestMeters = 0;
  for (const [name, total] of meters) {
    if (total > bestMeters) {
      best = name;
      bestMeters = total;
    }
  }
  return best ? `via ${best}` : 'Canyon route';
}

/** A stop from a map click. The engine snaps it to the nearest junction when routing. */
export function customStop(lon: number, lat: number): Stop {
  return engineCustomStop(lon, lat, 'Dropped pin');
}
