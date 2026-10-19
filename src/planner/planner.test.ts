// Run from the repo root: npx -y tsx --test src/planner/planner.test.ts
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRoutingGraph } from '../routing';
import type { GraphFile } from '../routing/graphFile';
import { DIFFICULTY_META, harder } from './difficulty';
import { customStop, planRoute, suggestStops } from './engine';
import { EXTRA_STOPS } from './extraStops';
import { metersBetween } from '../routing/geo';
import { formatClock, formatDistance, formatDuration, fromLocalInput, stopLetter, toLocalInput } from './format';
import { INITIAL_PLAN, MAX_STOPS, planReducer, defaultRouteName } from './planState';
import { PRESET_ROUTES } from './presets';
import { createLocalRouteStore, type SavedRoute } from './routeStore';
import type { Stop } from './types';

const stop = (id: string, lon: number, lat: number): Stop => ({ id, name: id.toUpperCase(), kind: 'custom', lon, lat });

/** The routing graph built by the routing thread, loaded once for the engine tests. */
function loadGraph(): void {
  const file = JSON.parse(readFileSync('public/data/routing-graph.json', 'utf8')) as GraphFile;
  setRoutingGraph(file);
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

test('difficulty chips use the Minecraft colors and the labels', () => {
  assert.equal(DIFFICULTY_META.easy.color, '#55FF55');
  assert.equal(DIFFICULTY_META.intermediate.color, '#FFFF55');
  assert.equal(DIFFICULTY_META.medium.color, '#FFAA00');
  assert.equal(DIFFICULTY_META.hard.color, '#FF5555');
  assert.equal(DIFFICULTY_META.difficult.color, '#AA0000');
  assert.equal(DIFFICULTY_META.difficult.label, 'Difficult');
  assert.equal(harder('hard', 'medium'), 'hard');
  assert.equal(harder('easy', 'difficult'), 'difficult');
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

test('a map click becomes a custom stop named for the pin', () => {
  const pin = customStop(-118.7, 34.1);
  assert.equal(pin.kind, 'custom');
  assert.equal(pin.name, 'Dropped pin');
  assert.equal(pin.lon, -118.7);
  assert.equal(pin.lat, 34.1);
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

test('every preset stop is a real place, and each preset has two or more stops', () => {
  for (const preset of PRESET_ROUTES) {
    assert.ok(preset.stops.length >= 2, `${preset.name} needs two stops`);
    for (const s of preset.stops) assert.ok(s.kind === 'city' || s.kind === 'poi', s.name);
  }
});

test('the routing engine plans the Newbury Park to Woodland Hills preset', async () => {
  loadGraph();
  const preset = PRESET_ROUTES.find((candidate) => candidate.id === 'preset-newbury-woodland')!;
  const route = await planRoute(preset.stops, { network: preset.network, departAt: '2026-10-19T16:00:00.000Z' });
  assert.equal(route.stops.length, preset.stops.length);
  assert.ok(route.distanceM > 5000, `expected a multi-mile route, got ${route.distanceM} m`);
  assert.ok(route.durationS > 300);
  assert.equal(route.departAt, '2026-10-19T16:00:00.000Z');
  assert.ok(Array.isArray(route.warnings));
  console.log(
    `Newbury Park to Woodland Hills (canyons, real engine): ${formatDistance(route.distanceM)}, ${formatDuration(route.durationS)}, ${route.difficulty}, warnings: ${route.warnings.join(' | ')}`,
  );
});

test('the routing engine suggests junctions and places for the search box', async () => {
  loadGraph();
  const suggestions = await suggestStops('newbury', { network: 'canyons' });
  assert.ok(suggestions.some((candidate) => candidate.name === 'Newbury Park'));
});

test('with no query, suggestions are branch-off junctions near the last stop, then city centers', async () => {
  loadGraph();
  const near = { lon: -118.9226, lat: 34.1786 };
  const suggestions = await suggestStops('', { network: 'canyons', near }, 8);
  assert.ok(suggestions.length > 0 && suggestions.length <= 8);
  const junctions = suggestions.filter((candidate) => candidate.kind === 'intersection');
  assert.ok(junctions.length > 0, 'expected at least one branch-off junction near Newbury Park');
  for (const junction of junctions) {
    const meters = metersBetween([near.lon, near.lat], [junction.lon, junction.lat]);
    assert.ok(meters <= 15000, `${junction.name} is ${Math.round(meters)} m away`);
    assert.match(junction.name, / & /);
  }
  // Junctions come before cities in the list.
  const firstCity = suggestions.findIndex((candidate) => candidate.kind === 'city');
  const lastJunction = suggestions.map((candidate) => candidate.kind).lastIndexOf('intersection');
  if (firstCity >= 0) assert.ok(lastJunction < firstCity);
});

test('Calabasas High School is a checked extra stop and appears in search', async () => {
  loadGraph();
  const school = EXTRA_STOPS.find((candidate) => candidate.name === 'Calabasas High School');
  assert.ok(school, 'extra stop is listed');
  assert.ok(school.source.includes('Wikidata Q5018284') && school.source.includes('OpenStreetMap'));
  assert.ok(school.lat > 34.1 && school.lat < 34.2 && school.lon > -118.7 && school.lon < -118.6);
  const found = await suggestStops('calabasas high', { network: 'canyons' });
  assert.ok(found.some((candidate) => candidate.name === 'Calabasas High School'));
});

test('the Calabasas High School stop routes on the real graph', async () => {
  loadGraph();
  const school = EXTRA_STOPS.find((candidate) => candidate.name === 'Calabasas High School')!;
  const start = PRESET_ROUTES.find((candidate) => candidate.id === 'preset-newbury-calabasas')!.stops[0];
  const route = await planRoute([start, school], { network: 'all', departAt: '2026-10-19T16:00:00.000Z' });
  assert.equal(route.legs.length, 1);
  assert.ok(route.distanceM > 1000);
});
