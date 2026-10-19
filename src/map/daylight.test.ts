// Run from the repo root: npx -y tsx --test src/map/daylight.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { applyDaylight, DAYLIGHT_TIME_ISO, type DaylightTarget } from './daylight';

function fakeViewer(): DaylightTarget & { clock: { currentTime: Cesium.JulianDate } } {
  return {
    clock: { currentTime: Cesium.JulianDate.fromIso8601('2026-01-05T06:00:00Z') },
    scene: { skyAtmosphere: { show: false }, globe: { showGroundAtmosphere: false } },
  };
}

test('light theme sets the sun to the daytime time, with sky and ground atmosphere on', () => {
  const viewer = fakeViewer();
  const night = Cesium.JulianDate.clone(viewer.clock.currentTime);
  applyDaylight(viewer, true, night);
  assert.equal(Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 0), '2026-10-19T19:00:00Z');
  assert.equal(DAYLIGHT_TIME_ISO, '2026-10-19T19:00:00Z');
  assert.equal(viewer.scene.skyAtmosphere?.show, true);
  assert.equal(viewer.scene.globe.showGroundAtmosphere, true);
});

test('dark theme puts back the starting time and turns the atmosphere off', () => {
  const viewer = fakeViewer();
  const start = Cesium.JulianDate.clone(viewer.clock.currentTime);
  applyDaylight(viewer, true, start);
  applyDaylight(viewer, false, start);
  assert.equal(Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 0), '2026-01-05T06:00:00Z');
  assert.equal(viewer.scene.skyAtmosphere?.show, false);
  assert.equal(viewer.scene.globe.showGroundAtmosphere, false);
});

test('the start time is copied, so later changes to the clock do not alter it', () => {
  const viewer = fakeViewer();
  const start = Cesium.JulianDate.clone(viewer.clock.currentTime);
  applyDaylight(viewer, true, start);
  viewer.clock.currentTime.dayNumber += 1;
  applyDaylight(viewer, false, start);
  assert.equal(Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 0), '2026-01-05T06:00:00Z');
});
