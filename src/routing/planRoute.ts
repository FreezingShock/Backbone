import type { GraphFile } from './graphFile';
import { RoutingGraph } from './graph';
import { buildLeg, type BuiltLeg } from './legs';
import { rollUpDifficulty } from './difficulty';
import { findPath } from './search';
import type { LonLat, PlanOptions, Route, Stop } from './types';

/** The graph the planner uses. Set by loadRoutingGraph or setRoutingGraph before planning. */
let active: RoutingGraph | null = null;

/** Default location of the graph file, served from public/. */
export const ROUTING_GRAPH_URL = '/data/routing-graph.json';

/** A stop farther than this from any mapped road is worth a warning. Past FAR_TO_PLAN_M it cannot be planned. */
const FAR_FROM_ROAD_M = 400;
const FAR_TO_PLAN_M = 5000;

export function getRoutingGraph(): RoutingGraph | null {
  return active;
}

/** Makes an already-parsed graph the active one. Used by tests and by loadRoutingGraph. */
export function setRoutingGraph(file: GraphFile): RoutingGraph {
  active = RoutingGraph.fromFile(file);
  return active;
}

/**
 * Fetches the graph file once and makes it active. Later calls return the active graph without fetching again.
 * Pass a different URL only for tests or a staging copy.
 */
export async function loadRoutingGraph(url: string = ROUTING_GRAPH_URL): Promise<RoutingGraph> {
  if (active) return active;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Routing graph did not load: HTTP ${response.status}`);
  const file = (await response.json()) as GraphFile;
  return setRoutingGraph(file);
}

function requireGraph(): RoutingGraph {
  if (!active) throw new Error('Routing graph is not loaded. Call loadRoutingGraph() first.');
  return active;
}

function nodeFor(graph: RoutingGraph, stop: Stop, warnings: string[]): number {
  const near = graph.nearestNode(stop.lon, stop.lat);
  if (!near || near.meters > FAR_TO_PLAN_M) throw new Error(`No mapped road near ${stop.name}`);
  if (near.meters > FAR_FROM_ROAD_M) {
    warnings.push(`${stop.name} is ${Math.round(near.meters)} m from the nearest mapped road.`);
  }
  return near.node;
}

/**
 * Plans a route through stops, in order. Each stop snaps to the nearest junction, and each leg is the fastest
 * path between neighbors. Canyon routes avoid highway-class roads by default. A leg falls back to highways only
 * when no path exists without them, and the route then carries a warning.
 */
export function planRoute(stops: Stop[], options: PlanOptions = {}): Route {
  const graph = requireGraph();
  if (stops.length < 2) throw new Error('A route needs at least two stops.');

  const avoidHighways = options.avoidHighways ?? true;
  const avoidLocal = options.avoidLocal ?? false;
  const departAt = options.departAt ?? new Date().toISOString();
  const departMs = Date.parse(departAt);
  if (Number.isNaN(departMs)) throw new Error(`departAt is not a valid time: ${departAt}`);

  const warnings: string[] = [];
  const allowed = (blockHighways: boolean) => (edge: number) => {
    const cls = graph.classOf(edge);
    if (blockHighways && cls === 'highway') return false;
    if (avoidLocal && cls === 'local') return false;
    return true;
  };

  const nodes = stops.map((stop) => nodeFor(graph, stop, warnings));
  const built: BuiltLeg[] = [];
  let usedHighwayFallback = false;

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    let path = findPath(graph, nodes[i - 1], nodes[i], allowed(avoidHighways));
    if (!path && avoidHighways) {
      path = findPath(graph, nodes[i - 1], nodes[i], allowed(false));
      if (path) usedHighwayFallback = true;
    }
    if (!path) throw new Error(`No road route from ${from.name} to ${to.name}`);
    built.push(
      buildLeg(graph, {
        from,
        to,
        fromNode: nodes[i - 1],
        refs: path.refs,
      }),
    );
  }

  if (usedHighwayFallback) {
    warnings.push('Some legs use a highway, because no canyon-only path joins those stops.');
  }
  if (graph.controls.size === 0) {
    warnings.push('Stop signs and traffic signals are not in the road data yet, so their steps and delays are left out.');
  }

  const legs = built.map((item) => item.leg);
  const geometry: LonLat[] = [];
  for (const leg of legs) {
    for (const point of leg.geometry) {
      const last = geometry[geometry.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) geometry.push(point);
    }
  }

  const allParts = built.flatMap((item) => item.parts);
  const rolled = rollUpDifficulty(allParts.map((part) => ({ meters: part.meters, score: part.score })));
  const durationS = legs.reduce((sum, leg) => sum + leg.durationS, 0);

  return {
    stops,
    legs,
    distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
    durationS,
    difficulty: rolled.difficulty,
    geometry,
    departAt: new Date(departMs).toISOString(),
    arriveAt: new Date(departMs + durationS * 1000).toISOString(),
    warnings,
  };
}
