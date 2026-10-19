// Mountain-first Canyon routing: the mountain score, the search weights, and the four example trips on the built graph.
// The example trips check the top route (no long run on Thousand Oaks Blvd or Ventura Blvd, no freeway) and that the
// alternatives really differ. No network, no Cesium. Run from the repo root: npx -y tsx --test src/routing/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metersBetween } from './geo';
import type { GraphFile } from './graphFile';
import { CORRIDOR_WEIGHT, FREEWAY_MOUNTAIN_WEIGHT, mountainWeight, sampleLine, scoreTerrain } from './mountain';
import { planRoutes, setRoutingGraph } from './planRoute';
import type { LonLat, Route, Stop } from './types';

const REAL_GRAPH = JSON.parse(readFileSync('public/data/routing-graph.json', 'utf8')) as GraphFile;
const PLACE = (id: string): Stop => {
  const place = REAL_GRAPH.places.find((item) => item.id === id);
  if (!place) throw new Error(`place ${id} is in the graph`);
  return { id: place.id, name: place.name, kind: place.kind === 'city' ? 'city' : 'poi', lon: place.lon, lat: place.lat };
};
const MOUNTAIN_OPTIONS = { avoidHighways: true, avoidLocal: true, mountainRoads: true, departAt: '2026-10-19T08:00:00.000Z' };

/** Metres of a route on the named roads, from the per-road segments. */
function metersOn(route: Route, names: RegExp): number {
  let total = 0;
  for (const leg of route.legs) for (const segment of leg.segments ?? []) if (names.test(segment.roadName)) total += segment.distanceM;
  return total;
}

/** Road names of a route, weighted by distance. Two routes that differ in their turns have different weights. */
function roadWeights(route: Route): Map<string, number> {
  const weights = new Map<string, number>();
  for (const leg of route.legs) {
    for (const segment of leg.segments ?? []) {
      if (!segment.roadName) continue;
      weights.set(segment.roadName, (weights.get(segment.roadName) ?? 0) + segment.distanceM);
    }
  }
  return weights;
}

/** Share of the two routes' road distance that is common to both (1 means the same roads, 0 means none). */
function roadOverlap(a: Route, b: Route): number {
  const wa = roadWeights(a);
  const wb = roadWeights(b);
  let shared = 0;
  let total = 0;
  for (const [name, meters] of wa) {
    shared += Math.min(meters, wb.get(name) ?? 0);
    total += meters;
  }
  for (const [name, meters] of wb) if (!wa.has(name)) total += meters;
  return total > 0 ? shared / total : 1;
}

const VALLEY_ARTERIAL = /^(Thousand Oaks Blvd|Ventura Blvd)$/;

/** The example trips. Each one must come back with a top route that stays out of the valley. */
const TRIPS: [string, string][] = [
  ['newbury-park', 'woodland-hills'],
  ['newbury-park', 'malibu'],
  ['calabasas', 'thousand-oaks'],
  ['woodland-hills', 'westlake-village'],
];

test('a freeway or a valley road beside the 101 scores as valley; a high canyon scores as mountain', () => {
  const corridorArterial = scoreTerrain({
    cls: 'arterial',
    curvatureDegPerKm: 10,
    terrain: { meanElevM: 260, gradePct: 0.5 },
    corridorM: 300,
  });
  assert.equal(corridorArterial.corridor, true);
  assert.ok(corridorArterial.mountain < 25, `valley arterial scored ${corridorArterial.mountain}`);

  const canyon = scoreTerrain({
    cls: 'crossing',
    curvatureDegPerKm: 180,
    terrain: { meanElevM: 520, gradePct: 7 },
    corridorM: 3500,
  });
  assert.equal(canyon.corridor, false);
  assert.ok(canyon.mountain >= 75, `high canyon scored ${canyon.mountain}`);

  assert.deepEqual(scoreTerrain({ cls: 'highway', curvatureDegPerKm: 0, terrain: { meanElevM: 500, gradePct: 0 }, corridorM: 0 }), {
    mountain: 0,
    corridor: false,
  });
});

test('without elevation a road is scored on its other signals, not treated as valley or ridge', () => {
  const neutral = scoreTerrain({ cls: 'collector', curvatureDegPerKm: 0, terrain: { meanElevM: null, gradePct: null }, corridorM: 4000 });
  assert.equal(neutral.corridor, false);
  assert.ok(neutral.mountain > 0 && neutral.mountain < 100);
});

