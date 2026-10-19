// Canyon-preferred routing: road-end joins, freeway pricing, labeled alternatives, per-road segments, and the
// Newbury Park to Woodland Hills case on the built graph. Synthetic networks check exact behavior; the last block
// checks the real public/data/routing-graph.json. No network, no Cesium.
// Run from the repo root: npx -y tsx --test src/routing/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraphFile, type SourceRoad } from './buildGraph';
import { RoutingGraph } from './graph';
import type { GraphFile } from './graphFile';
import { joinRoadEnds } from './join';
import { planRoute, planRoutes, setRoutingGraph } from './planRoute';
import { findPath } from './search';
import type { LonLat, RoadClass, Stop } from './types';

const road = (name: string, cls: RoadClass, highway: string, coordinates: LonLat[]): SourceRoad => ({
  properties: { name, class: cls, highway, crossing: cls === 'crossing' ? name.replace(/ (Rd|Blvd|Dr)$/, '') : '' },
  geometry: { coordinates },
});

const stop = (id: string, name: string, lon: number, lat: number): Stop => ({ id, name, kind: 'custom', lon, lat });

function load(roads: SourceRoad[]): RoutingGraph {
  const { file } = buildGraphFile({ roads, controls: [], places: [], source: 'synthetic' });
  return setRoutingGraph(file as GraphFile);
}

/** Metres to degrees of latitude near 34.1, so a test can put a road end a known distance from a line. */
const LAT_M = 1 / 110574;

test('joins a road end that stops a few metres short of the road it meets', () => {
  // Ridge Rd runs east-west through (-118.6, 34.12). Canyon Rd comes from the north and stops 8 m short of it.
  const gap = 8 * LAT_M;
  const roads = [
    road('Ridge Rd', 'crossing', 'secondary', [[-118.61, 34.12], [-118.6, 34.12], [-118.59, 34.12]]),
    road('Canyon Rd', 'crossing', 'secondary', [[-118.6, 34.14], [-118.6, 34.12 + gap]]),
  ];
  const graph = load(roads);
  const north = graph.nearestNode(-118.6, 34.14, 1)!.node;
  const east = graph.nearestNode(-118.59, 34.12, 1)!.node;
  const path = findPath(graph, north, east, (edge) => graph.classOf(edge) !== 'highway');
  assert.ok(path, 'Canyon Rd should reach Ridge Rd through the join');
});

test('joins two road ends that are a few metres apart at the same junction', () => {
  const roads = [
    road('Ridge Rd', 'crossing', 'secondary', [[-118.61, 34.12], [-118.6, 34.12]]),
    road('Canyon Rd', 'crossing', 'secondary', [[-118.6, 34.12 + 5 * LAT_M], [-118.6, 34.14]]),
  ];
  const graph = load(roads);
  const west = graph.nearestNode(-118.61, 34.12, 1)!.node;
  const north = graph.nearestNode(-118.6, 34.14, 1)!.node;
  assert.ok(findPath(graph, west, north, () => true));
});

test('does not join a road to a freeway, even when it passes close by', () => {
  const gap = 8 * LAT_M;
  const lines: LonLat[][] = [
    [[-118.6, 34.14], [-118.6, 34.12 + gap]],
    [[-118.61, 34.12], [-118.6, 34.12], [-118.59, 34.12]],
  ];
  const localEnd = lines[0][1];
  const freewayBefore = JSON.stringify(lines[1]);
  joinRoadEnds(lines, [true, false], 12);
  // The freeway (index 1) is not a join target, so the local road's end stays where the source put it.
  assert.deepEqual(lines[0][1], localEnd);
  assert.equal(JSON.stringify(lines[1]), freewayBefore);
});

test('a road end 30 m away is not joined', () => {
  const end: LonLat = [-118.6, 34.12 + 30 * LAT_M];
  const lines: LonLat[][] = [
    [[-118.6, 34.14], end],
    [[-118.61, 34.12], [-118.6, 34.12], [-118.59, 34.12]],
  ];
  joinRoadEnds(lines, [true, true], 12);
  assert.deepEqual(lines[0][1], end);
});

