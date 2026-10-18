// Run from the repo root: npx -y tsx --test src/map/places.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_LABEL, PLACES, POI_KINDS, SETTLEMENT_KINDS, searchPlaces, type Place } from './places';

// Box around Topanga, the Santa Monica Mountains, and the Conejo Valley. A place outside it is a data error.
const BOX = { south: 33.95, north: 34.3, west: -119.1, east: -118.35 };

test('every place has a unique id and a name', () => {
  const ids = PLACES.map((place) => place.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  for (const place of PLACES) assert.ok(place.name.trim().length > 0, `${place.id} has no name`);
});

test('every place is inside the map area', () => {
  for (const place of PLACES) {
    assert.ok(place.lat >= BOX.south && place.lat <= BOX.north, `${place.name} latitude ${place.lat}`);
    assert.ok(place.lon >= BOX.west && place.lon <= BOX.east, `${place.name} longitude ${place.lon}`);
  }
});

test('every place has a known kind, a blurb, and a source', () => {
  const kinds = new Set([...SETTLEMENT_KINDS, ...POI_KINDS]);
  for (const place of PLACES) {
    assert.ok(kinds.has(place.kind), `${place.name} has unknown kind ${place.kind}`);
    assert.ok(place.blurb.length > 20 && place.blurb.length <= 160, `${place.name} blurb length ${place.blurb.length}`);
    assert.ok(place.source.length > 0, `${place.name} has no source`);
    assert.ok(place.range > 0, `${place.name} has no fly-to range`);
  }
});

test('the towns and cities the map must show are all present', () => {
  const required = [
    'Malibu',
    'Calabasas',
    'Newbury Park',
    'Westlake Village',
    'Agoura Hills',
    'Thousand Oaks',
    'Topanga',
    'Woodland Hills',
    'Santa Monica',
    'Oak Park',
  ];
  for (const name of required) {
    const place = PLACES.find((candidate) => candidate.name === name);
    assert.ok(place, `${name} is missing`);
    assert.ok(SETTLEMENT_KINDS.includes(place.kind), `${name} should be a settlement`);
  }
});

test('the named points of interest are present', () => {
  for (const name of ['Malibu Creek State Park', 'Point Mugu State Park', 'Zuma Beach', 'Sandstone Peak', 'Saddle Peak', 'Rock Pool']) {
    assert.ok(PLACES.some((place) => place.name === name), `${name} is missing`);
  }
});

test('searchPlaces ranks name starts first and matches kind names', () => {
  const names = (matches: Place[]) => matches.map((place) => place.name);
  assert.equal(names(searchPlaces('mal'))[0], 'Malibu');
  assert.ok(names(searchPlaces('oak')).indexOf('Oak Park') < names(searchPlaces('oak')).indexOf('Thousand Oaks'));
  assert.ok(names(searchPlaces('peak')).includes('Sandstone Peak'));
  assert.ok(names(searchPlaces('SADDLE')).includes('Saddle Peak'), 'search is case-insensitive');
  assert.deepEqual(searchPlaces('   '), []);
  assert.deepEqual(searchPlaces('zzqx'), []);
});

test('every kind has a label', () => {
  for (const kind of [...SETTLEMENT_KINDS, ...POI_KINDS]) assert.ok(KIND_LABEL[kind]);
});
