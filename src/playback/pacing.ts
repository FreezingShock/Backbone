// How fast a route plays, and how long the opening shot runs. Pure, no Cesium import.

export const PLAYBACK_SPEEDS = [
  { id: 'cinematic', label: 'Cinematic' },
  { id: 1, label: '1×' },
  { id: 2, label: '2×' },
  { id: 4, label: '4×' },
] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]['id'];

/** Cinematic plays any route through in about this many real seconds. */
export const CINEMATIC_SECONDS = 30;
/** Fixed speeds: route seconds that pass per real second. 1× is one minute of route per second of screen. */
export const ROUTE_SECONDS_PER_REAL_SECOND = 60;

/** Route time per real second for a speed setting. A 30-minute route at 1× takes 30 real seconds. */
export function routeSecondsPerSecond(speed: PlaybackSpeed, routeDurationS: number): number {
  if (speed === 'cinematic') return Math.max(routeDurationS, 1) / CINEMATIC_SECONDS;
  return speed * ROUTE_SECONDS_PER_REAL_SECOND;
}

/**
 * Opening shot, in real seconds: pull back to show the whole route, fly in behind the start, then settle into the
 * follow camera. Every move ends at the start, so the opening never flies back across the route.
 */
export const INTRO = {
  overviewS: 2.2,
  approachS: 2.6,
  settleS: 2.2,
} as const;

export const INTRO_TOTAL_S = INTRO.overviewS + INTRO.approachS + INTRO.settleS;

/** Smooth start and stop for the intro moves. */
export function smoothstep(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}
