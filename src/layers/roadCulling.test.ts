// Run from the repo root: npx -y tsx --test src/layers/roadCulling.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawsAtAltitude } from './roads';

test('arterials, crossings and highways draw at any height', () => {
  for (const cls of ['arterial', 'crossing', 'highway'] as const) {
    assert.equal(drawsAtAltitude(cls, 5_000_000, false), true, cls);
  }
});

test('local streets hide above their limit and show again below it', () => {
  assert.equal(drawsAtAltitude('local', 30_000, false), true);
  assert.equal(drawsAtAltitude('local', 46_000, false), false);
  assert.equal(drawsAtAltitude('local', 43_000, true), false, 'inside the band, a hidden set stays hidden');
  assert.equal(drawsAtAltitude('local', 39_000, true), true);
});

test('collectors use their own, higher limit', () => {
  assert.equal(drawsAtAltitude('collector', 60_000, false), true);
  assert.equal(drawsAtAltitude('collector', 95_000, false), false);
});
