import type { GraphFile } from './graphFile';
import { RoutingGraph } from './graph';
import { buildLeg, type BuiltLeg } from './legs';
import { rollUpDifficulty } from './difficulty';
import { findPath } from './search';
import { FREEWAY_MOUNTAIN_WEIGHT, MOUNTAIN_ROAD_MIN, mountainWeight } from './mountain';
import { bearingDeg, metersBetween } from './geo';
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
/**
 * Diverging alternatives: each named road run of at least this many meters on a route already found is banned in turn,
 * so the search must leave that road earlier or later. Runs shorter than this are too small to change a route's canyons.
 */
const BAN_MIN_M = 500;
/** The most banned searches one planRoutes call makes. Each one is a full search for every leg, so this bounds the time. */
const MAX_BAN_SEARCHES = 10;
/**
 * Detour alternatives: a leg is re-routed through a junction off the route. Junctions are kept only inside an ellipse
 * around the leg (the detour may be VIA_DETOUR_FACTOR times the straight line, plus VIA_DETOUR_M), and the best one on
 * each side of the line is tried in VIA_BINS stretches along it, so the alternatives leave the route at different points.
 */
const VIA_DETOUR_FACTOR = 1.3;
const VIA_DETOUR_M = 3000;
const VIA_BINS = 4;
/** The most detour searches one planRoutes call makes. */
const MAX_VIA_SEARCHES = 12;
/** A junction counts for detours when at least this many road pieces meet there. */
const VIA_MIN_ROADS = 3;
/**
 * Two routes that share more than this share of the shorter one are near-identical, and only one is kept. A route that
 * turns off a shared road at a different junction still shares most of its distance, so this allows about a fifth to differ.
 */
const MAX_SHARED_FRACTION = 0.8;
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

/** A run of consecutive road pieces with the same name along a route. Banning one forces a turn off it. */
interface Run {
  name: string;
  meters: number;
  edges: number[];
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
  /** The named road runs in route order, for the diverging alternatives. */
  runs: Run[];
  /** The road pieces of each leg, in order. */
  legRefs: number[][];
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
  const runs: Run[] = [];
  let run: Run | null = null;
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
      if (name && run && run.name === name) {
        run.edges.push(edge);
        run.meters += meters;
      } else if (name) {
        run = { name, meters, edges: [edge] };
        runs.push(run);
      } else {
        run = null;
      }
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
    runs,
    legRefs,
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

/** Meters per degree of longitude and latitude near the mountains. Used to measure distances between routes. */
const KX = 111320 * Math.cos((34.1 * Math.PI) / 180);
const KY = 110540;
/** Two lines within this distance of each other count as the same road. Parallel or doubled lines fall inside it. */
const NEAR_M = 40;
/** Points are spaced at most this far apart along a line when it is measured. */
const DENSE_STEP_M = 20;

/** Points along a route, about DENSE_STEP_M apart, in meters. */
function densePoints(line: LonLat[]): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    const x1 = line[i][0] * KX;
    const y1 = line[i][1] * KY;
    if (i === 0) {
      points.push([x1, y1]);
      continue;
    }
    const x0 = line[i - 1][0] * KX;
    const y0 = line[i - 1][1] * KY;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / DENSE_STEP_M));
    for (let step = 1; step <= steps; step++) points.push([x0 + ((x1 - x0) * step) / steps, y0 + ((y1 - y0) * step) / steps]);
  }
  return points;
}

/** Share of the length of `from` that runs within NEAR_M of `to`. */
function nearShare(from: LonLat[], to: LonLat[]): number {
  const cell = (x: number, y: number): string => `${Math.floor(x / NEAR_M)},${Math.floor(y / NEAR_M)}`;
  const grid = new Map<string, [number, number][]>();
  for (const point of densePoints(to)) {
    const key = cell(point[0], point[1]);
    const list = grid.get(key);
    if (list) list.push(point);
    else grid.set(key, [point]);
  }
  const points = densePoints(from);
  let near = 0;
  for (const [x, y] of points) {
    const cx = Math.floor(x / NEAR_M);
    const cy = Math.floor(y / NEAR_M);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const [tx, ty] of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(tx - x, ty - y) <= NEAR_M) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) near++;
  }
  return points.length > 0 ? near / points.length : 1;
}

/**
 * Share of the shorter of two routes that runs along the other one, measured on the drawn lines: within NEAR_M, so
 * parallel or doubled roads count as shared. Used to tell near-identical routes apart from routes that take a different
 * turn, which share their first and last stretches but not the middle.
 */
function sharedFraction(a: Solved, b: Solved): number {
  const [shorter, longer] = a.meters <= b.meters ? [a, b] : [b, a];
  return nearShare(shorter.route.geometry, longer.route.geometry);
}

/**
 * Cheapest path for every leg under the given weights, skipping the road pieces marked in `banned` (when given).
 * Throws when a leg cannot be joined.
 */
