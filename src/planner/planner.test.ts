// Run from the repo root: npx -y tsx --test src/planner/planner.test.ts
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadGraph, type RoadFeature } from '../lib/roads/route';
import { DIFFICULTY_META, harder } from './difficulty';
import { formatClock, formatDistance, formatDuration, fromLocalInput, stopLetter, toLocalInput } from './format';
import {
  buildNetwork,
  findIntersections,
  placeStop,
  rankStops,
  rateDifficulty,
  routeOnGraph,
  customStop,
} from './engine';
import { INITIAL_PLAN, MAX_STOPS, planReducer, defaultRouteName } from './planState';
import { PRESET_ROUTES } from './presets';
import { createLocalRouteStore, type SavedRoute } from './routeStore';
import { PLACES } from '../map/places';
import type { Stop } from './types';

const stop = (id: string, lon: number, lat: number, kind: Stop['kind'] = 'custom'): Stop => ({
  id,
  name: id.toUpperCase(),
  kind,
  lon,
  lat,
});

/** A small grid: a crossing running east from X, then a local street north from its end. */
function syntheticFeatures(): RoadFeature[] {
  return [
    {
      properties: { name: 'Decker Rd', class: 'crossing', crossing: 'Decker' },
      geometry: {
        coordinates: [
          [-118.7, 34.1],
          [-118.69, 34.1],
          [-118.68, 34.1],
        ],
      },
    },
    {
      properties: { name: 'Mulholland Hwy', class: 'crossing', crossing: 'Mulholland Hwy' },
      geometry: {
        coordinates: [
          [-118.69, 34.09],
          [-118.69, 34.1],
          [-118.69, 34.11],
        ],
      },
    },
    {
      properties: { name: 'Ventura Blvd', class: 'arterial' },
      geometry: { coordinates: [[-118.66, 34.1], [-118.6, 34.1]] },
    },
  ];
}

test('formats distance, duration and clock in US units', () => {
  assert.equal(formatDistance(1609.344), '1.0 mi');
  assert.equal(formatDistance(10 * 1609.344), '10 mi');
  assert.equal(formatDistance(50), '164 ft');
  assert.equal(formatDuration(30), '1 min');
  assert.equal(formatDuration(45 * 60), '45 min');
  assert.equal(formatDuration(65 * 60), '1 h 5 min');
  assert.equal(formatDuration(2 * 3600), '2 h');
  assert.match(formatClock('2026-10-19T16:05:00.000Z'), /\d/);
  assert.equal(stopLetter(0), 'A');
  assert.equal(stopLetter(25), 'Z');
  assert.equal(stopLetter(26), '27');
});

test('local datetime round-trips', () => {
  const date = new Date(2026, 9, 19, 7, 45);
  assert.equal(toLocalInput(date), '2026-10-19T07:45');
  assert.equal(fromLocalInput('2026-10-19T07:45')?.getTime(), date.getTime());
  assert.equal(fromLocalInput(''), null);
  assert.equal(fromLocalInput('not a date'), null);
});

test('Minecraft difficulty colors are the ones chosen', () => {
  assert.equal(DIFFICULTY_META.easy.color, '#55FF55');
  assert.equal(DIFFICULTY_META.intermediate.color, '#FFFF55');
  assert.equal(DIFFICULTY_META.medium.color, '#FFAA00');
  assert.equal(DIFFICULTY_META.hard.color, '#FF5555');
  assert.equal(DIFFICULTY_META.difficult.color, '#AA0000');
  assert.equal(harder('hard', 'medium'), 'hard');
  assert.equal(harder('easy', 'difficult'), 'difficult');
});

test('difficulty rises with local roads and bends', () => {
  assert.equal(rateDifficulty([{ cls: 'arterial', meters: 1000 }], 1), 'easy');
  assert.equal(rateDifficulty([{ cls: 'crossing', meters: 1000 }], 1), 'medium');
  assert.equal(rateDifficulty([{ cls: 'local', meters: 1000 }], 1.6), 'difficult');
  assert.equal(rateDifficulty([], 1), 'easy');
});

