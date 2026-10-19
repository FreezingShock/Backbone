// Frame-time governor for globe detail. Pure: feed it frame costs and the time, get back the quality level to use.
// Level 0 is full detail. Each later level trades a little globe detail and canvas resolution for frame time.

export interface QualityLevel {
  /** Globe maximumScreenSpaceError while the camera is still. Higher means fewer tiles. */
  screenSpaceError: number;
  /** Canvas resolution multiplier while the camera is still. Multiplies the browser's pixel ratio. */
  resolutionScale: number;
}

/** Tune here. Level 0 matches the detail the map has always had. */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { screenSpaceError: 2, resolutionScale: 1 },
  { screenSpaceError: 2.5, resolutionScale: 0.85 },
  { screenSpaceError: 3, resolutionScale: 0.7 },
];

export const GOVERNOR = {
  /** Smoothed frame cost above this (ms) steps detail down. 22 ms is about 45 fps. */
  slowMs: 22,
  /** Smoothed frame cost below this (ms) steps detail back up. 12 ms is about 80 fps. */
  fastMs: 12,
  /** The frame cost must stay slow this long before a step down. Stops one hitch from lowering detail. */
  slowForMs: 1500,
  /** The frame cost must stay fast this long before a step up. Slower than stepping down, so it does not flap. */
  fastForMs: 4000,
  /** Weight of each new frame in the running average. */
  smoothing: 0.1,
} as const;

export interface GovernorState {
  level: number;
  /** Running average of frame cost in ms. 0 means no frame has been measured since the last step. */
  averageMs: number;
  /** When the frame cost first went slow (or fast) in a row, in ms. Null when it is in the middle band. */
  slowSince: number | null;
  fastSince: number | null;
}

export function initialGovernor(): GovernorState {
  return { level: 0, averageMs: 0, slowSince: null, fastSince: null };
}

/**
 * One frame. `frameMs` is how long the frame took to build and draw, `now` is a clock in ms (performance.now()).
 * After a step the average restarts, so the next level is judged on its own frames.
 */
export function stepGovernor(state: GovernorState, frameMs: number, now: number): GovernorState {
  const averageMs =
    state.averageMs === 0 ? frameMs : state.averageMs + (frameMs - state.averageMs) * GOVERNOR.smoothing;
  const lastLevel = QUALITY_LEVELS.length - 1;

  if (averageMs > GOVERNOR.slowMs) {
    const slowSince = state.slowSince ?? now;
    if (now - slowSince >= GOVERNOR.slowForMs && state.level < lastLevel) {
      return { level: state.level + 1, averageMs: 0, slowSince: null, fastSince: null };
    }
    return { level: state.level, averageMs, slowSince, fastSince: null };
  }

  if (averageMs < GOVERNOR.fastMs) {
    const fastSince = state.fastSince ?? now;
    if (now - fastSince >= GOVERNOR.fastForMs && state.level > 0) {
      return { level: state.level - 1, averageMs: 0, slowSince: null, fastSince: null };
    }
    return { level: state.level, averageMs, slowSince: null, fastSince };
  }

  return { level: state.level, averageMs, slowSince: null, fastSince: null };
}
