import type { GraphFile } from './graphFile';
import { RoutingGraph } from './graph';
import { buildLeg, type BuiltLeg } from './legs';
import { rollUpDifficulty } from './difficulty';
import { findPath } from './search';
import { FREEWAY_MOUNTAIN_WEIGHT, MOUNTAIN_ROAD_MIN, mountainWeight } from './mountain';
import { bearingDeg } from './geo';
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
/** An alternative that touches a freeway at all is not offered as a canyon alternative. */
const ALTERNATIVE_MAX_HIGHWAY_SHARE = 0;
/** Weight for local streets when avoidLocal is set. Kept under the freeway weight, so a freeway is still the last resort. */
const LOCAL_AVOID_WEIGHT = 3;
/**
 * Multiplier on the roads an earlier route used, so the next alternative leaves them at the first chance. Tried in
 * order; the first step that gives an acceptable alternative wins.
 */
const PENALTY_STEPS = [1.5, 2.5, 4, 8, 20];
/** Two routes that share more than this share of the shorter one are near-identical, and only one is kept. */
const MAX_SHARED_FRACTION = 0.7;
/** With mountainRoads on, an alternative must run at least this share of its distance on mountain roads. */
const MIN_MOUNTAIN_ALTERNATIVE = 0.5;
/** With mountainRoads on, a route may run at most this many meters on valley roads beside the 101 (access legs only). */
const MAX_CORRIDOR_M = 4000;
/** An alternative more than this many times as long as the preferred route is not offered. */
const MAX_ALTERNATIVE_TIME_FACTOR = 3;
/** A named canyon stretch shorter than this is left out of a route's summary. */
const SUMMARY_MIN_M = 1000;
const SUMMARY_MAX_STRETCHES = 3;
/** The most routes planRoutes returns, and the default when the caller does not ask for a number. */
const MAX_ROUTES = 6;
const DEFAULT_ROUTES = 4;
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

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

/** Per-edge weights for one search. Built once per search and reused by every leg. */
function edgeWeights(graph: RoutingGraph, options: PlanOptions, used: Uint8Array | null, usedFactor: number): Float64Array {
  const weights = new Float64Array(graph.edgeCount);
  // Canyon weighting applies in the default mode. With avoidHighways off, every road is weighted by its drive time alone.
  const canyonMode = options.avoidHighways ?? true;
  const mountainMode = canyonMode && (options.mountainRoads ?? false);
  const avoidLocal = options.avoidLocal ?? false;
  for (let edge = 0; edge < graph.edgeCount; edge++) {
    const cls = graph.classOf(edge);
    let weight: number;
    if (!canyonMode) weight = 1;
    else if (!mountainMode) weight = CLASS_WEIGHT[cls];
    else if (cls === 'highway') weight = FREEWAY_MOUNTAIN_WEIGHT;
    else weight = mountainWeight(graph.edgeMountain[edge], graph.edgeCorridor[edge] === 1);
    if (cls === 'local' && avoidLocal) weight = Math.max(weight, LOCAL_AVOID_WEIGHT);
    if (used && used[edge]) weight *= usedFactor;
    weights[edge] = weight;
  }
  return weights;
}

/** A run of one named canyon crossing, with its end points, for the route summary. */
interface Stretch {
  name: string;
  meters: number;
  start: LonLat;
  end: LonLat;
}

/** Mountain roads are named canyon crossings, or pieces scoring at least MOUNTAIN_ROAD_MIN. Freeways never count. */
function isMountainEdge(graph: RoutingGraph, edge: number): boolean {
  const cls = graph.classOf(edge);
  if (cls === 'highway') return false;
  return cls === 'crossing' || graph.edgeMountain[edge] >= MOUNTAIN_ROAD_MIN;
}

function compassOf(from: LonLat, to: LonLat): string {
  return COMPASS[Math.round(bearingDeg(from, to) / 45) % 8];
}