test('intersections name the two roads that meet, most important first', () => {
  const graph = buildRoadGraph(syntheticFeatures(), () => true);
  const junctions = findIntersections(graph);
  assert.equal(junctions.length, 1);
  assert.equal(junctions[0].kind, 'intersection');
  assert.equal(junctions[0].name, 'Decker Rd & Mulholland Hwy');
  assert.ok(Math.abs(junctions[0].lon - -118.69) < 1e-9 && Math.abs(junctions[0].lat - 34.1) < 1e-9);
});

test('a route is lettered legs with times, steps and a hardest-leg rating', () => {
  const { graph } = buildNetwork(syntheticFeatures(), 'all');
  const start = stop('start', -118.7, 34.1, 'city');
  const middle = stop('middle', -118.69, 34.1, 'intersection');
  const end = stop('end', -118.68, 34.1, 'poi');
  const depart = new Date('2026-10-19T16:00:00.000Z');
  const route = routeOnGraph(graph, [start, middle, end], depart);

  assert.equal(route.legs.length, 2);
  assert.deepEqual(
    route.legs.map((leg) => leg.from.id),
    ['start', 'middle'],
  );
  assert.equal(route.departAt, depart.toISOString());
  assert.equal(route.arriveAt, new Date(depart.getTime() + route.durationS * 1000).toISOString());
  assert.ok(route.distanceM > 0 && route.durationS > 0);
  // The second leg runs east on the crossing, then the route rating is the harder of the two legs.
  assert.equal(route.legs[1].steps[0].kind, 'depart');
  assert.equal(route.legs[1].steps.at(-1)?.kind, 'arrive');
  assert.equal(route.legs[1].steps.at(-1)?.instruction, 'Arrive at END');
  const hardest = route.legs.reduce((a, b) => (harder(a.difficulty, b.difficulty) === a.difficulty ? a : b));
  assert.equal(route.difficulty, hardest.difficulty);
  // Consecutive legs share the junction point once.
  assert.equal(route.geometry.length, route.legs.reduce((sum, leg) => sum + leg.geometry.length, 0) - 1);
});

test('a stop far from every road is refused with its name', () => {
  const { graph } = buildNetwork(syntheticFeatures(), 'all');
  assert.throws(
    () => routeOnGraph(graph, [stop('start', -118.7, 34.1), stop('far', -117.0, 34.1)], new Date()),
    /No road on this network within 3 km of FAR/,
  );
});

test('stop search ranks prefixes first and needs every word to match', () => {
  const stops = [
    placeStop(PLACES.find((place) => place.id === 'newbury-park')!),
    placeStop(PLACES.find((place) => place.id === 'malibu')!),
    { id: 'x', name: 'Decker Rd & Mulholland Hwy', kind: 'intersection' as const, lon: 0, lat: 0 },
  ];
  assert.equal(rankStops('newb', stops)[0].name, 'Newbury Park');
  assert.deepEqual(
    rankStops('decker mulho', stops).map((candidate) => candidate.name),
    ['Decker Rd & Mulholland Hwy'],
  );
  assert.deepEqual(rankStops('zzz', stops), []);
  assert.deepEqual(
    rankStops('', stops).map((candidate) => candidate.name),
    ['Newbury Park', 'Malibu'],
  );
});

test('reducer adds, moves, removes, reverses and refuses repeats', () => {
  const a = stop('a', 0, 0);
  const b = stop('b', 1, 1);
  const c = stop('c', 2, 2);
  let state = planReducer(INITIAL_PLAN, { type: 'add', stop: a });
  state = planReducer(state, { type: 'add', stop: a });
  assert.equal(state.stops.length, 1, 'a repeat of the last stop is ignored');
  state = planReducer(state, { type: 'add', stop: b });
  state = planReducer(state, { type: 'add', stop: c, index: 1 });
  assert.deepEqual(state.stops.map((s) => s.id), ['a', 'c', 'b']);
  state = planReducer(state, { type: 'move', from: 2, to: 0 });
  assert.deepEqual(state.stops.map((s) => s.id), ['b', 'a', 'c']);
  state = planReducer(state, { type: 'remove', index: 1 });
  assert.deepEqual(state.stops.map((s) => s.id), ['b', 'c']);
  state = planReducer(state, { type: 'reverse' });
  assert.deepEqual(state.stops.map((s) => s.id), ['c', 'b']);
  state = planReducer(state, { type: 'move', from: 0, to: 9 });
  assert.deepEqual(state.stops.map((s) => s.id), ['c', 'b'], 'out-of-range moves are ignored');
  state = planReducer(state, { type: 'clear' });
  assert.equal(state.stops.length, 0);
});

