// Camera poses for playback, as plain numbers. Pure math, no Cesium import, so the framing is testable in node.
// A pose is a point on the ellipsoid, a height in meters, and a heading and pitch in radians.
import { lerpAngle } from './track';

export interface Pose {
  lon: number;
  lat: number;
  /** Meters above the ellipsoid. The controller raises this above the ground before it applies the pose. */
  height: number;
  heading: number;
  pitch: number;
}

const LAT_M = 110540;
const LON_M = 111320;

/** Framing constants. Meters and radians. Tune here. */
export const FRAME = {
  /** Orbit follow: distance from the marker, and the look-down angle. */
  orbitRange: 260,
  orbitPitch: -0.5,
  /** Orbit circles the marker this many radians per real second while playing. */
  orbitRate: 0.2,
  /** Free-fly follow: how far behind and how high above the marker the camera sits. */
  chaseBack: 95,
  chaseUp: 38,
  chasePitch: -0.28,
  /** Sweep during the intro: a higher, wider chase shot that moves down the whole route. */
  sweepBack: 420,
  sweepUp: 360,
  sweepPitch: -0.62,
  /** Overview: slant range as a multiple of the route's extent, and the look-down angle. */
  overviewScale: 0.95,
  overviewMinRange: 900,
  overviewPitch: -0.95,
  /** Camera stays this far above the ground, in meters. */
  clearance: 18,
} as const;

/** Meters to degrees at a latitude. */
export function degreesPerMeter(lat: number): { lon: number; lat: number } {
  return { lon: 1 / (LON_M * Math.cos((lat * Math.PI) / 180)), lat: 1 / LAT_M };
}

/** A point `back` meters behind a heading (negative `back` is ahead) and `up` meters above it. */
export function behind(lon: number, lat: number, height: number, heading: number, back: number, up: number): Pose {
  const per = degreesPerMeter(lat);
  // Heading is clockwise from north, so the unit vector is (east, north) = (sin, cos).
  return {
    lon: lon - Math.sin(heading) * back * per.lon,
    lat: lat - Math.cos(heading) * back * per.lat,
    height: height + up,
    heading,
    pitch: 0,
  };
}

/** Orbit follow: the camera sits on a circle around the marker at `heading` and looks back at it. */
export function orbitPose(lon: number, lat: number, groundHeight: number, orbitHeading: number): Pose {
  const back = FRAME.orbitRange * Math.cos(FRAME.orbitPitch);
  const up = FRAME.orbitRange * -Math.sin(FRAME.orbitPitch);
  const pose = behind(lon, lat, groundHeight, orbitHeading, back, up);
  pose.heading = orbitHeading;
  pose.pitch = FRAME.orbitPitch;
  return pose;
}

/** Free-fly follow: a chase camera behind the marker, looking down the road ahead. */
export function chasePose(lon: number, lat: number, groundHeight: number, heading: number): Pose {
  const pose = behind(lon, lat, groundHeight, heading, FRAME.chaseBack, FRAME.chaseUp);
  pose.pitch = FRAME.chasePitch;
  return pose;
}

/** Intro sweep: the same chase idea, higher and wider, so the shot reads as a fly-over. */
export function sweepPose(lon: number, lat: number, groundHeight: number, heading: number): Pose {
  const pose = behind(lon, lat, groundHeight, heading, FRAME.sweepBack, FRAME.sweepUp);
  pose.pitch = FRAME.sweepPitch;
  return pose;
}

/** Overview: a slanted view that centers the whole route. `extentM` is the larger side of its bounding box. */
export function overviewPose(
  centerLon: number,
  centerLat: number,
  groundHeight: number,
  extentM: number,
  heading: number,
): Pose {
  const range = Math.max(FRAME.overviewMinRange, extentM * FRAME.overviewScale);
  const horizontal = range * Math.cos(FRAME.overviewPitch);
  const up = range * -Math.sin(FRAME.overviewPitch);
  const pose = behind(centerLon, centerLat, groundHeight, heading, horizontal, up);
  pose.heading = heading;
  pose.pitch = FRAME.overviewPitch;
  return pose;
}

/** Blends two poses. Position and height are linear, heading takes the short way around. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return {
    lon: a.lon + (b.lon - a.lon) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    height: a.height + (b.height - a.height) * t,
    heading: lerpAngle(a.heading, b.heading, t),
    pitch: a.pitch + (b.pitch - a.pitch) * t,
  };
}

/** Largest span of a bounding box, in meters. */
export function extentMeters(minLon: number, maxLon: number, minLat: number, maxLat: number): number {
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  return Math.max((maxLon - minLon) * LON_M * Math.cos(midLat), (maxLat - minLat) * LAT_M);
}