// A canyon crossing (Lynn Rd) and a second one (Potrero Rd) join the same two stops, plus a freeway loop and a
// collector that is longer than both canyons. The canyon route must win; the freeway is never banned.
const ORIGIN = [-118.6, 34.1] as LonLat;
const DEST = [-118.5, 34.1] as LonLat;
const TWO_CANYONS: SourceRoad[] = [
  road('Lynn Rd', 'crossing', 'secondary', [ORIGIN, [-118.55, 34.12], DEST]),
  road('Potrero Rd', 'crossing', 'secondary', [ORIGIN, [-118.55, 34.115], DEST]),
  road('US 101', 'highway', 'motorway_link', [ORIGIN, [-118.55, 34.05], DEST]),
  road('Side St', 'collector', 'residential', [ORIGIN, [-118.55, 34.2], DEST]),
];
const A = stop('a', 'West', ORIGIN[0], ORIGIN[1]);
const B = stop('b', 'East', DEST[0], DEST[1]);

test('planRoute prefers a canyon crossing over a collector of similar length', () => {
  const side: LonLat[] = [ORIGIN, [-118.55, 34.1195], DEST];
  load([road('Lynn Rd', 'crossing', 'secondary', [ORIGIN, [-118.55, 34.12], DEST]), road('Side St', 'collector', 'residential', side)]);
  const route = planRoute([A, B]);
  assert.equal(route.label, 'Lynn');
  assert.equal(route.highwayShare, 0);
  assert.equal(route.alternative, 0);
});

test('a freeway is priced, not banned: it is used when it is the only way, with a warning and a share', () => {
  load([TWO_CANYONS[2]]);
  const route = planRoute([A, B]);
  assert.equal(route.highwayShare, 1);
  assert.ok(route.warnings.some((warning) => warning.includes('highway')));
});

test('planRoutes returns the preferred canyon first, then distinct canyons labeled by their main road', () => {
  load(TWO_CANYONS);
  const routes = planRoutes([A, B]);
  // Potrero is the shorter canyon, so it is preferred. Side St is a collector, never an alternative.
  assert.deepEqual(routes.map((route) => route.label), ['Potrero', 'Lynn']);
  assert.deepEqual(routes.map((route) => route.alternative), [0, 1]);
  for (const route of routes) {
    assert.equal(route.highwayShare, 0);
    assert.ok(route.durationS > 0);
    assert.ok(route.geometry.length >= 2);
  }
});

test('planRoutes keeps the freeway out of the alternatives and respects maxRoutes', () => {
  load(TWO_CANYONS);
  assert.equal(planRoutes([A, B], { maxRoutes: 1 }).length, 1);
  const routes = planRoutes([A, B]);
  assert.ok(routes.every((route) => route.label !== 'US 101' && (route.highwayShare ?? 0) <= 0.1));
});

test('route segments are per named road, add up to the leg, and carry difficulty and curvature', () => {
  load(TWO_CANYONS);
  const route = planRoute([A, B]);
  const leg = route.legs[0];
  assert.equal(route.label, 'Potrero');
  assert.ok(leg.segments && leg.segments.length >= 1);
  const meters = leg.segments!.reduce((sum, segment) => sum + segment.distanceM, 0);
  assert.ok(Math.abs(meters - leg.distanceM) <= leg.segments!.length + 1, `segments ${meters} vs leg ${leg.distanceM}`);
  for (const segment of leg.segments!) {
    assert.ok(['easy', 'intermediate', 'medium', 'hard', 'difficult'].includes(segment.difficulty));
    assert.ok(segment.curvature >= 0 && segment.curvature <= 1);
    assert.equal(segment.gradePct, null);
  }
  assert.equal(leg.segments![0].roadName, 'Potrero Rd');
  assert.equal(leg.segments![0].crossing, 'Potrero');
});

