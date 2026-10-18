import { PLACES, type Place } from '../map/places';
import type { CameraMode } from '../map/types';
import { Chip, Panel } from './primitives';

export interface ToolbarProps {
  cameraMode: CameraMode;
  onCameraMode: (value: CameraMode) => void;
  onGoTo: (place: Place) => void;
}

export function Toolbar({ cameraMode, onCameraMode, onGoTo }: ToolbarProps) {
  return (
    <header className="pointer-events-none absolute top-4 left-4 flex max-w-[calc(100%-2rem)] flex-wrap items-start gap-3">
      <Panel className="pointer-events-auto" bodyClassName="flex flex-wrap items-center gap-x-3 gap-y-2 p-2">
        <span className="px-1 font-serif text-[19px] tracking-wide text-ink">Backbone</span>
        <span className="h-4 w-px bg-rule" aria-hidden />
        <div role="group" aria-label="Places" className="flex flex-wrap gap-1.5">
          {PLACES.map((place) => (
            <Chip key={place.id} variant="serif" onClick={() => onGoTo(place)}>
              {place.name}
            </Chip>
          ))}
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
      </Panel>

      {cameraMode === 'freefly' && (
        <p className="pointer-events-auto rounded-[2px] border border-rule bg-surface px-2.5 py-1 font-mono text-[11px] tracking-wide text-ink-2 backdrop-blur">
          WASD move · Q/E down/up · Shift fast · drag to look
        </p>
      )}
    </header>
  );
}
