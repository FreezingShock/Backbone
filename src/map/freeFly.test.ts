// Run from the repo root: npx -y tsx --test src/map/freeFly.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREEFLY, freeFlySpeed } from './freeFly';

test('speed grows with height above ground, between the floor and the cap', () => {
  assert.equal(freeFlySpeed(0, false), FREEFLY.minSpeed);
  assert.equal(freeFlySpeed(1000, false), 600);
  assert.equal(freeFlySpeed(1_000_000, false), FREEFLY.maxSpeed);
});

test('boost multiplies the clamped speed', () => {
  assert.equal(freeFlySpeed(1000, true), 600 * FREEFLY.boost);
  assert.equal(freeFlySpeed(0, true), FREEFLY.minSpeed * FREEFLY.boost);
});

test('free-fly is faster than the previous tuning at every height', () => {
  // Previous tuning: 0.3 m/s per meter, floor 150, cap 6000, boost 3.
  const previous = (altitude: number, boosted: boolean) => {
    const base = Math.min(Math.max(altitude * 0.3, 150), 6000);
    return boosted ? base * 3 : base;
  };
  for (const altitude of [0, 100, 500, 1000, 5000, 50_000]) {
    assert.ok(freeFlySpeed(altitude, false) >= previous(altitude, false), `walk at ${altitude} m`);
    assert.ok(freeFlySpeed(altitude, true) >= previous(altitude, true), `boost at ${altitude} m`);
  }
});
