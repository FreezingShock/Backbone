// Run from the repo root: npx -y tsx --test src/map/scaleMath.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLength, niceLength } from './scaleMath';

test('niceLength picks a round length that fits the target width', () => {
  // 10 m per pixel: 110 px is 1,100 m, so the bar is 1 km.
  assert.deepEqual(niceLength(10, 110), { meters: 1000, px: 100 });
  // 1 m per pixel: 110 px is 110 m, so the bar is 100 m.
  assert.deepEqual(niceLength(1, 110), { meters: 100, px: 100 });
  // 0.5 m per pixel: 110 px is 55 m, so the bar is 50 m.
  assert.deepEqual(niceLength(0.5, 110), { meters: 50, px: 100 });
});

test('niceLength never exceeds the target length', () => {
  for (const mpp of [0.2, 3, 47, 999, 12345]) {
    const { meters, px } = niceLength(mpp, 110);
    assert.ok(px <= 110 + 1e-9, `px ${px} for ${mpp} m/px`);
    assert.ok(meters > 0);
  }
});

test('formatLength switches to km at 1,000 m', () => {
  assert.equal(formatLength(500), '500 m');
  assert.equal(formatLength(2000), '2 km');
  assert.equal(formatLength(2500), '2.5 km');
  assert.equal(formatLength(20000), '20 km');
});