/** "via Topanga, then Mulholland Hwy west": the first canyon by name, then each later one with its direction. */
function summaryOf(stretches: Stretch[]): string {
  // The same canyon twice in a row (split by a short piece of something else) reads as one stretch.
  const merged: Stretch[] = [];
  for (const stretch of stretches) {
    const last = merged[merged.length - 1];
    if (last && last.name === stretch.name) {
      last.meters += stretch.meters;
      last.end = stretch.end;
    } else {
      merged.push({ ...stretch });
    }
  }
  const named = merged.filter((stretch) => stretch.meters >= SUMMARY_MIN_M).slice(0, SUMMARY_MAX_STRETCHES);
  return named
    .map((stretch, index) => (index === 0 ? `via ${stretch.name}` : `then ${stretch.name} ${compassOf(stretch.start, stretch.end)}`))
    .join(', ');
}

/** One planned route before alternatives are chosen. */
interface Solved {
  route: Route;
  /** Every road piece the route uses, for the overlap check. */
  edges: number[];
  /** Total distance in meters: the sum of the road pieces. */
  meters: number;
  /** Meters on valley roads beside the 101. */
  corridorMeters: number;
  /** True when the route's main road is a named canyon crossing. */
  canyonMain: boolean;
}

/**
 * Plans one route through the stops along the given path for each leg. Throws when a stop is not near a road.
 * `legRefs[i]` is the directed road pieces from nodes[i] to nodes[i + 1].
 */
function solve(graph: RoutingGraph, stops: Stop[], nodes: number[], legRefs: number[][], stopWarnings: string[], options: PlanOptions): Solved {
  const warnings = [...stopWarnings];
  const departAt = options.departAt ?? new Date().toISOString();
  const departMs = Date.parse(departAt);
  if (Number.isNaN(departMs)) throw new Error(`departAt is not a valid time: ${departAt}`);

  const built: BuiltLeg[] = [];
  const crossingMeters = new Map<string, number>();
  const roadMeters = new Map<string, number>();
  const stretches: Stretch[] = [];
  const edges: number[] = [];
  let highwayMeters = 0;
  let mountainMeters = 0;
  let corridorMeters = 0;
  let totalMeters = 0;

  for (let i = 1; i < stops.length; i++) {
    const refs = legRefs[i - 1];
    // A stretch continues across legs, and ends at the first piece that is not the same canyon.
    let current: Stretch | null = null;
    for (const ref of refs) {
      const edge = ref >> 1;
      const meters = graph.edgeMeters[edge];
      edges.push(edge);
      totalMeters += meters;
      if (graph.classOf(edge) === 'highway') highwayMeters += meters;
      if (isMountainEdge(graph, edge)) mountainMeters += meters;
      if (graph.edgeCorridor[edge] === 1) corridorMeters += meters;
      const crossing = graph.crossingOf(edge);
      if (crossing) crossingMeters.set(crossing, (crossingMeters.get(crossing) ?? 0) + meters);
      const name = graph.nameOf(edge);
      if (name) roadMeters.set(name, (roadMeters.get(name) ?? 0) + meters);
      if (crossing) {
        if (current && current.name === crossing) {
          current.meters += meters;
          current.end = graph.nodePoint(graph.endOf(ref));
        } else {
          current = { name: crossing, meters, start: graph.nodePoint(graph.startOf(ref)), end: graph.nodePoint(graph.endOf(ref)) };
          stretches.push(current);
        }
      } else {
        current = null;
      }
    }
    built.push(buildLeg(graph, { from: stops[i - 1], to: stops[i], fromNode: nodes[i - 1], refs }));
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
    edges,
    meters: totalMeters,
    corridorMeters,
    canyonMain: main.canyon,
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
      label: main.label,
      highwayShare: totalMeters > 0 ? highwayMeters / totalMeters : 0,
      mountainShare: totalMeters > 0 ? mountainMeters / totalMeters : 0,
      summary: summaryOf(stretches),
    },
  };
}

/** The road a route spends the most distance on: the canyon crossing if it has one, else the named road. */
function mainRoad(crossingMeters: Map<string, number>, roadMeters: Map<string, number>): { label: string; canyon: boolean } {
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
  if (crossing) return { label: crossing, canyon: true };
  const road = top(roadMeters);
  return { label: road ?? 'Local roads', canyon: false };
}

/**
 * Share of the shorter of two road sets that they have in common, by distance. Used to tell near-identical routes
 * apart from routes that take a different turn.
 */
function sharedFraction(graph: RoutingGraph, a: Solved, b: Solved): number {
  const inB = new Set(b.edges);
  let shared = 0;
  for (const edge of a.edges) if (inB.has(edge)) shared += graph.edgeMeters[edge];
  const shorter = Math.min(a.meters, b.meters);
  return shorter > 0 ? shared / shorter : 1;
}

