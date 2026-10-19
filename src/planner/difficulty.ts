import type { Difficulty } from './types';

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'intermediate', 'medium', 'hard', 'difficult'];

/**
 * Minecraft chat colors, as the user chose them: §a, §e, §6, §c, §4. `ink` is the text color on that fill, picked
 * so each chip reads on both the paper and the navy theme. The chip keeps a thin outline for the light theme.
 */
export const DIFFICULTY_META: Record<Difficulty, { label: string; color: string; ink: string }> = {
  easy: { label: 'Easy', color: '#55FF55', ink: '#0b2a0b' },
  intermediate: { label: 'Intermediate', color: '#FFFF55', ink: '#2a2a00' },
  medium: { label: 'Medium', color: '#FFAA00', ink: '#2a1a00' },
  hard: { label: 'Hard', color: '#FF5555', ink: '#2a0505' },
  difficult: { label: 'Difficult', color: '#AA0000', ink: '#ffffff' },
};

export function harder(a: Difficulty, b: Difficulty): Difficulty {
  return DIFFICULTY_ORDER.indexOf(a) >= DIFFICULTY_ORDER.indexOf(b) ? a : b;
}
