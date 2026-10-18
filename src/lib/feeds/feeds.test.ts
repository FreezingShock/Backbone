// Unit tests for the feed layer. No network: live loaders are injected or the feed is left unconfigured.
// Run from the repo root: npx -y tsx --test src/lib/feeds/feeds.test.ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalFireIncident } from './calfire';
import { diffById } from './diff';
import {
  dedupeFires,
  intersectsBbox,
  mergeIncident,
  nameKey,
  normalizeCaltransFeatures,
  normalizeOverrides,
  normalizeWfigsFeature,
  type RawCollection,
} from './normalize';
import { cacheControlFor, resetFeedState, resolveFeed } from './service';
import { buildWfigsQueryUrl } from './sources';
import { SMM_BBOX } from './config';
import { calFireBrysonSampleHtml } from './fixtures/calfire-bryson.sample';
import wfigsSample from './fixtures/wfigs-perimeters.sample.json';
import overrides from './data/closure-overrides.json';
import type { FireFeature } from './types';

const ORIGINAL_FIXTURE_ENV = process.env.BACKBONE_FEED_FIXTURES;

beforeEach(() => resetFeedState());
afterEach(() => {
  if (ORIGINAL_FIXTURE_ENV === undefined) delete process.env.BACKBONE_FEED_FIXTURES;
  else process.env.BACKBONE_FEED_FIXTURES = ORIGINAL_FIXTURE_ENV;
});

const sampleFires = (wfigsSample as RawCollection).features ?? [];

test('parses the CAL FIRE page sample for name, acres, containment and update text', () => {
  const incident = parseCalFireIncident(calFireBrysonSampleHtml, 'https://example.test/bryson');
  assert.ok(incident);
  assert.equal(incident.name, 'Bryson Fire');
  assert.equal(incident.acres, 147);
  assert.equal(incident.containmentPct, 39);
  assert.equal(incident.updatedText, 'October 16, 2026 9:16 PM');
});

test('returns null for a page with no usable numbers', () => {
  assert.equal(parseCalFireIncident('<html><h1>Nothing</h1><p>No data today</p></html>', 'x'), null);
});

test('normalizes WFIGS perimeters and skips non-polygon records', () => {
  const fires = sampleFires
    .map((raw) => normalizeWfigsFeature(raw, 'fixture'))
    .filter((fire): fire is FireFeature => fire !== null);
  assert.equal(fires.length, 2);
  const bryson = fires.find((fire) => fire.properties.name === 'BRYSON');
  assert.ok(bryson);
  assert.equal(bryson.id, '2026-CAVNC-SAMPLE-BRYSON');
  assert.equal(bryson.properties.acres, 147);
  assert.equal(bryson.properties.perimeterSource, 'fixture');
  assert.ok(bryson.properties.discovered?.endsWith('Z'));
  assert.equal(normalizeWfigsFeature({ geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }, 'wfigs'), null);
});

test('falls back to a name-based id when the official fire ID is missing', () => {
  const fire = normalizeWfigsFeature(
    { geometry: sampleFires[0].geometry, properties: { poly_IncidentName: 'Bryson Fire' } },
    'wfigs',
  );
  assert.equal(fire?.id, 'name:bryson');
});

test('bounding-box filter keeps the Bryson sample and drops the out-of-area fire', () => {
  const kept = sampleFires.filter((raw) => raw.geometry && intersectsBbox(raw.geometry, SMM_BBOX));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].properties?.poly_IncidentName, 'BRYSON');
});

test('CAL FIRE acres and containment override the perimeter values when the names match', () => {
  const fire = normalizeWfigsFeature(sampleFires[0], 'fixture');
  assert.ok(fire);
  const incident = parseCalFireIncident(calFireBrysonSampleHtml, 'https://example.test/bryson');
  const merged = mergeIncident(fire, incident ?? undefined);
  assert.equal(merged.properties.name, 'Bryson Fire');
  assert.equal(merged.properties.containmentPct, 39);
  assert.equal(merged.properties.incidentSource, 'calfire');
  assert.equal(merged.properties.incidentUrl, 'https://example.test/bryson');
  assert.equal(nameKey('Bryson Fire'), nameKey('BRYSON'));
});

test('mergeIncident leaves a fire alone when the names differ', () => {
  const fire = normalizeWfigsFeature(sampleFires[0], 'fixture');
  assert.ok(fire);
  const other = { name: 'Other', acres: 5, containmentPct: 100, url: 'u', updatedText: null };
  assert.equal(mergeIncident(fire, other), fire);
});

test('dedupeFires keeps the most recently updated perimeter per fire ID', () => {
  const older = normalizeWfigsFeature(sampleFires[0], 'fixture');
  assert.ok(older);
  const newer = {
    ...older,
    properties: { ...older.properties, updated: '2026-10-17T10:00:00.000Z', acres: 200 },
  };
  const result = dedupeFires([older, newer]);
  assert.equal(result.length, 1);
  assert.equal(result[0].properties.acres, 200);
});

