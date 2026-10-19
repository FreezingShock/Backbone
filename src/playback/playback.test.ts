// Unit tests for route playback: track math, pacing, camera framing, maneuver derivation and formatting.
// No Cesium and no DOM. Run from the repo root: npx -y tsx --test src/playback/playback.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glyphSvg, isArrowKind, stepRotation } from './icons';
import { DIFFICULTY_STYLE } from './difficulty';
import { formatClockTime, formatDistance, formatDuration } from './format';
import { INTRO_TOTAL_S, PLAYBACK_SPEEDS, routeSecondsPerSecond } from './pacing';
import { chasePose, extentMeters, FRAME, orbitPose, overviewPose } from './poses';
import type { Leg, LonLat, Route, Step, Stop } from './routeTypes';
import {
  buildTrack,
  currentStepIndex,
  distanceAtSeconds,
  distanceOfPoint,
  lerpAngle,
  metersBetween,
  placeSteps,
  sampleAtDistance,
  slice,
  wrapAngle,
  type TrackSample,
} from './track';

const EPS = 1e-6;
const near = (actual: number, expected: number, tolerance = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

const stop = (name: string, lon: number, lat: number): Stop => ({ id: name, name, kind: 'city', lon, lat });

/** Two legs that share a join point at (-118.5, 34.2). Leg one runs east, leg two runs north. */
function twoLegRoute(): Route {
  const join: LonLat = [-118.5, 34.2];
  const legA: LonLat[] = [
    [-118.52, 34.2],
    [-118.51, 34.2],
    join,
  ];
  const legB: LonLat[] = [
    join,
    [-118.5, 34.21],
    [-118.5, 34.22],
  ];
  const legs: Leg[] = [
    {
      from: stop('A', -118.52, 34.2),
      to: stop('B', join[0], join[1]),
      distanceM: 0,
      durationS: 120,
      difficulty: 'easy',
      geometry: legA,
      steps: [],
    },
    {
      from: stop('B', join[0], join[1]),
      to: stop('C', -118.5, 34.22),
      distanceM: 0,
      durationS: 300,
      difficulty: 'hard',
      geometry: legB,
      steps: [],
    },
  ];
  return {
    stops: [legs[0].from, legs[0].to, legs[1].to],
    legs,
    distanceM: 0,
    durationS: 420,
    difficulty: 'medium',
    geometry: [],
    departAt: '2026-10-19T00:00:00.000Z',
    arriveAt: '2026-10-19T00:07:00.000Z',
    warnings: [],
  };
}

test('track joins legs once and keeps total time equal to the route duration', () => {
  const track = buildTrack(twoLegRoute());
  // 5 points: the shared join is kept once.
  assert.equal(track.points.length, 5);
  assert.equal(track.totalS, 420);
  assert.ok(track.totalM > 0);
  near(track.cumS[track.cumS.length - 1], 420);
  // The join point is exactly where leg one's time ends.
  const joinIndex = track.points.findIndex(([lon, lat]) => lon === -118.5 && lat === 34.2);
  near(track.cumS[joinIndex], 120, 1e-6);
});

test('sampling by distance interpolates position and reports the segment heading', () => {
  const track = buildTrack(twoLegRoute());
  const out: TrackSample = { lon: 0, lat: 0, heading: 0, seconds: 0 };
  // Start of leg one: heading east is pi/2 clockwise from north.
  sampleAtDistance(track, 0, out);
  near(out.lon, -118.52, EPS);
  near(out.heading, Math.PI / 2, 1e-3);
  // Past the end clamps to the last point.
  sampleAtDistance(track, track.totalM * 10, out);
  near(out.lat, 34.22, EPS);
  // Leg two heads north.
  sampleAtDistance(track, track.totalM - 1, out);
  near(out.heading, 0, 1e-3);
});

test('route time and distance map back and forth', () => {
  const track = buildTrack(twoLegRoute());
  const m = distanceAtSeconds(track, 60);
  assert.ok(m > 0 && m < track.totalM);
  near(distanceAtSeconds(track, 0), 0, EPS);
  near(distanceAtSeconds(track, 420), track.totalM, 1e-6);
  // The route time at the join is 120 s, and that is the distance of the join point.
  const joinM = distanceAtSeconds(track, 120);
  near(distanceOfPoint(track, -118.5, 34.2), joinM, 0.5);
});

test('nearest point on the track gives the distance along it', () => {
  const track = buildTrack(twoLegRoute());
  const middleOfLegOne: LonLat = [-118.51, 34.2];
  near(distanceOfPoint(track, middleOfLegOne[0], middleOfLegOne[1]), metersBetween([-118.52, 34.2], [-118.51, 34.2]), 1);
});

test('steps are placed in travel order and the current step follows the marker', () => {
  const track = buildTrack(twoLegRoute());
  const steps: Step[] = [
    { kind: 'turn-right', roadName: 'North', lon: -118.5, lat: 34.21, distanceM: 0, durationS: 0, instruction: 'b' },
    { kind: 'depart', roadName: 'East', lon: -118.52, lat: 34.2, distanceM: 0, durationS: 0, instruction: 'a' },
  ];
  const placed = placeSteps(track, steps);
  assert.equal(placed[0].step.kind, 'depart');
  assert.equal(placed[1].step.kind, 'turn-right');
  assert.equal(currentStepIndex(placed, -1), -1);
  assert.equal(currentStepIndex(placed, placed[0].meters), 0);
  assert.equal(currentStepIndex(placed, track.totalM), 1);
});

test('highlight slice covers the requested stretch with interpolated ends', () => {
  const track = buildTrack(twoLegRoute());
  const half = slice(track, 0, track.totalM / 2);
  assert.ok(half.length >= 2);
  near(half[0][0], -118.52, EPS);
  assert.deepEqual(slice(track, 10, 5), []);
});

test('angles wrap to the short way around', () => {
  near(wrapAngle(Math.PI + 0.1), -Math.PI + 0.1, 1e-9);
  near(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5), Math.PI, 1e-9);
  near(lerpAngle(0, 1, 0.25), 0.25, 1e-9);
});

