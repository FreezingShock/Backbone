import type { LonLat } from './types';

const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LON_AT_EQUATOR = 111320;

/** Ground distance in meters. Equirectangular: accurate to well under 1% across the Santa Monica Mountains. */
export function metersBetween(a: LonLat, b: LonLat): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * METERS_PER_DEG_LON_AT_EQUATOR * Math.cos(midLat);
  const dy = (b[1] - a[1]) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Length of a polyline in meters. */
export function polylineMeters(points: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += metersBetween(points[i - 1], points[i]);
  return total;
}

/** Compass bearing from a to b in degrees, 0 = north, clockwise. */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(midLat);
  const dy = b[1] - a[1];
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Signed turn from one bearing to another, in (-180, 180]. Positive is clockwise, which is a right turn. */
export function turnBetween(fromBearing: number, toBearing: number): number {
  let delta = (toBearing - fromBearing) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/**
 * Total absolute heading change along a polyline, in degrees, ignoring jitter below `noiseDeg`. Vertices in
 * Census TIGER lines wobble by a few degrees, so small turns are dropped before summing.
 */
export function totalTurnDeg(points: LonLat[], noiseDeg = 5): number {
  if (points.length < 3) return 0;
  let total = 0;
  let previous = bearingDeg(points[0], points[1]);
  for (let i = 2; i < points.length; i++) {
    const current = bearingDeg(points[i - 1], points[i]);
    const turn = Math.abs(turnBetween(previous, current));
    if (turn >= noiseDeg) total += turn;
    previous = current;
  }
  return total;
}

/** Curvature in degrees of heading change per kilometer. Zero for a straight or single-segment line. */
export function curvatureDegPerKm(points: LonLat[]): number {
  const meters = polylineMeters(points);
  if (meters <= 0) return 0;
  return totalTurnDeg(points) / (meters / 1000);
}
