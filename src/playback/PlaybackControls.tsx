import { useEffect } from 'react';
import { Chip } from '../ui/primitives';
import type { PlaybackCamera, PlaybackController } from './controller';
import { formatClockTime } from './format';
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from './pacing';
import { usePlaybackSnapshot } from './usePlayback';

const CAMERAS: { id: PlaybackCamera; label: string }[] = [
  { id: 'orbit', label: 'Orbit' },
  { id: 'freefly', label: 'Free-fly' },
];

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const SCRUB_STEPS = 1000;

/**
 * Transport bar for a playing route: restart, play or pause, a timeline, speed, camera follow mode, and exit.
 * Space plays or pauses, and Escape exits. Renders nothing when no route is playing.
 */
export function PlaybackControls({ controller }: { controller: PlaybackController | null }) {
  const snap = usePlaybackSnapshot(controller);
  const active = Boolean(controller) && snap.phase !== 'idle';

  useEffect(() => {
    if (!controller || !active) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        controller.togglePlay();
      } else if (event.code === 'Escape') {
        controller.stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, active]);

  if (!controller || !active) return null;

  const playing = snap.phase === 'playing' || snap.phase === 'intro';
  const introducing = snap.phase === 'intro';
  const finished = snap.phase === 'ended';
  const label = playing ? 'Pause' : finished ? 'Replay' : 'Play';

  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 justify-center">
      <section className="plate pointer-events-auto flex w-[min(94vw,640px)] flex-col gap-2.5 p-3" aria-label="Route playback">
        <div className="flex items-center gap-2.5">
          <Chip onClick={() => controller.restart()} aria-label="Restart route">
            Restart
          </Chip>
          <Chip active={playing} onClick={() => controller.togglePlay()} aria-label={`${label} route`} className="min-w-[4.5rem]">
            {label}
          </Chip>
          {introducing && (
            <Chip onClick={() => controller.skipIntro()} aria-label="Skip the opening shot">
              Skip intro
            </Chip>
          )}
          <span className="ml-auto" />
          <Chip onClick={() => controller.stop()} aria-label="Exit route playback">
            Exit
          </Chip>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px] text-ink-2">
          <input
            type="range"
            min={0}
            max={SCRUB_STEPS}
            step={1}
            value={Math.round(snap.progress * SCRUB_STEPS)}
            onChange={(event) => controller.seek(Number(event.target.value) / SCRUB_STEPS)}
            className="min-w-0 flex-1"
            aria-label="Route timeline"
          />
          <span className="w-[7.5rem] shrink-0 text-right tabular-nums text-ink">
            {formatClockTime(snap.elapsedS)} / {formatClockTime(snap.durationS)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="group" aria-label="Playback speed" className="flex gap-1.5">
            {PLAYBACK_SPEEDS.map((option) => (
              <Chip
                key={String(option.id)}
                active={snap.speed === option.id}
                onClick={() => controller.setSpeed(option.id as PlaybackSpeed)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
          <div role="group" aria-label="Camera follow" className="flex gap-1.5">
            {CAMERAS.map((option) => (
              <Chip key={option.id} active={snap.camera === option.id} onClick={() => controller.setCamera(option.id)}>
                {option.label}
              </Chip>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
