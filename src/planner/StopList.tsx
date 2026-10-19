import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatDistance, formatDuration, stopLetter } from './format';
import { DifficultyChip } from './DifficultyChip';
import type { Leg, Stop } from './types';

export interface StopListProps {
  stops: Stop[];
  /** Legs between consecutive stops, when the route is planned. */
  legs: Leg[] | null;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

const KIND_NOTE: Record<Stop['kind'], string> = {
  city: 'center',
  poi: 'place',
  intersection: 'junction',
  custom: 'pin',
};

/**
 * Lettered stops. Drag a row to reorder, or focus it and press Alt+Up or Alt+Down. Delete removes it.
 * Between two stops, the leg's distance, time and difficulty.
 */
export function StopList({ stops, legs, onMove, onRemove }: StopListProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusAfterMove = useRef<number | null>(null);

  // A keyboard move re-renders the row at its new index, so focus follows the stop.
  useEffect(() => {
    if (focusAfterMove.current === null) return;
    rowRefs.current[focusAfterMove.current]?.focus();
    focusAfterMove.current = null;
  });

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const to = event.key === 'ArrowUp' ? index - 1 : index + 1;
      if (to < 0 || to >= stops.length) return;
      focusAfterMove.current = to;
      onMove(index, to);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(index);
    }
  };

  if (stops.length === 0) {
    return (
      <p className="rounded-[2px] border border-dashed border-rule px-3 py-4 text-center font-serif text-[14px] text-ink-2">
        Search for a start, or click the map to drop one.
      </p>
    );
  }

  return (
    <ol aria-label="Route stops" className="flex flex-col">
      {stops.map((stop, index) => {
        const leg = legs?.[index];
        return (
          <li key={`${stop.id}-${index}`} className="list-none">
            <div
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              role="group"
              tabIndex={0}
              draggable
              aria-label={`Stop ${stopLetter(index)}, ${stop.name}. Alt+Up or Alt+Down to move, Delete to remove.`}
              onKeyDown={(event) => onRowKeyDown(event, index)}
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                setDropAt(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFrom !== null) onMove(dragFrom, index);
                setDragFrom(null);
                setDropAt(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDropAt(null);
              }}
              className={`group flex cursor-grab items-center gap-2.5 rounded-[2px] border px-2 py-1.5 active:cursor-grabbing ${
                dropAt === index && dragFrom !== null && dragFrom !== index
                  ? 'border-accent bg-accent-soft'
                  : 'border-transparent hover:border-rule'
              }`}
            >
              <span aria-hidden className="font-mono text-[12px] text-ink-3 select-none">
                ⋮⋮
              </span>
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent bg-paper font-serif text-[13px] text-accent"
              >
                {stopLetter(index)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-[15px] text-ink">{stop.name}</span>
                <span className="block font-mono text-[10px] tracking-wider text-ink-3 uppercase">{KIND_NOTE[stop.kind]}</span>
              </span>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove stop ${stopLetter(index)}`}
                onClick={() => onRemove(index)}
                className="cursor-pointer rounded-[2px] px-1.5 font-mono text-[14px] text-ink-3 opacity-60 hover:text-alert hover:opacity-100 focus:opacity-100"
              >
                ×
              </button>
            </div>
            {leg && (
              <div className="flex items-center gap-2 py-1 pl-[1.85rem] font-mono text-[11px] text-ink-2">
                <span aria-hidden className="h-4 w-px bg-accent" />
                <span className="tabular-nums">
                  {formatDistance(leg.distanceM)} · {formatDuration(leg.durationS)}
                </span>
                <DifficultyChip difficulty={leg.difficulty} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
