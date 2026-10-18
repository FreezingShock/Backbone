import { FREEFLY_SPEED } from '../map/freeFly';
import { HOME_PLACE, REGION_VIEW, type Place } from '../map/places';
import type { CameraMode } from '../map/types';
import { PlaceSearch } from './PlaceSearch';
import { Chip, Panel } from './primitives';

export interface ToolbarProps {
  cameraMode: CameraMode;
  onCameraMode: (value: CameraMode) => void;
  cameraSpeed: number;
  onCameraSpeed: (value: number) => void;
  onGoTo: (place: Place) => void;
  /** Search result: fly there and pin its card. */
  onPick: (place: Place) => void;
}

export function Toolbar({ cameraMode, onCameraMode, cameraSpeed, onCameraSpeed, onGoTo, onPick }: ToolbarProps) {
  return (
    <header className="pointer-events-none absolute top-4 left-4 flex max-w-[calc(100%-2rem)] flex-wrap items-start gap-3">
      <Panel className="pointer-events-auto" bodyClassName="flex flex-wrap items-center gap-x-3 gap-y-2 p-2">
        <span className="px-1 font-serif text-[19px] tracking-wide text-ink">Backbone</span>
        <span className="h-4 w-px bg-rule" aria-hidden />
        <PlaceSearch onPick={onPick} />
        <div role="group" aria-label="Views" className="flex flex-wrap gap-1.5">
          <Chip variant="serif" onClick={() => onGoTo(HOME_PLACE)}>
            Topanga
          </Chip>
          <Chip variant="serif" onClick={() => onGoTo(REGION_VIEW)}>
            Region
          </Chip>
        </div>
        <span className="h-4 w-px bg-rule" aria-hidden />
        <div role="group" aria-label="Camera mode" className="flex gap-1.5">
          <Chip active={cameraMode === 'orbit'} onClick={() => onCameraMode('orbit')}>
            Orbit
          </Chip>
          <Chip active={cameraMode === 'freefly'} onClick={() => onCameraMode('freefly')}>
            Free-fly
          </Chip>
        </div>
        {cameraMode === 'freefly' && (
          <>
            <span className="h-4 w-px bg-rule" aria-hidden />
            <label className="flex items-center gap-2 font-mono text-[11px] text-ink-2">
              Speed
              <input
                type="range"
                min={FREEFLY_SPEED.min}
                max={FREEFLY_SPEED.max}
                step={FREEFLY_SPEED.step}
                value={cameraSpeed}
                onChange={(event) => onCameraSpeed(Number(event.target.value))}
                className="w-24 accent-ink"
                aria-label="Free-fly speed"
              />
              <span className="w-10 tabular-nums text-ink">{cameraSpeed.toFixed(2)}×</span>
            </label>
          </>
        )}
      </Panel>

      {cameraMode === 'freefly' && (
        <p className="pointer-events-auto rounded-[2px] border border-rule bg-surface px-2.5 py-1 font-mono text-[11px] tracking-wide text-ink-2 backdrop-blur">
          WASD move · Q/E down/up · Shift boost · drag to look
        </p>
      )}
    </header>
  );
}
