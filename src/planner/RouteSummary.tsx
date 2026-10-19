import { DifficultyChip } from './DifficultyChip';
import { formatClock, formatDistance, formatDuration, stopLetter } from './format';
import type { Route, StepKind } from './types';

/** Totals, then each leg with its times and turn-by-turn steps. */
export function RouteSummary({ route }: { route: Route }) {
  let elapsed = 0;
  const departMs = new Date(route.departAt).getTime();
  return (
    <section aria-label="Route summary" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-serif text-[26px] leading-none text-ink tabular-nums">{formatDuration(route.durationS)}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-2 tabular-nums">
            {formatDistance(route.distanceM)} · leave {formatClock(route.departAt)} · arrive {formatClock(route.arriveAt)}
          </p>
        </div>
        <DifficultyChip difficulty={route.difficulty} />
      </div>

      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {route.legs.map((leg, index) => {
          elapsed += leg.durationS;
          const arriveAt = new Date(departMs + elapsed * 1000).toISOString();
          return (
            <li key={index} className="py-2">
              <details>
                <summary className="flex cursor-pointer list-none items-center gap-2 font-mono text-[12px] text-ink marker:hidden">
                  <span className="font-serif text-accent">
                    {stopLetter(index)} → {stopLetter(index + 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{leg.to.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">
                    {formatDistance(leg.distanceM)} · {formatDuration(leg.durationS)}
                  </span>
                  <DifficultyChip difficulty={leg.difficulty} />
                </summary>
                <p className="mt-1 pl-1 font-mono text-[10px] tracking-wider text-ink-3 uppercase">
                  Arrive {stopLetter(index + 1)} at {formatClock(arriveAt)}
                </p>
                <ol className="mt-2 flex flex-col gap-1.5 pl-1">
                  {leg.steps.map((step, stepIndex) => (
                    <li key={stepIndex} className="flex items-baseline gap-2 text-[13px] text-ink">
                      <span aria-hidden className="w-4 shrink-0 text-center font-mono text-accent">
                        {stepGlyph(step.kind)}
                      </span>
                      <span className="min-w-0 flex-1">{step.instruction}</span>
                      {step.distanceM > 0 && (
                        <span className="shrink-0 font-mono text-[11px] text-ink-3 tabular-nums">
                          {formatDistance(step.distanceM)}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function stepGlyph(kind: StepKind): string {
  switch (kind) {
    case 'turn-left':
      return '↰';
    case 'turn-right':
      return '↱';
    case 'sharp-left':
      return '↲';
    case 'sharp-right':
      return '↳';
    case 'slight-left':
      return '↖';
    case 'slight-right':
      return '↗';
    case 'u-turn':
      return '↶';
    case 'stop-sign':
      return '■';
    case 'traffic-signal':
      return '▲';
    case 'depart':
      return '●';
    case 'arrive':
      return '◉';
    default:
      return '↑';
  }
}