/** Cheapest path for every leg under the given weights. Throws when a leg cannot be joined at all. */
function legPaths(graph: RoutingGraph, stops: Stop[], nodes: number[], weights: Float64Array): number[][] {
  return stops.slice(1).map((stop, i) => {
    const path = findPath(graph, nodes[i], nodes[i + 1], () => true, weights);
    if (!path) throw new Error(`No road route from ${stops[i].name} to ${stop.name}`);
    return path.refs;
  });
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
  const legs = legPaths(graph, stops, nodes, edgeWeights(graph, options, null, 1));
  return { ...solve(graph, stops, nodes, legs, warnings, options).route, alternative: 0 };
}

/** Marks every road piece a route uses, so the next alternative is priced away from them. */
function markUsed(used: Uint8Array, solved: Solved): void {
  for (const edge of solved.edges) used[edge] = 1;
}

/**
 * Up to `maxRoutes` (1 to 6, default 4) distinct canyon routes through the stops. The first is the cheapest route, which
 * planRoute returns. Each later one is found with the roads of the routes before it made more expensive, so it leaves
 * them at the first chance: a different canyon, or a different turn-off on the same canyon. A route is kept only when
 * it runs mostly on canyon roads, not on a freeway, has a canyon crossing as its main road, takes at most three times
 * the preferred route's time, and shares less than 70% of its road with a route already kept. With mountainRoads on, it
 * must also run at least half its distance on mountain roads and keep its valley-road distance beside the 101 short.
 * The result may hold fewer than maxRoutes.
 *
 * With mountainRoads on, the routes come back sorted by mountainShare (most mountain first), then by time. Otherwise
 * the preferred route stays first and the alternatives follow, quickest first. Every route carries its position in
 * `alternative`.
 */
export function planRoutes(stops: Stop[], options: PlanOptions = {}): Route[] {
  const graph = requireGraph();
  if (stops.length < 2) throw new Error('A route needs at least two stops.');
  const limit = Math.max(1, Math.min(MAX_ROUTES, options.maxRoutes ?? DEFAULT_ROUTES));
  const mountainMode = (options.avoidHighways ?? true) && (options.mountainRoads ?? false);
  const stopWarnings: string[] = [];
  const nodes = stops.map((stop) => nodeFor(graph, stop, stopWarnings));

  const first = solve(graph, stops, nodes, legPaths(graph, stops, nodes, edgeWeights(graph, options, null, 1)), stopWarnings, options);
  const found: Solved[] = [first];
  const used = new Uint8Array(graph.edgeCount);
  markUsed(used, first);

  while (found.length < limit) {
    let accepted: Solved | null = null;
    for (const factor of PENALTY_STEPS) {
      const candidate = solve(graph, stops, nodes, legPaths(graph, stops, nodes, edgeWeights(graph, options, used, factor)), stopWarnings, options);
      if (isAlternative(graph, candidate, found, mountainMode)) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted) break;
    found.push(accepted);
    markUsed(used, accepted);
  }

  const routes = found.map((item) => item.route);
  const ordered = mountainMode
    ? [...routes].sort((a, b) => (b.mountainShare ?? 0) - (a.mountainShare ?? 0) || a.durationS - b.durationS)
    : [routes[0], ...routes.slice(1).sort((a, b) => a.durationS - b.durationS)];
  return ordered.map((route, index) => ({ ...route, alternative: index }));
}

function isAlternative(graph: RoutingGraph, candidate: Solved, found: Solved[], mountainMode: boolean): boolean {
  if (!candidate.canyonMain) return false;
  if ((candidate.route.highwayShare ?? 0) > ALTERNATIVE_MAX_HIGHWAY_SHARE) return false;
  if (candidate.route.durationS > found[0].route.durationS * MAX_ALTERNATIVE_TIME_FACTOR) return false;
  if (mountainMode) {
    if ((candidate.route.mountainShare ?? 0) < MIN_MOUNTAIN_ALTERNATIVE) return false;
    if (candidate.corridorMeters > MAX_CORRIDOR_M) return false;
  }
  return found.every((other) => sharedFraction(graph, candidate, other) < MAX_SHARED_FRACTION);
}