function legPaths(graph: RoutingGraph, stops: Stop[], nodes: number[], weights: Float64Array, banned: Uint8Array | null = null): number[][] {
  const allow = banned ? (edge: number) => banned[edge] === 0 : () => true;
  return stops.slice(1).map((stop, i) => {
    // Route choice ignores stop and signal delays; the leg's time adds them in solve().
    const path = findPath(graph, nodes[i], nodes[i + 1], allow, weights, false);
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

/** solve() with some road pieces banned, or null when the banned pieces leave a stop unreachable. */
function solveBanned(
  graph: RoutingGraph,
  stops: Stop[],
  nodes: number[],
  stopWarnings: string[],
  options: PlanOptions,
  weights: Float64Array,
  banned: Uint8Array,
): Solved | null {
  try {
    return solve(graph, stops, nodes, legPaths(graph, stops, nodes, weights, banned), stopWarnings, options);
  } catch {
    return null;
  }
}

/**
 * Up to `maxRoutes` (1 to 6, default 4) distinct canyon routes through the stops. The first is the cheapest route, which
 * planRoute returns. The alternatives diverge from it at different points along the way, in three steps:
 *   1. Ban a named road run of a route already found (at least BAN_MIN_M long), so the search must turn off that road
 *      earlier or later, or ban the whole road by name.
 *   2. Detour a leg of the best route through a junction off it, on either side of the line, at several points along.
 *   3. Price the roads the routes so far use higher, as a fallback.
 * A route is kept only when it runs mostly on canyon roads, not on a freeway, has a canyon crossing as its main road,
 * takes at most three times the preferred route's time, and runs along a route already kept for less than 80% of its
 * length (lines within 40 m count as the same road). With mountainRoads on, it must also run at least half its distance
 * on mountain roads and keep its valley-road distance beside the 101 short. The result may hold fewer than maxRoutes.
 *
 * The preferred route is always first. The alternatives follow: sorted by mountainShare (most mountain first) then by
 * time with mountainRoads on, otherwise quickest first. Every route carries its position in `alternative`.
 */
export function planRoutes(stops: Stop[], options: PlanOptions = {}): Route[] {
  const graph = requireGraph();
  if (stops.length < 2) throw new Error('A route needs at least two stops.');
  const limit = Math.max(1, Math.min(MAX_ROUTES, options.maxRoutes ?? DEFAULT_ROUTES));
  const mountainMode = (options.avoidHighways ?? true) && (options.mountainRoads ?? false);
  const stopWarnings: string[] = [];
  const nodes = stops.map((stop) => nodeFor(graph, stop, stopWarnings));

  const plain = edgeWeights(graph, options, null, 1);
  const first = solve(graph, stops, nodes, legPaths(graph, stops, nodes, plain), stopWarnings, options);
  const found: Solved[] = [first];

  // First, diverge mid-route: ban one named road run of a route already found, so the search must turn off that road
  // earlier or later and take a different canyon or turn. Runs found along accepted alternatives are tried too.
  const tried = new Set<string>();
  let searches = 0;
  const tryBan = (banned: Uint8Array): void => {
    const candidate = solveBanned(graph, stops, nodes, stopWarnings, options, plain, banned);
    if (candidate && isAlternative(candidate, found, mountainMode)) found.push(candidate);
  };
  for (let r = 0; r < found.length && found.length < limit && searches < MAX_BAN_SEARCHES; r++) {
    for (const run of found[r].runs) {
      if (found.length >= limit || searches >= MAX_BAN_SEARCHES) break;
      if (run.meters < BAN_MIN_M) continue;
      // Ban the stretch of the road this route uses, then the whole road by name, so the search must take another road.
      const variants = [run.edges, namedEdges(graph, run.name)];
      for (const edges of variants) {
        if (found.length >= limit || searches >= MAX_BAN_SEARCHES) break;
        const key = [...edges].sort((a, b) => a - b).join(',');
        if (tried.has(key)) continue;
        tried.add(key);
        searches++;
        const banned = new Uint8Array(graph.edgeCount);
        for (const edge of edges) banned[edge] = 1;
        tryBan(banned);
      }
    }
  }

  // Then detour: re-route a leg through a junction off the best route, so the alternative leaves that route at one point
  // and rejoins it at another. Only the best route's legs are tried.
  let vias = 0;
  for (let leg = 0; leg < stops.length - 1; leg++) {
    const avoid = nodesOf(graph, first.legRefs[leg]);
    for (const via of viaNodes(graph, nodes[leg], nodes[leg + 1], avoid)) {
      if (found.length >= limit || vias >= MAX_VIA_SEARCHES) break;
      vias++;
      const refs = viaRefs(graph, nodes[leg], via, nodes[leg + 1], plain);
      if (!refs) continue;
      const candidate = solve(graph, stops, nodes, first.legRefs.map((item, k) => (k === leg ? refs : item)), stopWarnings, options);
      if (isAlternative(candidate, found, mountainMode)) found.push(candidate);
    }
  }

  // Then, if there is still room, price the roads the routes so far use higher, so the next search leaves them.
  const used = new Uint8Array(graph.edgeCount);
  for (const item of found) markUsed(used, item);
  while (found.length < limit) {
    let accepted: Solved | null = null;
    for (const factor of PENALTY_STEPS) {
      const candidate = solve(graph, stops, nodes, legPaths(graph, stops, nodes, edgeWeights(graph, options, used, factor)), stopWarnings, options);
      if (isAlternative(candidate, found, mountainMode)) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted) break;
    found.push(accepted);
    markUsed(used, accepted);
  }

  // The preferred route stays first, so the fastest canyon route is still the one planRoute returns. The alternatives
  // follow: most mountain first with mountain mode on, otherwise quickest first.
  const routes = found.map((item) => item.route);
  const rest = routes
    .slice(1)
    .sort((a, b) => (mountainMode ? (b.mountainShare ?? 0) - (a.mountainShare ?? 0) : 0) || a.durationS - b.durationS);
  return [routes[0], ...rest].map((route, index) => ({ ...route, alternative: index }));
}

/**
 * Junctions a leg can detour through, off the given route nodes: the best one on each side of the straight line in
 * each of VIA_BINS stretches along it, inside the detour ellipse. Points are compared in a flat frame, which is close
 * enough at this scale.
 */
function viaNodes(graph: RoutingGraph, from: number, to: number, avoid: Set<number>): number[] {
  const sx = graph.lon[from];
  const sy = graph.lat[from];
  const ex = graph.lon[to];
  const ey = graph.lat[to];
  const budget = metersBetween([sx, sy], [ex, ey]) * VIA_DETOUR_FACTOR + VIA_DETOUR_M;
  const kx = Math.cos((((sy + ey) / 2) * Math.PI) / 180);
  const dx = (ex - sx) * kx;
  const dy = ey - sy;
  const lengthSq = dx * dx + dy * dy || 1;
  const best: ({ node: number; detour: number } | null)[] = new Array(VIA_BINS * 2).fill(null);
  for (let node = 0; node < graph.nodeCount; node++) {
    if (avoid.has(node)) continue;
    const degree = graph.adjacencyOffset[node + 1] - graph.adjacencyOffset[node];
    if (degree < VIA_MIN_ROADS) continue;
    const vx = graph.lon[node];
    const vy = graph.lat[node];
    const detour = metersBetween([sx, sy], [vx, vy]) + metersBetween([vx, vy], [ex, ey]);
    if (detour > budget) continue;
    const px = (vx - sx) * kx;
    const py = vy - sy;
    const along = (px * dx + py * dy) / lengthSq;
    if (along <= 0.1 || along >= 0.9) continue;
    const bin = Math.floor(((along - 0.1) / 0.8) * VIA_BINS);
    const side = dx * py - dy * px > 0 ? 1 : 0;
    const slot = best[bin * 2 + side];
    if (!slot || detour < slot.detour) best[bin * 2 + side] = { node, detour };
  }
  return best.flatMap((slot) => (slot ? [slot.node] : []));
}

/** The road pieces from one node to another through a junction, or null when they do not join without reusing a piece. */
function viaRefs(graph: RoutingGraph, from: number, via: number, to: number, weights: Float64Array): number[] | null {
  const first = findPath(graph, from, via, () => true, weights, false);
  const second = first && findPath(graph, via, to, () => true, weights, false);
  if (!second) return null;
  const refs = [...first!.refs, ...second.refs];
  const seen = new Set<number>();
  for (const ref of refs) {
    if (seen.has(ref >> 1)) return null;
    seen.add(ref >> 1);
  }
  return refs;
}

/** Every node a route passes through. */
function nodesOf(graph: RoutingGraph, refs: number[]): Set<number> {
  const set = new Set<number>();
  for (const ref of refs) {
    set.add(graph.startOf(ref));
    set.add(graph.endOf(ref));
  }
  return set;
}

/** Every road piece with this name, in the whole graph. */
function namedEdges(graph: RoutingGraph, name: string): number[] {
  const edges: number[] = [];
  for (let edge = 0; edge < graph.edgeCount; edge++) if (graph.nameOf(edge) === name) edges.push(edge);
  return edges;
}

function isAlternative(candidate: Solved, found: Solved[], mountainMode: boolean): boolean {
  if (!candidate.canyonMain) return false;
  if ((candidate.route.highwayShare ?? 0) > ALTERNATIVE_MAX_HIGHWAY_SHARE) return false;
  if (candidate.route.durationS > found[0].route.durationS * MAX_ALTERNATIVE_TIME_FACTOR) return false;
  if (mountainMode) {
    if ((candidate.route.mountainShare ?? 0) < MIN_MOUNTAIN_ALTERNATIVE) return false;
    if (candidate.corridorMeters > MAX_CORRIDOR_M) return false;
  }
  return found.every((other) => sharedFraction(candidate, other) < MAX_SHARED_FRACTION);
}
