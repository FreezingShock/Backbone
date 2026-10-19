// Run from the repo root: npx -y tsx --test src/map/qualityGovernor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOVERNOR, QUALITY_LEVELS, initialGovernor, stepGovernor, type GovernorState } from './qualityGovernor';

/** Feeds `frames` frames of `frameMs` each, one every 16 ms, and returns the state after them. */
function run(state: GovernorState, frameMs: number, frames: number, startMs: number): { state: GovernorState; now: number } {
  let current = state;
  let now = startMs;
  for (let i = 0; i < frames; i++) {
    now += 16;
    current = stepGovernor(current, frameMs, now);
  }
  return { state: current, now };
}

test('starts at full detail', () => {
  assert.equal(initialGovernor().level, 0);
  assert.equal(QUALITY_LEVELS[0].resolutionScale, 1);
});

test('steps down only after slow frames persist', () => {
  const { state } = run(initialGovernor(), 40, Math.ceil(GOVERNOR.slowForMs / 16) - 2, 0);
  assert.equal(state.level, 0, 'a brief slow spell does not lower detail');
  const later = run(state, 40, 10, 10_000).state;
  assert.equal(later.level, 1);
});

test('one hitch in fast frames does not restore detail', () => {
  const lowered = { level: 2, averageMs: 0, slowSince: null, fastSince: null };
  const state = run(lowered, 6, 20, 0).state;
  assert.equal(state.level, 2, 'fast frames need to last fastForMs before a step up');
});

test('restores detail after fast frames persist, one level at a time', () => {
  const start = { level: 2, averageMs: 0, slowSince: null, fastSince: null };
  const after = run(start, 6, Math.ceil(GOVERNOR.fastForMs / 16) + 5, 0);
  assert.equal(after.state.level, 1);
  const again = run(after.state, 6, Math.ceil(GOVERNOR.fastForMs / 16) + 5, after.now);
  assert.equal(again.state.level, 0);
});

test('never goes past the last or first level', () => {
  const bottom = run(initialGovernor(), 80, 1000, 0).state;
  assert.equal(bottom.level, QUALITY_LEVELS.length - 1);
  const top = run(bottom, 2, 1000, 100_000).state;
  assert.equal(top.level, 0);
});

test('middle-band frames change nothing', () => {
  const mid = (GOVERNOR.slowMs + GOVERNOR.fastMs) / 2;
  const state = run({ level: 1, averageMs: 0, slowSince: null, fastSince: null }, mid, 500, 0).state;
  assert.equal(state.level, 1);
});

test('the average restarts after a step, so the new level is judged on its own frames', () => {
  const stepped = stepGovernor({ level: 0, averageMs: 30, slowSince: 0, fastSince: null }, 30, GOVERNOR.slowForMs + 1);
  assert.equal(stepped.level, 1);
  assert.equal(stepped.averageMs, 0);
});
