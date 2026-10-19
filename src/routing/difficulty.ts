import type { Difficulty, RoadClass } from './types';
import { DIFFICULTIES } from './types';

/**
 * Colors use Minecraft's chat text colors, from mildest to worst: green, yellow, gold, red, dark red.
 * They are shown as dots, chips and route tints, so the names carry the meaning too.
 */
export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy: '#55FF55',
  intermediate: '#FFFF55',
  medium: '#FFAA00',
  hard: '#FF5555',
  difficult: '#AA0000',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  intermediate: 'Intermediate',
  medium: 'Medium',
  hard: 'Hard',
  difficult: 'Difficult',
};

/** Lower bound of each band on the 0 to 100 score. Easy starts at 0. */
const BAND_FLOOR: [number, Difficulty][] = [
  [60, 'difficult'],
  [45, 'hard'],
  [30, 'medium'],
  [15, 'intermediate'],
  [0, 'easy'],
];

export interface DifficultyInput {
  /** Curvature in degrees of heading change per km (see curvatureDegPerKm). */
  curvatureDegPerKm: number;
  cls: RoadClass;
  /** Posted or estimated speed, used as a proxy for road width. */
  speedMph: number;
  /** Unpaved or track surfaces add to the score. */
  unpaved?: boolean;
  /** Percent grade, absolute value. Elevation is not in the graph yet, so callers pass 0 or leave it out. */
  gradePct?: number;
}

const CLASS_POINTS: Record<RoadClass, number> = {
  highway: 0,
  arterial: 5,
  collector: 8,
  crossing: 12,
  local: 6,
};

/**
 * Scores one road piece from 0 (a straight freeway) to 100 (a tight, narrow, steep unpaved track). Components:
 * curvature up to 50 (10 points per 100 degrees per km), road class up to 12, narrow road up to 8, unpaved 15,
 * grade up to 20 (2 points per percent). Grade is zero until the graph carries elevation.
 */
export function difficultyScore(input: DifficultyInput): number {
  const curve = Math.min(50, input.curvatureDegPerKm / 10);
  const narrow = input.speedMph <= 25 ? 8 : 0;
  const unpaved = input.unpaved ? 15 : 0;
  const grade = Math.min(20, Math.abs(input.gradePct ?? 0) * 2);
  return Math.min(100, curve + CLASS_POINTS[input.cls] + narrow + unpaved + grade);
}

export function difficultyFromScore(score: number): Difficulty {
  for (const [floor, band] of BAND_FLOOR) if (score >= floor) return band;
  return 'easy';
}

export function rateDifficulty(input: DifficultyInput): Difficulty {
  return difficultyFromScore(difficultyScore(input));
}

/** Length-weighted mean score over parts, rolled up to one band. Empty input is easy. */
export function rollUpDifficulty(parts: { meters: number; score: number }[]): { score: number; difficulty: Difficulty } {
  let meters = 0;
  let weighted = 0;
  for (const part of parts) {
    meters += part.meters;
    weighted += part.meters * part.score;
  }
  const score = meters > 0 ? weighted / meters : 0;
  return { score, difficulty: difficultyFromScore(score) };
}

export function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}
