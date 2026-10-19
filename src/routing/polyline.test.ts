// Unit tests for the encoded polyline codec and the geometry helpers. No network, no Cesium.
// Run from the repo root: npx -y tsx --test src/routing/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, encodePolyline } from './polyline';
import { bearingDeg, turnBetween, totalTurnDeg } from './geo';
import type { LonLat } from './types';

test('encodes the documented Google example at precision 5', () => {
  // Google's encoded polyline reference example, (lat, lon) order there, so swap to [lon, lat] here.
  const points: LonLat[] = [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ];
  assert.equal(encodePolyline(points), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});

test('round-trips coordinates to within 1e-5 degrees', () => {
  const points: LonLat[] = [
    [-118.63728, 34.16101],
    [-118.6374, 34.16117],
    [-118.5, 34.2],
    [-118.7001, 34.0501],
  ];
  const back = decodePolyline(encodePolyline(points));
  assert.equal(back.length, points.length);
  back.forEach((point, i) => {
    assert.ok(Math.abs(point[0] - points[i][0]) < 1e-5);
    assert.ok(Math.abs(point[1] - points[i][1]) < 1e-5);
  });
});

test('turn angles are signed: clockwise is positive, and wrap around north', () => {
  assert.equal(turnBetween(0, 90), 90); // north to east is a right turn
  assert.equal(turnBetween(90, 0), -90);
  assert.equal(turnBetween(350, 10), 20);
  assert.equal(turnBetween(10, 350), -20);
});

test('bearing points north for a northward move and east for an eastward one', () => {
  assert.ok(Math.abs(bearingDeg([-118.6, 34.1], [-118.6, 34.2]) - 0) < 0.01);
  assert.ok(Math.abs(bearingDeg([-118.6, 34.1], [-118.5, 34.1]) - 90) < 0.5);
});

test('total turn ignores jitter under the noise threshold', () => {
  // A straight line with 2-degree wobbles adds nothing; one real 90-degree corner adds 90.
  // About 0.2 m of sideways wobble on 11 m steps: well under 5 degrees per vertex.
  const wobble: LonLat[] = [
    [0, 0],
    [0.0001, 0.0000015],
    [0.0002, -0.0000015],
    [0.0003, 0.0000015],
  ];
  assert.equal(totalTurnDeg(wobble), 0);
  const corner: LonLat[] = [
    [0, 0],
    [0, 0.01],
    [0.01, 0.01],
  ];
  assert.ok(Math.abs(totalTurnDeg(corner) - 90) < 0.5);
});
