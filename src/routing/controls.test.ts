// Checks the stop sign and traffic signal data (scripts/routing-controls.json, from OpenStreetMap) and the built
// routing graph that uses it. Needs the built public/data/routing-graph.json (npm run routing:build). No network.
// Run from the repo root: npx -y tsx --test src/routing/controls.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metersBetween } from './geo';
import { RoutingGraph } from './graph';
import type { GraphFile } from './graphFile';
import { findPath } from './search';
import { planRoute, setRoutingGraph } from './planRoute';
import { controlDelayS } from './speed';
import type { ControlKind, Stop } from './types';

// The box scripts/build-roads.mjs clips to. The controls must sit inside it.
const BOX = { south: 33.98, west: -118.95, north: 34.2, east: -118.5 };
const KINDS: ControlKind[] = ['stop-sign', 'traffic-signal'];

interface ControlEntry {
  id: string;
  kind: ControlKind;
  label: string;
  lon: number;
  lat: number;
}
const controlsFile = JSON.parse(readFileSync('scripts/routing-controls.json', 'utf8')) as { source: string; controls: ControlEntry[] };
const graphFile = JSON.parse(readFileSync('public/data/routing-graph.json', 'utf8')) as GraphFile;

// Every control in the data file, as the graph build sees it.
test('control data cites OpenStreetMap under ODbL and lists only stop signs and traffic signals in the road box', () => {
  assert.match(controlsFile.source, /OpenStreetMap/);
  assert.match(controlsFile.source, /ODbL/);
  const ids = new Set<string>();
  for (const control of controlsFile.controls) {
    assert.match(control.id, /^node\/\d+$/);
    assert.ok(!ids.has(control.id), `duplicate ${control.id}`);
    ids.add(control.id);
    assert.ok(KINDS.includes(control.kind), `unknown kind ${control.kind} at ${control.id}`);
    assert.equal(typeof control.label, 'string');
    assert.ok(control.lon >= BOX.west && control.lon <= BOX.east, `${control.id} lon ${control.lon} outside the box`);
    assert.ok(control.lat >= BOX.south && control.lat <= BOX.north, `${control.id} lat ${control.lat} outside the box`);
  }
});

test('control data has plausible counts for both kinds, and most controls name their junction', () => {
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, controlsFile.controls.filter((c) => c.kind === kind).length]));
  assert.ok(counts['stop-sign'] >= 100, `only ${counts['stop-sign']} stop signs`);
  assert.ok(counts['traffic-signal'] >= 20, `only ${counts['traffic-signal']} traffic signals`);
  const named = controlsFile.controls.filter((c) => c.label.length > 0).length;
  assert.ok(named / controlsFile.controls.length >= 0.9, `only ${named} of ${controlsFile.controls.length} controls have a label`);
});

test('the built graph holds every control from the data file, each on the junction it was given', () => {
  const graph = RoutingGraph.fromFile(graphFile);
  assert.equal(graph.controls.size, controlsFile.controls.length);
  for (const control of controlsFile.controls) {
    const node = [...graph.controls.keys()].find((n) => graph.controls.get(n)?.label === control.label && graph.controls.get(n)?.kind === control.kind && metersBetween([control.lon, control.lat], graph.nodePoint(n)) <= 30);
    assert.ok(node !== undefined, `${control.id} is not on the graph within 30 m`);
  }
});

test('the Ventura Blvd and Topanga Canyon Blvd junction is a graph junction, so a route can turn between them', () => {
  const graph = RoutingGraph.fromFile(graphFile);
  // The signal nodes at the crossing, about 34.1685, -118.6058 (checked against OpenStreetMap by hand).
  const node = [...graph.controls.keys()].find((n) => graph.controls.get(n)?.kind === 'traffic-signal' && metersBetween([-118.6059, 34.1685], graph.nodePoint(n)) <= 40);
  assert.ok(node !== undefined, 'no signal on the graph at the Ventura Blvd and Topanga Canyon Blvd crossing');
  const named = new Set<string>();
  for (let i = graph.adjacencyOffset[node!]; i < graph.adjacencyOffset[node! + 1]; i++) named.add(graph.names[graph.edgeName[graph.adjacency[i] >> 1]]);
  assert.ok(named.has('Ventura Blvd') && named.has('Topanga Canyon Blvd'), `roads at the junction: ${[...named].join(', ')}`);
});

