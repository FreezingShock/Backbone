// Unit tests for speed, turn delay and difficulty rating. No network, no Cesium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_COLORS, difficultyFromScore, difficultyScore, rateDifficulty, rollUpDifficulty } from './difficulty';
import { curveLimitMs, pieceSpeedMs, turnDelayS, MPH_TO_MS, STOP_SIGN_DELAY_S } from './speed';
import { DIFFICULTIES } from './types';

test('bands: 0 easy, 15 intermediate, 30 medium, 45 hard, 60 difficult', () => {
  assert.equal(difficultyFromScore(0), 'easy');
  assert.equal(difficultyFromScore(14.9), 'easy');
  assert.equal(difficultyFromScore(15), 'intermediate');
  assert.equal(difficultyFromScore(30), 'medium');
  assert.equal(difficultyFromScore(45), 'hard');
  assert.equal(difficultyFromScore(60), 'difficult');
  assert.equal(difficultyFromScore(100), 'difficult');
});

test('a straight freeway is easy; a tight narrow unpaved track is difficult', () => {
  assert.equal(rateDifficulty({ curvatureDegPerKm: 0, cls: 'highway', speedMph: 60 }), 'easy');
  assert.equal(rateDifficulty({ curvatureDegPerKm: 600, cls: 'local', speedMph: 10, unpaved: true }), 'difficult');
  assert.ok(difficultyScore({ curvatureDegPerKm: 300, cls: 'crossing', speedMph: 40 }) > difficultyScore({ curvatureDegPerKm: 100, cls: 'crossing', speedMph: 40 }));
});

test('steep grade adds to the score and is capped', () => {
  const flat = difficultyScore({ curvatureDegPerKm: 0, cls: 'arterial', speedMph: 40 });
  const steep = difficultyScore({ curvatureDegPerKm: 0, cls: 'arterial', speedMph: 40, gradePct: 6 });
  assert.equal(steep - flat, 12);
  assert.ok(difficultyScore({ curvatureDegPerKm: 2000, cls: 'local', speedMph: 10, unpaved: true, gradePct: 40 }) <= 100);
});

test('roll-up weights each part by its length', () => {
  const rolled = rollUpDifficulty([
    { meters: 9000, score: 0 },
    { meters: 1000, score: 100 },
  ]);
  assert.ok(Math.abs(rolled.score - 10) < 1e-9);
  assert.equal(rolled.difficulty, 'easy');
  assert.equal(rollUpDifficulty([{ meters: 1, score: 50 }]).difficulty, 'hard');
  assert.equal(rollUpDifficulty([]).difficulty, 'easy');
});

test('every band has a Minecraft-style color', () => {
  assert.deepEqual(Object.keys(DIFFICULTY_COLORS).sort(), [...DIFFICULTIES].sort());
  assert.equal(DIFFICULTY_COLORS.easy, '#55FF55');
  assert.equal(DIFFICULTY_COLORS.difficult, '#AA0000');
});

test('curve limit follows a = v^2 / r, and a straight road has no limit', () => {
  assert.equal(curveLimitMs(0), Infinity);
  // 100 m radius: curvature is 1000 * 180 / (pi * 100) degrees per km.
  const curvature = (1000 * 180) / (Math.PI * 100);
  assert.ok(Math.abs(curveLimitMs(curvature) - Math.sqrt(2 * 100)) < 1e-6);
});

test('piece speed is the cruise speed on straight road and the curve limit on a tight one', () => {
  const cruise = 40 * MPH_TO_MS * 0.9;
  assert.ok(Math.abs(pieceSpeedMs('crossing', 'tertiary', 0) - cruise) < 1e-9);
  assert.ok(pieceSpeedMs('crossing', 'tertiary', 2000) < cruise);
});

test('turn and stop delays are small and ordered', () => {
  assert.equal(turnDelayS(10), 0);
  assert.equal(turnDelayS(90), 2);
  assert.equal(turnDelayS(-170), 4);
  assert.equal(STOP_SIGN_DELAY_S, 6);
});
