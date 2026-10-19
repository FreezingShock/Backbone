// Tests for the graph build, the search, the turn-by-turn steps, and suggestions. Synthetic networks check exact
// behavior; the last block checks the built public/data/routing-graph.json. No network, no Cesium.
// Run from the repo root: npx -y tsx --test src/routing/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraphFile, type SourceRoad } from './buildGraph';
import { RoutingGraph } from './graph';
import type { GraphFile } from './graphFile';
import { findPath } from './search';
import { planRoute, setRoutingGraph } from './planRoute';
import { suggestStops } from './suggest';
import { controlDelayS } from './speed';
import type { ControlInput } from './buildGraph';
import type { RoadClass, Stop } from './types';

const road = (name: string, cls: RoadClass, highway: string, coordinates: [number, number][]): SourceRoad => ({
  properties: { name, class: cls, highway, crossing: cls === 'crossing' ? name : '' },
  geometry: { coordinates },
});

const stop = (id: string, name: string, lon: number, lat: number, kind: Stop['kind'] = 'custom'): Stop => ({ id, name, kind, lon, lat });

function load(roads: SourceRoad[], controls: ControlInput[] = []): RoutingGraph {
  const { file } = buildGraphFile({ roads, controls, places: [], source: 'synthetic' });
  return setRoutingGraph(file as GraphFile);
}

// A corner: Main St runs north 2.2 km, then Ridge Rd runs east 1.7 km. A right turn at the corner.
const CORNER: SourceRoad[] = [
  road('Main St', 'arterial', 'secondary', [[-118.6, 34.1], [-118.6, 34.12]]),
  road('Ridge Rd', 'crossing', 'tertiary', [[-118.6, 34.12], [-118.58, 34.12]]),
];
const START = stop('a', 'Start', -118.6, 34.1, 'city');
const END = stop('e', 'End', -118.58, 34.12, 'city');

test('builds nodes at road endpoints, one edge per piece, and drops footways', () => {
  const graph = load([...CORNER, road('Trail', 'local', 'footway', [[-118.6, 34.1], [-118.61, 34.1]])]);
  assert.equal(graph.nodeCount, 3);
  assert.equal(graph.edgeCount, 2);
});

test('splits a road where another road starts mid-line', () => {
  const graph = load([
    road('Long Rd', 'collector', 'residential', [[-118.6, 34.1], [-118.6, 34.12], [-118.6, 34.14]]),
    road('Cross St', 'collector', 'residential', [[-118.61, 34.12], [-118.6, 34.12]]),
  ]);
  // Long Rd is cut at its middle vertex (where Cross St meets it), so it becomes two edges.
  assert.equal(graph.edgeCount, 3);
});

test('a canyon crossing is named in the intersections list when it meets another named road', () => {
  const graph = load(CORNER);
  assert.deepEqual(graph.intersections.map((item) => item.label), ['Ridge Rd & Main St']);
});

test('route geometry starts at the first stop and ends at the last; steps include a right turn and arrival', () => {
  load(CORNER);
  const route = planRoute([START, END], { departAt: '2026-10-19T08:00:00.000Z' });
  const leg = route.legs[0];
  assert.deepEqual(leg.geometry[0], [START.lon, START.lat]);
  assert.deepEqual(leg.geometry[leg.geometry.length - 1], [END.lon, END.lat]);
  assert.deepEqual(leg.steps.map((step) => step.kind), ['depart', 'turn-right', 'arrive']);
  assert.equal(leg.steps[0].instruction, 'Start on Main St');
  assert.equal(leg.steps[1].instruction, 'Turn right onto Ridge Rd');
  assert.equal(leg.steps[2].instruction, 'Arrive at End');
  // Distances along the steps add up to the leg distance.
  const along = leg.steps.slice(0, -1).reduce((sum, step) => sum + step.distanceM, 0);
  assert.ok(Math.abs(along - leg.distanceM) <= 2);
  assert.equal(route.departAt, '2026-10-19T08:00:00.000Z');
  const arrive = Date.parse(route.arriveAt) - Date.parse(route.departAt);
  assert.equal(arrive, route.durationS * 1000);
});

test('a stop-sign control adds a step at its junction and a delay', () => {
  load(CORNER);
  const base = planRoute([START, END]).durationS;
  load(CORNER, [{ lon: -118.6, lat: 34.12, kind: 'stop-sign', label: 'Main and Ridge' }]);
  const route = planRoute([START, END]);
  assert.deepEqual(route.legs[0].steps.map((step) => step.kind), ['depart', 'stop-sign', 'turn-right', 'arrive']);
  assert.equal(route.legs[0].steps[1].instruction, 'Stop at the stop sign at Main and Ridge');
  assert.equal(route.durationS, base + 6);
  assert.ok(!route.warnings.some((warning) => warning.includes('not in the road data')));
});

