// Route planning and stop suggestions for the planner UI.
//
// MOCK ENGINE. This runs the shortest-path code in src/lib/roads/route.ts over public/data/roads.geojson, with
// rough speeds and a rough difficulty rule. It has the same signatures as the routing engine (planRoute,
// suggestStops, rateDifficulty), so the UI does not change when src/routing/ lands on main and this file starts
// re-exporting it. Nothing here reads stop signs, signals or turn restrictions, because the road file does not have them.
import { PLACES, type Place } from '../map/places';
import {
  buildRoadGraph,
  metersBetween,
  nearestNode,
  shortestPath,
  type LonLat,
  type RoadClass,
  type RoadEdge,
  type RoadFeature,
  type RoadGraph,
} from '../lib/roads/route';
import type { Difficulty, Leg, Network, Route, Stop, Step } from './types';

export interface PlanOptions {
  network: Network;
  /** Defaults to now. */
  departAt?: Date;
}

const ROAD_FILE = '/data/roads.geojson';
/** A stop farther than this from any road on the chosen network cannot be routed from. */
const SNAP_LIMIT_M = 3000;
const MPH_TO_MPS = 0.44704;
/** Mountain roads take longer than their posted speed, so the mock adds 10% for bends. */
const BEND_FACTOR = 1.1;
const SPEED_MPH: Record<RoadClass, number> = { highway: 55, arterial: 35, crossing: 28, collector: 25, local: 18 };
/** How much each class adds to a leg's difficulty. Narrow, winding local roads weigh the most. */
const CLASS_WEIGHT: Record<RoadClass, number> = { highway: 0, arterial: 0.5, crossing: 1.2, collector: 1.6, local: 2.4 };
/** Roads that make up a named intersection between two through roads. */
const MAJOR_CLASSES: readonly RoadClass[] = ['crossing', 'arterial', 'collector'];
const CITY_KINDS: readonly Place['kind'][] = ['city', 'town', 'neighborhood'];

export interface NetworkData {
  graph: RoadGraph;
  /** Places where two named roads meet. Each is a stop that can branch into several roads. */
  intersections: Stop[];
}

export function placeStop(place: Place): Stop {
  return {
    id: `place:${place.id}`,
    name: place.name,
    kind: CITY_KINDS.includes(place.kind) ? 'city' : 'poi',
    lon: place.lon,
    lat: place.lat,
  };
}

export const PLACE_STOPS: Stop[] = PLACES.map(placeStop);

/** Stop for a click on the map. The engine snaps it to the nearest road. */
export function customStop(lon: number, lat: number): Stop {
  return { id: `custom:${lon.toFixed(5)},${lat.toFixed(5)}`, name: 'Dropped pin', kind: 'custom', lon, lat };
}

function includeClass(network: Network): (cls: RoadClass) => boolean {
  // US 101 and PCH are never used. "All roads" means every other class.
  return network === 'canyons' ? (cls) => cls === 'crossing' : (cls) => cls !== 'highway';
}

/** Intersections where at least two major roads meet. Named "A & B", with the more important road first. */
export function findIntersections(graph: RoadGraph): Stop[] {
  const rank: Record<RoadClass, number> = { highway: 0, crossing: 1, arterial: 2, collector: 3, local: 4 };
  const stops: Stop[] = [];
  for (const [key, edges] of graph.adjacency) {
    const roads = new Map<string, RoadEdge>();
    for (const edge of edges) {
      if (!edge.name) continue;
      const group = edge.crossing ?? edge.name;
      if (!roads.has(group)) roads.set(group, edge);
    }
    const major = [...roads.values()].filter((edge) => MAJOR_CLASSES.includes(edge.cls));
    if (major.length < 2) continue;
    major.sort((a, b) => rank[a.cls] - rank[b.cls] || a.name.localeCompare(b.name));
    const [first, second] = major;
    if (first.name === second.name) continue;
    const point = graph.nodes.get(key);
    if (!point) continue;
    stops.push({
      id: `x:${key}`,
      name: `${first.name} & ${second.name}`,
      kind: 'intersection',
      lon: point[0],
      lat: point[1],
    });
  }
  return stops;
}

export function buildNetwork(features: RoadFeature[], network: Network): NetworkData {
  const graph = buildRoadGraph(features, includeClass(network));
  return { graph, intersections: findIntersections(graph) };
}

let roadFeatures: Promise<RoadFeature[]> | null = null;

