import { DIFFICULTY_COLORS, DIFFICULTY_LABELS } from '../routing/difficulty';
import type { Difficulty } from './types';

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'intermediate', 'medium', 'hard', 'difficult'];

/**
 * Chip colors come from the routing engine's Minecraft palette. `ink` is the text color on that fill, picked so
 * each chip reads on both the paper and the navy theme.
 */
export const DIFFICULTY_META: Record<Difficulty, { label: string; color: string; ink: string }> = {
  easy: { label: DIFFICULTY_LABELS.easy, color: DIFFICULTY_COLORS.easy, ink: '#0b2a0b' },
  intermediate: { label: DIFFICULTY_LABELS.intermediate, color: DIFFICULTY_COLORS.intermediate, ink: '#2a2a00' },
  medium: { label: DIFFICULTY_LABELS.medium, color: DIFFICULTY_COLORS.medium, ink: '#2a1a00' },
  hard: { label: DIFFICULTY_LABELS.hard, color: DIFFICULTY_COLORS.hard, ink: '#2a0505' },
  difficult: { label: DIFFICULTY_LABELS.difficult, color: DIFFICULTY_COLORS.difficult, ink: '#ffffff' },
};

export function harder(a: Difficulty, b: Difficulty): Difficulty {
  return DIFFICULTY_ORDER.indexOf(a) >= DIFFICULTY_ORDER.indexOf(b) ? a : b;
}
