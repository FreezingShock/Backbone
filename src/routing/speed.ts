import type { ControlKind, RoadClass } from './types';

/**
 * Speed model for ETA. There are no posted speed limits in the graph yet (TIGER has none, and Overpass was
 * unreachable when this was written), so these are estimates by road class. Each one is named here so it can
 * be replaced by posted limits later without touching the search.
 */
export const MPH_TO_MS = 0.44704;

/** Free-flow speed by class, in mph. Estimates, not posted limits. */
const CLASS_SPEED_MPH: Record<RoadClass, number> = {
  highway: 60,
  arterial: 40,
  crossing: 40,
  collector: 30,
  local: 25,
};

/** Overrides for the highway tag that TIGER carries (motorway_link is a freeway on-ramp). */
const HIGHWAY_SPEED_MPH: Record<string, number> = {
  motorway_link: 35,
  primary: 60,
  secondary: 50,
  residential: 25,
  service: 15,
  track: 10,
};

/** Drivers do not hold the limit through every curve, junction and slow vehicle. */
export const CRUISE_FACTOR = 0.9;

/** Comfortable sideways acceleration on a curve, in m/s². About 0.2 g. */
export const LATERAL_ACCEL_MS2 = 2.0;

/** Fastest speed the search can assume, for the A* heuristic. The freeway estimate, in m/s. */
export const MAX_SPEED_MS = 65 * MPH_TO_MS;

/** Average time lost at a stop sign: slowing, the full stop, and pulling away. Estimate. */
export const STOP_SIGN_DELAY_S = 6;

/** Average wait at a traffic signal when it is not known to be green. Estimate, not measured. */
export const TRAFFIC_SIGNAL_DELAY_S = 20;

export function classSpeedMph(cls: RoadClass, highway: string): number {
  return HIGHWAY_SPEED_MPH[highway] ?? CLASS_SPEED_MPH[cls];
}

/** Speed the curve allows, in m/s, for a given curvature in degrees per km. Infinity when straight. */
export function curveLimitMs(curvatureDegPerKm: number): number {
  if (curvatureDegPerKm <= 0) return Infinity;
  const radiusM = (1000 * 180) / (Math.PI * curvatureDegPerKm);
  return Math.sqrt(LATERAL_ACCEL_MS2 * radiusM);
}

/** Speed used to time a piece of road, in m/s: the cruise speed, capped by what the curve allows. */
export function pieceSpeedMs(cls: RoadClass, highway: string, curvatureDegPerKm: number): number {
  const cruise = classSpeedMph(cls, highway) * MPH_TO_MS * CRUISE_FACTOR;
  return Math.min(cruise, curveLimitMs(curvatureDegPerKm));
}

/**
 * Extra seconds for a change of heading at a junction: the slowdown for a turn. Straight through costs nothing.
 * Sizes are estimates: under 45° is free, under 120° costs 2 s, and a hairpin costs 4 s.
 */
export function turnDelayS(turnDeg: number): number {
  const size = Math.abs(turnDeg);
  if (size < 45) return 0;
  if (size < 120) return 2;
  return 4;
}

export function controlDelayS(kind: ControlKind): number {
  return kind === 'stop-sign' ? STOP_SIGN_DELAY_S : TRAFFIC_SIGNAL_DELAY_S;
}
