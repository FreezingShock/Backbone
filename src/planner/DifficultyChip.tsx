import { DIFFICULTY_META } from './difficulty';
import type { Difficulty } from './types';

/** A difficulty rating on its Minecraft color. The fill is the exact color; the text color keeps it legible. */
export function DifficultyChip({ difficulty, className = '' }: { difficulty: Difficulty; className?: string }) {
  const meta = DIFFICULTY_META[difficulty];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[2px] px-1.5 py-px font-mono text-[10px] tracking-wider whitespace-nowrap uppercase ${className}`}
      style={{ backgroundColor: meta.color, color: meta.ink, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.35)' }}
    >
      {meta.label}
    </span>
  );
}
