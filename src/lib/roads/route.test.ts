// Unit tests for the canyon-only demo route, run against the road data in public/data.
// No network and no Cesium. Run from the repo root: npx -y tsx --test src/lib/roads/route.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANYON_DEMO_STOPS } from './demoRoute';
import { buildRoadGraph, planRoute, routeCoordinates, type RoadFeature } from './route';

const collection = JSON.parse(readFileSync(new URL('../../../public/data/roads.geojson', import.meta.url), 'utf8')) as {
  features: RoadFeature[];
};

const crossingGraph = () => buildRoadGraph(collection.features, (cls) => cls === 'crossing');

test('every road in the data has a hierarchy class', () => {
  const missing = collection.features.filter((feature) => !feature.properties.class);
  assert.equal(missing.length, 0);
});

test('canyon-only route joins all four stops', () => {
  const route = planRoute(crossingGraph(), CANYON_DEMO_STOPS);
  assert.equal(route.legs.length, CANYON_DEMO_STOPS.length - 1);
  assert.ok(route.meters > 0);
  const coords = routeCoordinates(crossingGraph(), route);
  assert.ok(coords.length > 10, 'route should have many vertices');
});

test('canyon-only route uses crossings only and never the 101, PCH or another freeway', () => {
  const route = planRoute(crossingGraph(), CANYON_DEMO_STOPS);
  const edges = route.legs.flatMap((leg) => leg.edges);
  assert.ok(edges.length > 0);
  for (const edge of edges) {
    assert.equal(edge.cls, 'crossing', `${edge.name} is ${edge.cls}`);
    assert.doesNotMatch(edge.name, /\b(101|fwy|freeway|hwy 101|pacific coast|pch|moorpark)\b/i);
  }
});

test('each stop snaps to a canyon crossing within 2 km of its town center', () => {
  const route = planRoute(crossingGraph(), CANYON_DEMO_STOPS);
  for (const stop of route.stops) {
    assert.ok(stop.snapMeters < 2000, `${stop.name} snapped ${Math.round(stop.snapMeters)} m away`);
  }
});

test('demo route report, for the record', () => {
  const route = planRoute(crossingGraph(), CANYON_DEMO_STOPS);
  for (const leg of route.legs) {
    const names: string[] = [];
    for (const edge of leg.edges) {
      const label = edge.crossing ?? edge.name;
      if (names[names.length - 1] !== label) names.push(label);
    }
    console.log(`${leg.from.name} -> ${leg.to.name}: ${(leg.meters / 1000).toFixed(1)} km via ${names.join(' > ')}`);
  }
  console.log(`total ${(route.meters / 1000).toFixed(1)} km; snaps: ${route.stops.map((s) => `${s.name} ${Math.round(s.snapMeters)} m`).join(', ')}`);
});