test('pacing: cinematic plays the whole route in its fixed time, fixed speeds are route minutes per second', () => {
  near(routeSecondsPerSecond('cinematic', 3600), 120, 1e-9);
  near(routeSecondsPerSecond(1, 3600), 60, 1e-9);
  near(routeSecondsPerSecond(4, 3600), 240, 1e-9);
  assert.deepEqual(
    PLAYBACK_SPEEDS.map((s) => s.id),
    ['cinematic', 1, 2, 4],
  );
  assert.ok(INTRO_TOTAL_S > 0);
});

test('chase camera sits behind the marker and above it', () => {
  // Heading east: behind is west, so longitude is smaller than the marker's.
  const pose = chasePose(-118.5, 34.2, 100, Math.PI / 2);
  assert.ok(pose.lon < -118.5);
  near(pose.lat, 34.2, 1e-9);
  near(pose.height, 100 + FRAME.chaseUp, EPS);
  near(pose.pitch, FRAME.chasePitch, EPS);
  // Heading north: behind is south.
  const north = chasePose(-118.5, 34.2, 100, 0);
  assert.ok(north.lat < 34.2);
});

test('orbit camera stays at its range from the marker and looks at it', () => {
  const pose = orbitPose(-118.5, 34.2, 50, 1.1);
  const lookedAt = { lon: -118.5, lat: 34.2 };
  // Recover the horizontal distance to the marker in meters.
  const dx = (lookedAt.lon - pose.lon) * 111320 * Math.cos((34.2 * Math.PI) / 180);
  const dy = (lookedAt.lat - pose.lat) * 110540;
  near(Math.hypot(dx, dy), FRAME.orbitRange * Math.cos(FRAME.orbitPitch), 0.5);
  near(pose.heading, 1.1, EPS);
  assert.ok(pose.pitch < 0);
});

test('overview frames the whole route with a minimum range', () => {
  const extent = extentMeters(-118.6, -118.5, 34.1, 34.2);
  assert.ok(extent > 10000);
  const pose = overviewPose(-118.55, 34.15, 0, extent, 0);
  assert.ok(pose.height > 0);
  const tiny = overviewPose(0, 0, 0, 10, 0);
  assert.ok(tiny.height > 0);
});

test('step glyphs: arrows rotate and the stop sign is labeled', () => {
  assert.equal(stepRotation('turn-left'), -90);
  assert.equal(stepRotation('u-turn'), 180);
  assert.equal(isArrowKind('stop-sign'), false);
  assert.ok(glyphSvg('stop-sign', '#000', '#f00', '#fff').includes('STOP'));
  assert.ok(glyphSvg('turn-right', '#000', '#f00', '#fff').includes('rotate(90 12 12)'));
});

test('every difficulty has a color and a label', () => {
  const levels = ['easy', 'intermediate', 'medium', 'hard', 'difficult'] as const;
  for (const level of levels) {
    assert.match(DIFFICULTY_STYLE[level].fill, /^#[0-9a-f]{6}$/);
    assert.ok(DIFFICULTY_STYLE[level].label.length > 0);
  }
});

test('formatting: distances in feet then miles, durations, and playback clock', () => {
  assert.equal(formatDistance(100), '330 ft');
  assert.equal(formatDistance(3218.7), '2.0 mi');
  assert.equal(formatDistance(20000), '12 mi');
  assert.equal(formatDuration(10), '<1 min');
  assert.equal(formatDuration(30), '1 min');
  assert.equal(formatDuration(38 * 60), '38 min');
  assert.equal(formatDuration(64 * 60), '1 h 4 min');
  assert.equal(formatDuration(2 * 3600), '2 h');
  assert.equal(formatClockTime(65), '1:05');
  assert.equal(formatClockTime(3725), '1:02:05');
});
