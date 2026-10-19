// Sun for the light theme. Cesium lights the globe and draws the sky from the clock's time, so the light
// theme sets a fixed mid-day time and the dark theme puts back the time the viewer started with (its night look).
import * as Cesium from 'cesium';

/** Mid-day in Topanga (about 12:00 PDT) on a fixed date, so the light theme looks the same every visit. */
export const DAYLIGHT_TIME_ISO = '2026-10-19T19:00:00Z';

/** The slice of a Cesium viewer that applyDaylight changes. Typed loosely so it can be tested without WebGL. */
export interface DaylightTarget {
  clock: { currentTime: Cesium.JulianDate };
  scene: {
    skyAtmosphere?: { show: boolean };
    globe: { showGroundAtmosphere: boolean };
  };
}

/**
 * Daytime sun and sky when `day` is true; otherwise the clock goes back to `startTime` and the sky and ground
 * atmosphere go off, which is the night look the dark theme has always had. Call requestRender after this.
 */
export function applyDaylight(viewer: DaylightTarget, day: boolean, startTime: Cesium.JulianDate): void {
  const time = day ? Cesium.JulianDate.fromIso8601(DAYLIGHT_TIME_ISO) : Cesium.JulianDate.clone(startTime);
  viewer.clock.currentTime = time;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = day;
  viewer.scene.globe.showGroundAtmosphere = day;
}
