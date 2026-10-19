// Road difficulty, five steps, with Minecraft's chat colors. Playback and the planner both read this table.
import type { Difficulty } from './routeTypes';

export interface DifficultyStyle {
  label: string;
  /** Badge fill. */
  fill: string;
  /** Text on the badge. */
  ink: string;
}

export const DIFFICULTY_STYLE: Record<Difficulty, DifficultyStyle> = {
  easy: { label: 'Easy', fill: '#55ff55', ink: '#0a2a0a' },
  intermediate: { label: 'Intermediate', fill: '#55ffff', ink: '#062a2a' },
  medium: { label: 'Medium', fill: '#ffff55', ink: '#2a2a06' },
  hard: { label: 'Hard', fill: '#ffaa00', ink: '#2a1a00' },
  difficult: { label: 'Difficult', fill: '#aa0000', ink: '#ffffff' },
};
