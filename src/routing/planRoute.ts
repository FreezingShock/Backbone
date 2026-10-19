import type { GraphFile } from './graphFile';
import { RoutingGraph } from './graph';
import { buildLeg, type BuiltLeg } from './legs';
import { rollUpDifficulty } from './difficulty';
import { findPath } from './search';
import type { LonLat, PlanOptions, Route, RoadClass, Stop } from './types';

/** The graph the planner uses. Set by loadRoutingGraph or setRoutingGraph before planning. */
let active: RoutingGraph | null = null;

/** Default location of the graph file, served from public/. */
export const ROUTING_GRAPH_URL = '/data/routing-graph.json';

/** A stop farther than this from any mapped road is worth a warning. Past FAR_TO_PLAN_M it cannot be planned. */
const FAR_FROM_ROAD_M = 400;
const FAR_TO_PLAN_M = 5000;

/**
 * Time multipliers by road class, for the search only. Canyon crossings are the cheapest way across the hills,
 * and freeways and local streets cost more, but none is banned, so a route is found whenever the road graph allows
 * one. Each value is at least 0.8, which keeps the search heuristic admissible (see search.ts).
 */
export const CLASS_WEIGHT: Record<RoadClass, number> = {
  crossing: 0.8,
  arterial: 1,
  collector: 1.05,
  local: 1.2,
  highway: 4,
};
/** An alternative with more than this share of its distance on a highway is not offered as a canyon alternative. */
const ALTERNATIVE_MAX_HIGHWAY_SHARE = 0.1;
/** Weight for local streets when avoidLocal is set. Kept under the freeway weight, so a freeway is still the last resort. */
const LOCAL_AVOID_WEIGHT = 3;
/** Weight on a road named by an earlier alternative, so the next alternative takes a different canyon. */
const PENALTY_STEPS = [3, 10, 40];

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

/** A main road, and the factor its edges are weighted by in a search. Kind says which table the key is in. */
interface Penalty {
  kind: 'crossing' | 'road';
  key: string;
  factor: number;
}

/** Per-edge weights for one search. Built once per planning call and reused by every leg. */
function edgeWeights(graph: RoutingGraph, options: PlanOptions, penalties: Penalty[]): Float64Array {
  const weights = new Float64Array(graph.edgeCount);
  // Canyon weighting applies in the default mode. With avoidHighways off, every road is weighted by its drive time alone.
  const canyonMode = options.avoidHighways ?? true;
  const avoidLocal = options.avoidLocal ?? false;
  const crossingFactor = new Float64Array(graph.crossings.length).fill(1);
  const nameFactor = new Float64Array(graph.names.length).fill(1);
  for (const penalty of penalties) {
    if (penalty.kind === 'crossing') {
      const index = graph.crossings.indexOf(penalty.key);
      if (index > 0) crossingFactor[index] = penalty.factor;
    } else {
      const index = graph.names.indexOf(penalty.key);
      if (index > 0) nameFactor[index] = penalty.factor;
    }
  }
  for (let edge = 0; edge < graph.edgeCount; edge++) {
    const cls = graph.classOf(edge);
    let weight = canyonMode ? CLASS_WEIGHT[cls] : 1;
    if (cls === 'local' && avoidLocal) weight = Math.max(weight, LOCAL_AVOID_WEIGHT);
    weights[edge] = weight * crossingFactor[graph.edgeCrossing[edge]] * nameFactor[graph.edgeName[edge]];
  }
  return weights;
}

/** One planned route before alternatives are chosen. */
interface Solved {
  route: Route;
  /** The main road: the canyon crossing with the most distance, else the named road with the most distance. */
  main: Penalty | null;
}

/**
 * Plans one route through the stops with the given weights. Every leg is the cheapest path between its neighbors.
 * Throws when a stop is not near a road or a leg cannot be joined at all.
 */