function loadRoadFeatures(): Promise<RoadFeature[]> {
  roadFeatures ??= fetch(ROAD_FILE)
    .then((response) => {
      if (!response.ok) throw new Error(`Road data: HTTP ${response.status}`);
      return response.json() as Promise<{ features: RoadFeature[] }>;
    })
    .then((data) => data.features)
    .catch((error: unknown) => {
      roadFeatures = null;
      throw error;
    });
  return roadFeatures;
}

const networks = new Map<Network, Promise<NetworkData>>();

/** Builds a network once and keeps it. A failed build is retried on the next call. */
export function loadNetwork(network: Network): Promise<NetworkData> {
  let pending = networks.get(network);
  if (!pending) {
    pending = loadRoadFeatures().then((features) => buildNetwork(features, network));
    pending.catch(() => networks.delete(network));
    networks.set(network, pending);
  }
  return pending;
}

/** Ranks stops by name. Every word of the query must appear; names that start with it come first. */
export function rankStops(query: string, stops: readonly Stop[], limit = 8): Stop[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const kindRank: Record<Stop['kind'], number> = { city: 0, poi: 1, intersection: 2, custom: 3 };
  if (tokens.length === 0) {
    return stops.filter((stop) => stop.kind === 'city').slice(0, limit);
  }
  const scored: { stop: Stop; score: number }[] = [];
  for (const stop of stops) {
    const name = stop.name.toLowerCase();
    if (!tokens.every((token) => name.includes(token))) continue;
    const score = name.startsWith(tokens[0]) ? 0 : name.split(/[\s&-]+/).some((word) => word.startsWith(tokens[0])) ? 1 : 2;
    scored.push({ stop, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score || kindRank[a.stop.kind] - kindRank[b.stop.kind] || a.stop.name.localeCompare(b.stop.name),
  );
  return scored.slice(0, limit).map((entry) => entry.stop);
}

/** Stop suggestions for the search box: city centers, POIs, and road intersections on the chosen network. */
export async function suggestStops(query: string, options: { network: Network }, limit = 8): Promise<Stop[]> {
  const data = await loadNetwork(options.network);
  return rankStops(query, [...PLACE_STOPS, ...data.intersections], limit);
}

/**
 * Difficulty of a leg from its roads and how winding it is. `sinuosity` is road length divided by straight-line
 * distance. Mock rule: the road-class mix, plus extra weight for bends.
 */
export function rateDifficulty(parts: readonly { cls: RoadClass; meters: number }[], sinuosity: number): Difficulty {
  let total = 0;
  let weighted = 0;
  for (const part of parts) {
    total += part.meters;
    weighted += part.meters * CLASS_WEIGHT[part.cls];
  }
  const mix = total > 0 ? weighted / total : 0;
  const score = mix + 1.5 * Math.max(0, sinuosity - 1.2);
  if (score < 0.6) return 'easy';
  if (score < 1.1) return 'intermediate';
  if (score < 1.5) return 'medium';
  if (score < 1.9) return 'hard';
  return 'difficult';
}

/** Compass bearing in degrees, clockwise from north. */
function bearingDeg(a: LonLat, b: LonLat): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(midLat);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Turn from the segment a→b onto b→c. Positive angles turn right. */
function maneuver(a: LonLat, b: LonLat, c: LonLat): { kind: string; text: string } {
  const delta = ((bearingDeg(b, c) - bearingDeg(a, b) + 540) % 360) - 180;
  const abs = Math.abs(delta);
  const right = delta > 0;
  if (abs < 25) return { kind: 'continue', text: 'Continue' };
  if (abs > 160) return { kind: 'u-turn', text: 'Make a U-turn' };
  if (abs < 60) return right ? { kind: 'bear-right', text: 'Bear right' } : { kind: 'bear-left', text: 'Bear left' };
  return right ? { kind: 'turn-right', text: 'Turn right' } : { kind: 'turn-left', text: 'Turn left' };
}

/** Steps along a leg. Each one is a run of consecutive edges on the same road, starting at a junction. */
function buildSteps(graph: RoadGraph, path: string[], edges: RoadEdge[], to: Stop): Step[] {
  interface Run {
    name: string;
    startIndex: number;
    meters: number;
    seconds: number;
  }
  const runs: Run[] = [];
  edges.forEach((edge, index) => {
    const seconds = (edge.meters / (SPEED_MPH[edge.cls] * MPH_TO_MPS)) * BEND_FACTOR;
    const last = runs[runs.length - 1];
    if (last && last.name === edge.name) {
      last.meters += edge.meters;
      last.seconds += seconds;
    } else {
      runs.push({ name: edge.name, startIndex: index, meters: edge.meters, seconds });
    }
  });

  const point = (key: string): LonLat => graph.nodes.get(key) ?? [0, 0];
  const steps: Step[] = runs.map((run, k) => {
    const [lon, lat] = point(path[run.startIndex]);
    const roadName = run.name || 'unnamed road';
    const base = { roadName, lon, lat, distanceM: run.meters, durationS: run.seconds };
    if (k === 0) return { kind: 'depart', ...base, instruction: `Head on ${roadName}` };
    const turn = maneuver(
      point(path[run.startIndex - 1]),
      point(path[run.startIndex]),
      point(path[run.startIndex + 1]),
    );
    const onto = turn.kind === 'continue' ? 'Continue onto' : `${turn.text} onto`;
    return { kind: turn.kind, ...base, instruction: `${onto} ${roadName}` };
  });

  const [endLon, endLat] = point(path[path.length - 1]);
  steps.push({
    kind: 'arrive',
    roadName: '',
    lon: endLon,
    lat: endLat,
    distanceM: 0,
    durationS: 0,
    instruction: `Arrive at ${to.name}`,
  });
  return steps;
}

function buildLeg(graph: RoadGraph, from: Stop, to: Stop, found: { path: string[]; edges: RoadEdge[]; meters: number }): Leg {
  const geometry = found.path.map((key): LonLat => graph.nodes.get(key) ?? [0, 0]);
  const durationS = found.edges.reduce(
    (sum, edge) => sum + (edge.meters / (SPEED_MPH[edge.cls] * MPH_TO_MPS)) * BEND_FACTOR,
    0,
  );
  const straight = geometry.length > 1 ? metersBetween(geometry[0], geometry[geometry.length - 1]) : 0;
  const sinuosity = straight > 1 ? found.meters / straight : 1;
  return {
    from,
    to,
    distanceM: found.meters,
    durationS,
    difficulty: rateDifficulty(found.edges, sinuosity),
    geometry,
    steps: buildSteps(graph, found.path, found.edges, to),
  };
}

const DIFFICULTY_RANK: Record<Difficulty, number> = { easy: 0, intermediate: 1, medium: 2, hard: 3, difficult: 4 };

/**
 * Plans a route through the stops in order, on a graph already built. Pure, so it runs under node in tests.
 * The route is rated by its hardest leg.
 */
export function routeOnGraph(graph: RoadGraph, stops: readonly Stop[], departAt: Date): Route {
  if (stops.length < 2) throw new Error('Add a second stop to plan a route.');
  const nodes = stops.map((stop) => {
    const near = nearestNode(graph, stop.lon, stop.lat);
    if (!near || near.meters > SNAP_LIMIT_M) {
      throw new Error(`No road on this network within 3 km of ${stop.name}.`);
    }
    return near.key;
  });

  const legs: Leg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const found = shortestPath(graph, nodes[i - 1], nodes[i]);
    if (!found) throw new Error(`No road path from ${stops[i - 1].name} to ${stops[i].name} on this network.`);
    legs.push(buildLeg(graph, stops[i - 1], stops[i], found));
  }

  const geometry: LonLat[] = [];
  for (const leg of legs) {
    leg.geometry.forEach((point, index) => {
      if (index === 0 && geometry.length > 0) return;
      geometry.push(point);
    });
  }
  const durationS = legs.reduce((sum, leg) => sum + leg.durationS, 0);
  const difficulty = legs.reduce<Difficulty>(
    (hardest, leg) => (DIFFICULTY_RANK[leg.difficulty] > DIFFICULTY_RANK[hardest] ? leg.difficulty : hardest),
    'easy',
  );
  return {
    stops: [...stops],
    legs,
    distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
    durationS,
    difficulty,
    geometry,
    departAt: departAt.toISOString(),
    arriveAt: new Date(departAt.getTime() + durationS * 1000).toISOString(),
  };
}

/** Plans a route on the chosen network. Same signature as the routing engine's planRoute. */
export async function planRoute(stops: readonly Stop[], options: PlanOptions): Promise<Route> {
  const data = await loadNetwork(options.network);
  return routeOnGraph(data.graph, stops, options.departAt ?? new Date());
}