test('search weights: mountain roads are cheap, valley roads beside the 101 cost the most, freeways cost more than either', () => {
  assert.equal(mountainWeight(100, false), 0.8);
  assert.ok(mountainWeight(0, false) > mountainWeight(50, false));
  assert.equal(mountainWeight(0, true), CORRIDOR_WEIGHT);
  assert.ok(CORRIDOR_WEIGHT > 4 && FREEWAY_MOUNTAIN_WEIGHT > CORRIDOR_WEIGHT);
  for (let m = 0; m <= 100; m += 10) assert.ok(mountainWeight(m, false) >= 0.8, 'heuristic stays admissible');
});

test('sampleLine spaces points by distance along the line, not by vertex', () => {
  // 747 m of road drawn as 101 vertices, about 7.5 m apart.
  const dense: LonLat[] = [];
  for (let i = 0; i <= 100; i++) dense.push([-118.6 + i * 0.00009 * 0.9, 34.1]);
  const samples = sampleLine(dense, 250);
  assert.equal(samples.length, 4, `expected 4 samples, got ${samples.length}`);
  assert.deepEqual(samples[0], dense[0]);
  assert.deepEqual(samples[samples.length - 1], dense[100]);
  for (let i = 1; i < samples.length; i++) assert.ok(metersBetween(samples[i - 1], samples[i]) <= 251);
});

test('the built graph carries a mountain score and corridor flag on every road piece', () => {
  for (const row of REAL_GRAPH.edges) {
    assert.equal(row.length, 12, 'edge row has the version 2 layout');
    const [, , , , cls, , , , , mountain, corridor] = row;
    assert.ok(mountain >= 0 && mountain <= 100);
    assert.ok(corridor === 0 || corridor === 1);
    if (cls === 0) assert.equal(mountain, 0, 'freeways score 0');
  }
});

for (const [a, b] of TRIPS) {
  test(`mountain routes ${a} to ${b}: the top route stays off the valley arterials and the alternatives differ`, () => {
    setRoutingGraph(REAL_GRAPH);
    const routes = planRoutes([PLACE(a), PLACE(b)], MOUNTAIN_OPTIONS);
    assert.ok(routes.length >= 1, `${a} to ${b} has no route`);
    const top = routes[0];
    assert.equal(top.alternative, 0);
    // Thousand Oaks sits on the 23 and the 101. Calabasas to Thousand Oaks needs about 4.5 km of State Route 23 (a share
    // of about 0.10 of a 45 km route), the only link the graph has, so the freeway share is short rather than zero for that
    // trip (it carries a warning).
    assert.ok((top.highwayShare ?? 0) <= 0.11, `top route is ${(top.highwayShare ?? 0).toFixed(3)} freeway`);
    assert.ok((top.mountainShare ?? 0) >= 0.5, `top route is ${(top.mountainShare ?? 0).toFixed(2)} mountain`);
    assert.ok(metersOn(top, VALLEY_ARTERIAL) <= 5000, `top route runs ${metersOn(top, VALLEY_ARTERIAL)} m on Thousand Oaks or Ventura Blvd`);
    assert.ok(top.summary && top.summary.startsWith('via '), `summary is "${top.summary}"`);

    for (let i = 0; i < routes.length; i++) {
      assert.equal(routes[i].alternative, i);
      for (let j = i + 1; j < routes.length; j++) {
        assert.ok(roadOverlap(routes[i], routes[j]) < 0.9, `routes ${i} and ${j} are near-identical`);
      }
    }
  });
}

test('mountain mode sorts the routes most mountain-heavy first', () => {
  setRoutingGraph(REAL_GRAPH);
  const routes = planRoutes([PLACE('newbury-park'), PLACE('malibu')], MOUNTAIN_OPTIONS);
  for (let i = 1; i < routes.length; i++) {
    assert.ok((routes[i - 1].mountainShare ?? 0) >= (routes[i].mountainShare ?? 0), 'mountainShare is non-increasing');
  }
});

test('all roads mode keeps the class-based fastest routing, with no mountain scoring applied', () => {
  setRoutingGraph(REAL_GRAPH);
  const routes = planRoutes([PLACE('newbury-park'), PLACE('woodland-hills')], { avoidHighways: true, avoidLocal: false });
  assert.ok(routes.length >= 1);
  assert.ok(routes[0].distanceM < 40000, `all-roads route is ${routes[0].distanceM} m`);
});