function solve(graph: RoutingGraph, stops: Stop[], nodes: number[], stopWarnings: string[], options: PlanOptions, weights: Float64Array): Solved {
  const warnings = [...stopWarnings];
  const departAt = options.departAt ?? new Date().toISOString();
  const departMs = Date.parse(departAt);
  if (Number.isNaN(departMs)) throw new Error(`departAt is not a valid time: ${departAt}`);

  const built: BuiltLeg[] = [];
  const crossingMeters = new Map<string, number>();
  const roadMeters = new Map<string, number>();
  let highwayMeters = 0;
  let totalMeters = 0;

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    // Route choice ignores stop and signal delays; the leg's time adds them below.
    const path = findPath(graph, nodes[i - 1], nodes[i], () => true, weights, false);
    if (!path) throw new Error(`No road route from ${from.name} to ${to.name}`);
    for (const ref of path.refs) {
      const edge = ref >> 1;
      const meters = graph.edgeMeters[edge];
      totalMeters += meters;
      if (graph.classOf(edge) === 'highway') highwayMeters += meters;
      const crossing = graph.crossingOf(edge);
      if (crossing) crossingMeters.set(crossing, (crossingMeters.get(crossing) ?? 0) + meters);
      const name = graph.nameOf(edge);
      if (name) roadMeters.set(name, (roadMeters.get(name) ?? 0) + meters);
    }
    built.push(buildLeg(graph, { from, to, fromNode: nodes[i - 1], refs: path.refs }));
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

  const avoidHighways = options.avoidHighways ?? true;
  if (avoidHighways && highwayMeters > 0) {
    warnings.push(`Uses a highway for ${(highwayMeters / 1000).toFixed(1)} km, because the canyon roads there are much longer.`);
  }
  if (graph.controls.size === 0) {
    warnings.push('Stop signs and traffic signals are not in the road data yet, so their steps and delays are left out.');
  }

  const main = mainRoad(crossingMeters, roadMeters);
  return {
    main,
    route: {
      stops,
      legs,
      distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
      durationS,
      difficulty: rolled.difficulty,
      geometry,
      departAt: new Date(departMs).toISOString(),
      arriveAt: new Date(departMs + durationS * 1000).toISOString(),
      warnings,
      label: main?.key ?? 'Local roads',
      highwayShare: totalMeters > 0 ? highwayMeters / totalMeters : 0,
    },
  };
}

function mainRoad(crossingMeters: Map<string, number>, roadMeters: Map<string, number>): Penalty | null {
  const top = (map: Map<string, number>): string | null => {
    let best: string | null = null;
    let bestMeters = 0;
    for (const [key, meters] of map) {
      if (meters > bestMeters) {
        best = key;
        bestMeters = meters;
      }
    }
    return best;
  };
  const crossing = top(crossingMeters);
  if (crossing) return { kind: 'crossing', key: crossing, factor: 1 };
  const road = top(roadMeters);
  return road ? { kind: 'road', key: road, factor: 1 } : null;
}

/**
 * Plans a route through stops, in order. Each stop snaps to the nearest junction. Legs prefer canyon crossings and
 * other non-freeway roads, and freeways are priced heavily rather than banned, so a route is found whenever the road
 * graph connects the stops. Warns when part of the route is on a highway.
 */
export function planRoute(stops: Stop[], options: PlanOptions = {}): Route {
  const graph = requireGraph();
  if (stops.length < 2) throw new Error('A route needs at least two stops.');
  const warnings: string[] = [];
  const nodes = stops.map((stop) => nodeFor(graph, stop, warnings));
  const weights = edgeWeights(graph, options, []);
  return { ...solve(graph, stops, nodes, warnings, options, weights).route, alternative: 0 };
}

/**
 * Up to `maxRoutes` distinct canyon routes through the stops, preferred first. The first is what planRoute returns.
 * Each later one is found with a penalty on the main roads already used, so it takes a different canyon crossing.
 * Each route carries its main road name as `label`, its share on highways as `highwayShare`, and its position as
 * `alternative`. An alternative is dropped when it repeats a main road, runs mostly on a freeway, or has no canyon
 * crossing as its main road, so the result may hold fewer than maxRoutes.
 */
export function planRoutes(stops: Stop[], options: PlanOptions = {}): Route[] {
  const graph = requireGraph();
  if (stops.length < 2) throw new Error('A route needs at least two stops.');
  const limit = Math.max(1, Math.min(3, options.maxRoutes ?? 3));
  const stopWarnings: string[] = [];
  const nodes = stops.map((stop) => nodeFor(graph, stop, stopWarnings));

  const first = solve(graph, stops, nodes, stopWarnings, options, edgeWeights(graph, options, []));
  const found: Solved[] = [first];
  // Main roads already used by a route. Each new alternative must avoid all of them.
  const usedMains: Penalty[] = first.main ? [first.main] : [];

  while (found.length < limit && usedMains.length > 0) {
    let accepted: Solved | null = null;
    for (const factor of PENALTY_STEPS) {
      const penalties = usedMains.map((penalty) => ({ ...penalty, factor }));
      const candidate = solve(graph, stops, nodes, stopWarnings, options, edgeWeights(graph, options, penalties));
      const repeats = usedMains.some((used) => used.kind === candidate.main?.kind && used.key === candidate.main?.key);
      const onFreeway = (candidate.route.highwayShare ?? 0) > ALTERNATIVE_MAX_HIGHWAY_SHARE;
      const isCanyon = candidate.main?.kind === 'crossing';
      if (candidate.main && isCanyon && !repeats && !onFreeway) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted || !accepted.main) break;
    found.push(accepted);
    usedMains.push(accepted.main);
  }

  // The preferred route stays first. The alternatives follow, quickest first.
  const rest = found.slice(1).sort((a, b) => a.route.durationS - b.route.durationS);
  return [first, ...rest].map((item, index) => ({ ...item.route, alternative: index }));
}