test('a route through a stop sign gets its step, and the search charges the stop delay at that node', () => {
  const graph = RoutingGraph.fromFile(graphFile);
  setRoutingGraph(graphFile);
  const stopNode = [...graph.controls.entries()].find(([node, control]) => control.kind === 'stop-sign' && graph.adjacencyOffset[node + 1] - graph.adjacencyOffset[node] >= 3);
  assert.ok(stopNode, 'no stop sign at a junction of three or more roads');
  const [node, control] = stopNode;

  // Find two neighbors whose fastest path runs through the stop sign node.
  const neighbors: number[] = [];
  for (let i = graph.adjacencyOffset[node]; i < graph.adjacencyOffset[node + 1]; i++) neighbors.push(graph.endOf(graph.adjacency[i]));
  let pair: { from: number; to: number; refs: number[] } | null = null;
  for (const from of neighbors) {
    for (const to of neighbors) {
      if (from === to) continue;
      const path = findPath(graph, from, to, () => true);
      if (path && path.refs.some((ref) => graph.endOf(ref) === node)) {
        pair = { from, to, refs: path.refs };
        break;
      }
    }
    if (pair) break;
  }
  assert.ok(pair, 'no neighbors whose shortest path runs through the stop sign');

  // The search cost is driving time plus the stop delay at every node the path enters.
  const path = findPath(graph, pair.from, pair.to, () => true)!;
  const driving = pair.refs.reduce((sum, ref) => sum + graph.edgeMeters[ref >> 1] / graph.edgeSpeedMs[ref >> 1], 0);
  const delays = pair.refs.reduce((sum, ref) => {
    const entered = graph.controls.get(graph.endOf(ref));
    return sum + (entered ? controlDelayS(entered.kind) : 0);
  }, 0);
  assert.ok(Math.abs(path.seconds - (driving + delays)) < 1e-6, `search ${path.seconds} vs driving ${driving} + delays ${delays}`);
  assert.ok(delays >= controlDelayS('stop-sign'));

  // The planned route carries a stop-sign step at that junction.
  const stop = (id: string, n: number): Stop => ({ id, name: id, kind: 'custom', lon: graph.lon[n], lat: graph.lat[n] });
  const route = planRoute([stop('from', pair.from), stop('to', pair.to)], { departAt: '2026-10-19T08:00:00.000Z' });
  const steps = route.legs[0].steps.filter((step) => step.kind === 'stop-sign');
  assert.equal(steps.length, 1);
  assert.equal(steps[0].lon, graph.lon[node]);
  assert.equal(steps[0].lat, graph.lat[node]);
  assert.match(steps[0].instruction, /^Stop at the stop sign/);
  assert.ok(control.label === '' || steps[0].instruction.includes(control.label));
});

test('a route through a traffic signal gets its step', () => {
  const graph = RoutingGraph.fromFile(graphFile);
  setRoutingGraph(graphFile);
  const signalNode = [...graph.controls.entries()].find(([node, control]) => control.kind === 'traffic-signal' && graph.adjacencyOffset[node + 1] - graph.adjacencyOffset[node] >= 3);
  assert.ok(signalNode, 'no traffic signal at a junction of three or more roads');
  const [node] = signalNode;
  const neighbors: number[] = [];
  for (let i = graph.adjacencyOffset[node]; i < graph.adjacencyOffset[node + 1]; i++) neighbors.push(graph.endOf(graph.adjacency[i]));
  let pair: { from: number; to: number } | null = null;
  for (const from of neighbors) {
    for (const to of neighbors) {
      if (from === to) continue;
      const path = findPath(graph, from, to, () => true);
      if (path && path.refs.some((ref) => graph.endOf(ref) === node)) {
        pair = { from, to };
        break;
      }
    }
    if (pair) break;
  }
  assert.ok(pair, 'no neighbors whose shortest path runs through the signal');
  const stop = (id: string, n: number): Stop => ({ id, name: id, kind: 'custom', lon: graph.lon[n], lat: graph.lat[n] });
  const route = planRoute([stop('from', pair.from), stop('to', pair.to)], { departAt: '2026-10-19T08:00:00.000Z' });
  assert.equal(route.legs[0].steps.filter((step) => step.kind === 'traffic-signal').length, 1);
});