test('canyon routes avoid highways, and fall back to them with a warning when nothing else connects', () => {
  // A collector loop north, and a freeway loop south of the same two stops.
  const roads: SourceRoad[] = [
    road('Canyon Rd', 'collector', 'residential', [[-118.6, 34.1], [-118.55, 34.12], [-118.5, 34.1]]),
    road('US 101', 'highway', 'motorway_link', [[-118.6, 34.1], [-118.55, 34.05], [-118.5, 34.1]]),
  ];
  load(roads);
  const a = stop('a', 'West', -118.6, 34.1);
  const b = stop('b', 'East', -118.5, 34.1);
  const canyon = planRoute([a, b]);
  assert.ok(canyon.legs[0].steps.every((step) => step.roadName !== 'US 101'));
  assert.ok(!canyon.warnings.some((warning) => warning.includes('highway')));

  const free = planRoute([a, b], { avoidHighways: false });
  assert.ok(free.durationS <= canyon.durationS);

  // With the canyon road removed, only the freeway connects the stops.
  load([roads[1]]);
  const onlyFreeway = planRoute([a, b]);
  assert.ok(onlyFreeway.warnings.some((warning) => warning.includes('highway')));
});

test('a route with unreachable stops throws a clear error', () => {
  load(CORNER);
  const island = stop('x', 'Island', -117.0, 33.0);
  assert.throws(() => planRoute([START, island]), /No mapped road near Island/);
});

test('multi-stop routes chain legs in order and sum their distance and time', () => {
  load(CORNER);
  const mid = stop('m', 'Mid', -118.6, 34.12);
  const route = planRoute([START, mid, END]);
  assert.equal(route.legs.length, 2);
  assert.equal(route.legs[0].to.id, 'm');
  assert.equal(route.legs[1].from.id, 'm');
  assert.equal(route.distanceM, route.legs[0].distanceM + route.legs[1].distanceM);
  assert.equal(route.durationS, route.legs[0].durationS + route.legs[1].durationS);
  assert.ok(route.difficulty);
});

test('suggestions match every word, rank starts first, and list intersections', () => {
  load(CORNER);
  const hits = suggestStops('ridge');
  assert.equal(hits[0].kind, 'intersection');
  assert.equal(hits[0].name, 'Ridge Rd & Main St');
  assert.deepEqual(suggestStops('zzz'), []);
  assert.deepEqual(suggestStops('main ridge').map((item) => item.name), ['Ridge Rd & Main St']);
});

test('A* returns the same time as a plain Dijkstra on the built Santa Monica Mountains graph', () => {
  const graph = RoutingGraph.fromFile(JSON.parse(readFileSync('public/data/routing-graph.json', 'utf8')) as GraphFile);
  const dijkstra = (from: number, to: number): number => {
    const cost = new Float64Array(graph.nodeCount).fill(Infinity);
    cost[from] = 0;
    // Simple binary heap of [cost, node].
    const heap: [number, number][] = [[0, from]];
    const push = (item: [number, number]) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0 && heap[(i - 1) >> 1][0] > heap[i][0]) {
        [heap[(i - 1) >> 1], heap[i]] = [heap[i], heap[(i - 1) >> 1]];
        i = (i - 1) >> 1;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [c, node] = pop();
      if (node === to) return c;
      if (c > cost[node]) continue;
      for (let i = graph.adjacencyOffset[node]; i < graph.adjacencyOffset[node + 1]; i++) {
        const ref = graph.adjacency[i];
        const edge = ref >> 1;
        const next = graph.endOf(ref);
        // Entering a stop sign or signal costs its delay, as in the search.
        const control = graph.controls.get(next);
        const candidate = c + graph.edgeMeters[edge] / graph.edgeSpeedMs[edge] + (control ? controlDelayS(control.kind) : 0);
        if (candidate < cost[next]) {
          cost[next] = candidate;
          push([candidate, next]);
        }
      }
    }
    return Infinity;
  };

  // Deterministic pairs of junctions spread across the graph.
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 12; i++) {
    const a = Math.floor(next() * graph.nodeCount);
    const b = Math.floor(next() * graph.nodeCount);
    const expected = dijkstra(a, b);
    const found = findPath(graph, a, b, () => true);
    if (!Number.isFinite(expected)) {
      assert.equal(found, null);
    } else {
      assert.ok(found, `no path ${a} to ${b}`);
      assert.ok(Math.abs(found.seconds - expected) < 1e-6, `A* ${found.seconds} vs Dijkstra ${expected}`);
    }
  }
});

test('the built graph plans the demo towns and names Calabasas High School, with stop sign and signal data present', () => {
  const file = JSON.parse(readFileSync('public/data/routing-graph.json', 'utf8')) as GraphFile;
  setRoutingGraph(file);
  const first = (query: string) => suggestStops(query, undefined, 1)[0];
  const school = first('calabasas high');
  assert.equal(school.name, 'Calabasas High School');
  assert.ok(Math.abs(school.lat - 34.13806) < 1e-5 && Math.abs(school.lon + 118.6275) < 1e-5);

  for (const [a, b] of [['Woodland Hills', 'Calabasas'], ['Newbury Park', 'Thousand Oaks'], ['Westlake Village', 'Calabasas']]) {
    const route = planRoute([first(a), first(b)], { departAt: '2026-10-19T08:00:00.000Z' });
    assert.ok(route.distanceM > 1000, `${a} to ${b} is too short`);
    assert.ok(route.durationS > 60 && route.durationS < 3 * 3600, `${a} to ${b} time ${route.durationS}`);
    assert.ok(['easy', 'intermediate', 'medium', 'hard', 'difficult'].includes(route.difficulty));
    assert.ok(!route.warnings.some((warning) => warning.includes('Stop signs and traffic signals')));
  }
});
