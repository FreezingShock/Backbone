import { FREEFLY_SPEED } from '../map/freeFly';
import { PLACES, type Place } from '../map/places';
import type { BasemapStyle, CameraMode } from '../map/types';
import { Chip, Panel } from './primitives';

export interface ToolbarProps {
  basemap: BasemapStyle;
  onBasemap: (value: BasemapStyle) => void;
  cameraMode: CameraMode;
  onCameraMode: (value: CameraMode) => void;
  cameraSpeed: number;
  onCameraSpeed: (value: number) => void;
  onGoTo: (place: Place) => void;
}

export function Toolbar({
  basemap,
  onBasemap,
  cameraMode,
  onCameraMode,
  cameraSpeed,
  onCameraSpeed,
  onGoTo,
}: ToolbarProps) {
  return (
    <header className="absolute top-4 left-4 right-4 flex flex-wrap items-start gap-3 pointer-events-none">
      <Panel className="pointer-events-auto" bodyClassName="flex items-center gap-3 p-2">
        <span className="px-1 font-mono text-xs tracking-[0.3em] text-cyan-grid">BACKBONE</span>
        <span className="h-4 w-px bg-line" aria-hidden />
        <div className="flex flex-wrap gap-1.5">
          {PLACES.map((place) => (
            <Chip key={place.id} onClick={() => onGoTo(place)}>
              {place.name}
            </Chip>
          ))}
        </div>
      </Panel>

      <Panel className="pointer-events-auto" bodyClassName="flex items-center gap-2 p-2">
        <div role="group" aria-label="Camera mode" className="flex gap-1.5">
          <Chip active={cameraMode === 'orbit'} onClick={() => onCameraMode('orbit')}>
            Orbit
          </Chip>
          <Chip active={cameraMode === 'freefly'} onClick={() => onCameraMode('freefly')}>
            Free-fly
          </Chip>
        </div>
        <span className="h-4 w-px bg-line" aria-hidden />
        <div role="group" aria-label="Basemap" className="flex gap-1.5">
          <Chip active={basemap === 'blueprint'} onClick={() => onBasemap('blueprint')}>
            Blueprint
          </Chip>
          <Chip active={basemap === 'satellite'} onClick={() => onBasemap('satellite')}>
            Satellite
          </Chip>
        </div>
        {cameraMode === 'freefly' && (
          <>
            <span className="h-4 w-px bg-line" aria-hidden />
            <label className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              Speed
              <input
                type="range"
                min={FREEFLY_SPEED.min}
                max={FREEFLY_SPEED.max}
                step={FREEFLY_SPEED.step}
                value={cameraSpeed}
                onChange={(event) => onCameraSpeed(Number(event.target.value))}
                className="w-24 accent-cyan-grid"
                aria-label="Free-fly speed"
              />
              <span className="w-10 tabular-nums text-ink">{cameraSpeed.toFixed(2)}×</span>
            </label>
          </>
        )}
      </Panel>

      {cameraMode === 'freefly' && (
        <p className="pointer-events-auto font-mono text-[11px] tracking-wide text-ink-muted">
          WASD move · Q/E down/up · Shift boost · drag to look
        </p>
      )}
    </header>
  );
}