// ---- The built graph: real pairs from the bug report ----

const REAL_GRAPH = JSON.parse(readFileSync('public/data/routing-graph.json', 'utf8')) as GraphFile;
const PLACE = (id: string): Stop => {
  const place = REAL_GRAPH.places.find((item) => item.id === id);
  assert.ok(place, `place ${id} is in the graph`);
  return { id: place.id, name: place.name, kind: place.kind === 'city' ? 'city' : 'poi', lon: place.lon, lat: place.lat };
};

test('the built graph routes Newbury Park to Woodland Hills on canyon roads, with alternatives', () => {
  setRoutingGraph(REAL_GRAPH);
  const routes = planRoutes([PLACE('newbury-park'), PLACE('woodland-hills')], { avoidHighways: true, avoidLocal: true, departAt: '2026-10-19T08:00:00.000Z' });
  assert.ok(routes.length >= 2, `expected alternatives, got ${routes.length}`);
  assert.equal(routes[0].highwayShare, 0);
  assert.ok(routes[0].distanceM < 40000, `preferred route is ${routes[0].distanceM} m`);
  assert.equal(new Set(routes.map((route) => route.label)).size, routes.length, 'labels are distinct');
  for (const route of routes) assert.ok(route.durationS > 15 * 60 && route.durationS < 2 * 3600, `${route.label} time ${route.durationS}`);
});

test('the built graph offers several canyon routes from Newbury Park to Woodland Hills, none on a freeway', () => {
  setRoutingGraph(REAL_GRAPH);
  const routes = planRoutes([PLACE('newbury-park'), PLACE('woodland-hills')], { avoidHighways: true, avoidLocal: true });
  assert.ok(routes.length >= 3, `expected at least three canyon routes, got ${routes.length}`);
  for (const route of routes) assert.equal(route.highwayShare, 0, `${route.label} uses a freeway`);
  const viaLynn = routes.filter((route) => route.legs.some((leg) => leg.steps.some((step) => step.roadName === 'Lynn Rd')));
  assert.ok(viaLynn.length >= 1, `no route uses Lynn Rd: ${routes.map((route) => route.label).join(', ')}`);
});

test('the built graph routes the other valley-to-canyon pairs with no freeway in the preferred route', () => {
  setRoutingGraph(REAL_GRAPH);
  const pairs: [string, string][] = [
    ['westlake-village', 'woodland-hills'],
    ['thousand-oaks', 'calabasas'],
    ['agoura-hills', 'calabasas'],
    ['calabasas', 'topanga'],
    ['thousand-oaks', 'malibu'],
    ['agoura-hills', 'topanga'],
  ];
  for (const [a, b] of pairs) {
    const routes = planRoutes([PLACE(a), PLACE(b)], { avoidHighways: true, avoidLocal: true });
    assert.ok(routes.length >= 1, `${a} to ${b} has no route`);
    assert.equal(routes[0].highwayShare, 0, `${a} to ${b} preferred route uses a freeway`);
  }
});

test('planRoutes on the built graph is fast enough to run on every stop change', () => {
  setRoutingGraph(REAL_GRAPH);
  const start = Date.now();
  planRoutes([PLACE('newbury-park'), PLACE('woodland-hills')], { avoidHighways: true, avoidLocal: true });
  assert.ok(Date.now() - start < 2000, `planRoutes took ${Date.now() - start} ms`);
});

test('planRoute on the built graph keeps the Route shape the planner reads', () => {
  setRoutingGraph(REAL_GRAPH);
  const route = planRoute([PLACE('newbury-park'), PLACE('woodland-hills')], { avoidHighways: true, avoidLocal: true });
  assert.equal(route.alternative, 0);
  assert.equal(typeof route.label, 'string');
  assert.ok(route.legs[0].steps.length >= 2);
  assert.ok(route.legs[0].segments && route.legs[0].segments.length > 0);
});
