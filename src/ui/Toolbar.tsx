import { PLACES, type Place } from '../map/places';
import type { BasemapStyle, CameraMode } from '../map/types';
import { Chip, Panel } from './primitives';

export interface ToolbarProps {
  basemap: BasemapStyle;
  onBasemap: (value: BasemapStyle) => void;
  cameraMode: CameraMode;
  onCameraMode: (value: CameraMode) => void;
  onGoTo: (place: Place) => void;
}

export function Toolbar({ basemap, onBasemap, cameraMode, onCameraMode, onGoTo }: ToolbarProps) {
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
      </Panel>

      {cameraMode === 'freefly' && (
        <p className="pointer-events-auto font-mono text-[11px] tracking-wide text-ink-muted">
          WASD move · Q/E down/up · Shift fast · drag to look
        </p>
      )}
    </header>
  );
}