test('reducer caps the number of stops', () => {
  let state = INITIAL_PLAN;
  for (let i = 0; i < MAX_STOPS + 5; i++) state = planReducer(state, { type: 'add', stop: stop(`s${i}`, i, 0) });
  assert.equal(state.stops.length, MAX_STOPS);
});

test('default names read A to B', () => {
  assert.equal(defaultRouteName([]), 'New route');
  assert.equal(defaultRouteName([stop('a', 0, 0)]), 'A');
  assert.equal(defaultRouteName([stop('a', 0, 0), stop('b', 0, 0)]), 'A to B');
});

test('custom stops keep the clicked point', () => {
  const pin = customStop(-118.7, 34.1);
  assert.equal(pin.kind, 'custom');
  assert.equal(pin.name, 'Dropped pin');
  assert.equal(pin.lon, -118.7);
});

test('saved routes persist through the store, sorted by last update', async () => {
  const cell = new Map<string, string>();
  const storage = {
    getItem: (key: string) => cell.get(key) ?? null,
    setItem: (key: string, value: string) => void cell.set(key, value),
    removeItem: (key: string) => void cell.delete(key),
  } as unknown as Storage;
  const store = createLocalRouteStore(storage);
  const route = (id: string, updatedAt: string): SavedRoute => ({
    id,
    name: `Route ${id}`,
    stops: [stop('a', 0, 0), stop('b', 1, 1)],
    network: 'canyons',
    createdAt: updatedAt,
    updatedAt,
  });
  await store.save(route('one', '2026-10-01T00:00:00.000Z'));
  await store.save(route('two', '2026-10-02T00:00:00.000Z'));
  await store.save({ ...route('one', '2026-10-03T00:00:00.000Z'), name: 'Renamed' });
  const listed = await store.list();
  assert.deepEqual(listed.map((r) => r.id), ['one', 'two']);
  assert.equal(listed[0].name, 'Renamed');
  await store.remove('two');
  assert.deepEqual((await store.list()).map((r) => r.id), ['one']);
});

test('a corrupt store reads as empty and does not throw', async () => {
  const storage = {
    getItem: () => '{not json',
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => undefined,
  } as unknown as Storage;
  const store = createLocalRouteStore(storage);
  assert.deepEqual(await store.list(), []);
  await store.save({ id: 'x', name: 'x', stops: [], network: 'all', createdAt: '', updatedAt: '' });
});

test('every preset resolves to real places', () => {
  for (const preset of PRESET_ROUTES) {
    assert.ok(preset.stops.length >= 2, `${preset.name} needs two stops`);
    for (const s of preset.stops) assert.ok(s.kind === 'city' || s.kind === 'poi', s.name);
  }
});

test('real road data: the Newbury Park to Woodland Hills preset routes on canyon roads', () => {
  const features = JSON.parse(readFileSync('public/data/roads.geojson', 'utf8')).features as RoadFeature[];
  const { graph } = buildNetwork(features, 'canyons');
  const preset = PRESET_ROUTES.find((candidate) => candidate.id === 'preset-newbury-woodland')!;
  const route = routeOnGraph(graph, preset.stops, new Date('2026-10-19T16:00:00.000Z'));
  const roads = new Set(route.legs.flatMap((leg) => leg.steps.map((step) => step.roadName)));
  assert.ok(!roads.has('unnamed road'), 'every canyon step has a road name');
  assert.ok(route.distanceM > 5000, `expected a multi-mile canyon route, got ${route.distanceM} m`);
  assert.ok(route.durationS > 300);
  console.log(
    `Newbury Park to Woodland Hills (canyons): ${formatDistance(route.distanceM)}, ${formatDuration(route.durationS)}, ${route.difficulty}, ${route.legs[0].steps.length} steps; roads: ${[...roads].slice(0, 8).join(', ')}`,
  );
});
