// Run from the repo root: npx -y tsx --test src/layers/declutter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declutter, type LabelBox } from './declutter';

const box = (left: number, top: number, width: number, priority: number, height = 10): LabelBox => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  priority,
});

test('keeps boxes that do not overlap', () => {
  assert.deepEqual(declutter([box(0, 0, 50, 1), box(100, 0, 50, 1)]), [true, true]);
});

test('drops the lower-priority box when two overlap', () => {
  // The town (priority 1) comes first in the list, but the city (priority 0) wins the spot.
  const town = box(0, 0, 50, 1);
  const city = box(20, 0, 50, 0);
  assert.deepEqual(declutter([town, city]), [false, true]);
});

test('keeps input order for equal priorities', () => {
  assert.deepEqual(declutter([box(0, 0, 50, 2), box(20, 0, 50, 2)]), [true, false]);
});

test('padding pushes near-touching boxes apart', () => {
  const a = box(0, 0, 50, 1);
  const b = box(52, 0, 50, 1);
  assert.deepEqual(declutter([a, b], 0), [true, true]);
  assert.deepEqual(declutter([a, b], 4), [true, false]);
});

test('null entries are never shown and never block others', () => {
  assert.deepEqual(declutter([null, box(0, 0, 50, 1), null]), [false, true, false]);
});

test('vertical separation is enough to avoid overlap', () => {
  assert.deepEqual(declutter([box(0, 0, 50, 1), box(0, 30, 50, 1)]), [true, true]);
});