test('overrides keep Encinal Canyon Road and Decker Road, and drop expired entries', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  const active = normalizeOverrides(overrides, now);
  assert.deepEqual(active.map((c) => c.properties.road).sort(), ['Decker Road', 'Encinal Canyon Road']);
  assert.ok(active.every((c) => c.properties.status === 'closed'));

  const expired = normalizeOverrides(
    { closures: [{ id: 'old', road: 'Old Road', status: 'closed', geometry: { type: 'Point', coordinates: [0, 0] }, expiresAt: '2026-01-01T00:00:00Z' }] },
    now,
  );
  assert.equal(expired.length, 0);
});

test('overrides skip entries with bad status or geometry', () => {
  const result = normalizeOverrides(
    {
      closures: [
        { id: 'a', road: 'A', status: 'maybe', geometry: { type: 'Point', coordinates: [0, 0] } },
        { id: 'b', road: 'B', status: 'closed', geometry: { type: 'Polygon', coordinates: [] } },
      ],
    },
    0,
  );
  assert.equal(result.length, 0);
});

test('Caltrans-style GeoJSON maps route and status, and skips records without a line or point', () => {
  const features = normalizeCaltransFeatures({
    features: [
      { geometry: { type: 'LineString', coordinates: [[-118.6, 34.1], [-118.7, 34.1]] }, properties: { route: 'PCH', status: 'Closed' } },
      { geometry: null, properties: { route: 'Nowhere' } },
    ],
  });
  assert.equal(features.length, 1);
  assert.equal(features[0].properties.status, 'closed');
  assert.equal(features[0].properties.source, 'Caltrans');
});

test('WFIGS query is fixed: 1=1, envelope around the Santa Monica Mountains box', () => {
  const url = new URL(buildWfigsQueryUrl('https://example.test/FeatureServer/0'));
  assert.equal(url.searchParams.get('where'), '1=1');
  assert.equal(url.searchParams.get('geometry'), '-119.05,33.95,-118.35,34.2');
  assert.equal(url.searchParams.get('f'), 'geojson');
});

test('diffById reports added, updated and removed ids', () => {
  const first = new Map([
    ['a', { id: 'a', v: 1 }],
    ['b', { id: 'b', v: 1 }],
  ]);
  const diff = diffById(first, [
    { id: 'a', v: 2 },
    { id: 'c', v: 1 },
  ]);
  assert.deepEqual(diff.added.map((x) => x.id), ['c']);
  assert.deepEqual(diff.updated.map((x) => x.id), ['a']);
  assert.deepEqual(diff.removed, ['b']);
  assert.equal(diff.current.size, 2);
});

test('live result is served and then cached', async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { ok: true };
  };
  const first = await resolveFeed({ feed: 'wfigs', sourceUrl: 'u', load });
  const second = await resolveFeed({ feed: 'wfigs', sourceUrl: 'u', load });
  assert.equal(first.status.mode, 'live');
  assert.equal(second.status.mode, 'live');
  assert.equal(calls, 1);
});

test('a failed refresh serves the last good result as stale', async () => {
  const t0 = Date.now();
  await resolveFeed({ feed: 'wfigs', sourceUrl: 'u', load: async () => 'good', now: t0 });
  const later = t0 + 10 * 60_000; // past the cache TTL, so a live fetch is attempted
  const result = await resolveFeed({
    feed: 'wfigs',
    sourceUrl: 'u',
    load: async () => {
      throw new Error('HTTP 503 from example.test');
    },
    now: later,
  });
  assert.equal(result.value, 'good');
  assert.equal(result.status.mode, 'stale');
  assert.equal(result.status.error, 'HTTP 503 from example.test');
});

test('with no good result and fixtures on, a failed feed serves the fixture; with fixtures off, it reports an error', async () => {
  const failing = async () => {
    throw new Error('blocked');
  };
  process.env.BACKBONE_FEED_FIXTURES = '1';
  const withFixture = await resolveFeed({ feed: 'wfigs', sourceUrl: 'u', load: failing, fixture: () => 'sample' });
  assert.equal(withFixture.value, 'sample');
  assert.equal(withFixture.status.mode, 'fixture');

  resetFeedState();
  delete process.env.BACKBONE_FEED_FIXTURES;
  const withoutFixture = await resolveFeed({ feed: 'wfigs', sourceUrl: 'u', load: failing, fixture: () => 'sample' });
  assert.equal(withoutFixture.value, null);
  assert.equal(withoutFixture.status.mode, 'error');
});

test('an unconfigured feed reports disabled and no data', async () => {
  const result = await resolveFeed({ feed: 'caltrans', sourceUrl: null, load: null });
  assert.equal(result.status.mode, 'disabled');
  assert.equal(result.value, null);
});

test('cache-control: live is cacheable, stale is short, fixture and error are not cached', () => {
  const status = (mode: 'live' | 'stale' | 'fixture' | 'error') => ({
    feed: 'wfigs' as const,
    mode,
    fetchedAt: null,
    ageSeconds: null,
    sourceUrl: null,
    error: null,
  });
  assert.match(cacheControlFor([status('live')]), /s-maxage=300/);
  assert.match(cacheControlFor([status('stale')]), /s-maxage=60/);
  assert.equal(cacheControlFor([status('fixture')]), 'no-store');
  assert.equal(cacheControlFor([status('error')]), 'no-store');
});
