import type { PlaybackController } from './controller';
import { usePlaybackSnapshot } from './usePlayback';
import { DIFFICULTY_STYLE } from './difficulty';
import { formatClock, formatDistance, formatDuration } from './format';
import { glyphMarkup, isArrowKind, stepRotation, stepTitle } from './icons';
import type { StepKind } from './routeTypes';

/** Turn arrow in the HUD. Same art as the map markers, drawn in the theme's own colors. */
function ManeuverGlyph({ kind }: { kind: StepKind }) {
  const rotate = isArrowKind(kind) ? stepRotation(kind) : 0;
  return (
    <svg viewBox="0 0 24 24" className="size-12 shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="11.5" fill="var(--c-paper)" stroke="var(--c-rule)" strokeWidth="0.6" />
      <g transform={`rotate(${rotate} 12 12)`} dangerouslySetInnerHTML={{ __html: glyphMarkup(kind, 'var(--c-ink)', 'var(--c-accent)') }} />
    </svg>
  );
}

/**
 * Navigation banner for a playing route: next maneuver with its distance, the road under the marker, and the
 * remaining time, distance and arrival clock. Renders nothing when no route is playing.
 */
export function NavigationHUD({ controller }: { controller: PlaybackController | null }) {
  const snap = usePlaybackSnapshot(controller);
  if (!snap.route || snap.phase === 'idle') return null;

  const destination = snap.route.stops[snap.route.stops.length - 1]?.name ?? 'destination';
  const next = snap.next;
  const arrived = snap.phase === 'ended' || (!next && snap.progress >= 1);
  const difficulty = snap.difficulty ? DIFFICULTY_STYLE[snap.difficulty] : null;

  return (
    <div className="pointer-events-none absolute top-4 left-1/2 flex w-[min(92vw,400px)] -translate-x-1/2 flex-col items-stretch gap-2">
      <section className="plate pointer-events-auto flex items-center gap-3 p-3" aria-live="polite" aria-label="Next maneuver">
        {arrived ? (
          <>
            <ManeuverGlyph kind="arrive" />
            <div className="min-w-0">
              <p className="font-serif text-[22px] leading-tight text-ink">Arrived</p>
              <p className="truncate font-mono text-[12px] text-ink-2">{destination}</p>
            </div>
          </>
        ) : next ? (
          <>
            <ManeuverGlyph kind={next.step.kind} />
            <div className="min-w-0 flex-1">
              <p className="font-serif text-[22px] leading-tight text-ink tabular-nums">
                {formatDistance(next.meters)}
              </p>
              <p className="truncate font-mono text-[12px] text-ink-2">{next.step.instruction || stepTitle(next.step.kind)}</p>
            </div>
          </>
        ) : (
          <>
            <ManeuverGlyph kind="arrive" />
            <div className="min-w-0">
              <p className="font-serif text-[22px] leading-tight text-ink">{formatDistance(snap.remainingM)}</p>
              <p className="truncate font-mono text-[12px] text-ink-2">Arriving at {destination}</p>
            </div>
          </>
        )}
      </section>

      <section className="plate pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 font-mono text-[11px] text-ink-2">
        {snap.roadName && <span className="max-w-[10rem] truncate text-ink">{snap.roadName}</span>}
        {difficulty && (
          <span
            className="rounded-[2px] px-1.5 py-0.5 text-[10px] tracking-wider uppercase"
            style={{ backgroundColor: difficulty.fill, color: difficulty.ink }}
          >
            {difficulty.label}
          </span>
        )}
        <span className="h-3 w-px bg-rule" aria-hidden />
        <span className="tabular-nums">
          <span className="text-ink">{formatDuration(snap.remainingS)}</span> left
        </span>
        <span className="tabular-nums">{formatDistance(snap.remainingM)}</span>
        <span className="h-3 w-px bg-rule" aria-hidden />
        <span>
          Arrive <span className="text-ink tabular-nums">{formatClock(snap.route.arriveAt)}</span>
        </span>
      </section>
    </div>
  );
}
