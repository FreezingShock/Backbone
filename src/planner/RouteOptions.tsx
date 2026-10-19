import { DifficultyChip } from './DifficultyChip';
import type { RouteOption } from './engine';
import { formatClock, formatDistance, formatDuration } from './format';

export interface RouteOptionsProps {
  options: RouteOption[];
  selected: number;
  onSelect: (index: number) => void;
}

/**
 * Routes between the same stops, preferred first. Each card names the main road, shows the time and difficulty,
 * and says whether a highway was needed. The chosen one is drawn solid on the map; the rest are faint.
 */
export function RouteOptions({ options, selected, onSelect }: RouteOptionsProps) {
  return (
    <ul aria-label="Route options" className="flex flex-col gap-1.5">
      {options.map((option, index) => {
        const { route } = option;
        const active = index === selected;
        const usesHighway = route.warnings.some((warning) => /highway/i.test(warning));
        return (
          <li key={`${option.label}-${index}`}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(index)}
              className={`flex w-full cursor-pointer flex-col gap-1 rounded-[2px] border px-2.5 py-2 text-left ${
                active ? 'border-accent bg-accent-soft' : 'border-rule hover:border-accent'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-serif text-[15px] text-ink">
                  {option.label}
                  {index === 0 && <span className="ml-2 font-mono text-[10px] tracking-wider text-ink-3 uppercase">Preferred</span>}
                </span>
                <DifficultyChip difficulty={route.difficulty} />
              </span>
              <span className="font-mono text-[11px] text-ink-2 tabular-nums">
                {formatDuration(route.durationS)} · {formatDistance(route.distanceM)} · arrive {formatClock(route.arriveAt)}
              </span>
              <span className={`font-mono text-[10px] tracking-wider uppercase ${usesHighway ? 'text-warn' : 'text-ink-3'}`}>
                {usesHighway ? 'Uses a highway' : 'No highways'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
