import type { MapLayer } from '../layers/types';
import type { RuntimeStatus } from '../map/types';
import { Panel } from './primitives';

export interface LayerPanelProps {
  layers: MapLayer[];
  visibility: Record<string, boolean>;
  onToggle: (id: string, visible: boolean) => void;
  exaggeration: number;
  onExaggeration: (value: number) => void;
  status: RuntimeStatus;
}

const STATUS_TEXT: Record<RuntimeStatus['imagery'], string> = {
  loading: 'loading',
  ok: 'USGS imagery',
  error: 'offline or blocked',
};

const TERRAIN_TEXT: Record<RuntimeStatus['terrain'], string> = {
  loading: 'loading',
  ion: 'Cesium World Terrain',
  flat: 'flat (no ion token)',
  error: 'failed to load',
};

export function LayerPanel({
  layers,
  visibility,
  onToggle,
  exaggeration,
  onExaggeration,
  status,
}: LayerPanelProps) {
  const groups = [...new Set(layers.map((layer) => layer.group))];

  return (
    <Panel title="Layers" className="absolute top-28 right-4 w-64 max-h-[calc(100%-8rem)] overflow-y-auto">
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <fieldset key={group} className="flex flex-col gap-1.5">
            <legend className="mb-1 font-mono text-[10px] tracking-[0.2em] text-ink-muted uppercase">
              {group}
            </legend>
            {layers
              .filter((layer) => layer.group === group)
              .map((layer) => {
                const checked = visibility[layer.id] ?? layer.defaultVisible;
                return (
                  <label
                    key={layer.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-1 py-1 text-sm hover:bg-navy-800"
                  >
                    <span>{layer.label}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => onToggle(layer.id, event.target.checked)}
                      className="size-4 accent-cyan-grid"
                    />
                  </label>
                );
              })}
          </fieldset>
        ))}

        <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
          <legend className="mb-1 font-mono text-[10px] tracking-[0.2em] text-ink-muted uppercase">
            Terrain
          </legend>
          <label className="flex items-center justify-between font-mono text-xs text-ink-muted">
            <span>Exaggeration</span>
            <span className="tabular-nums text-ink">{exaggeration.toFixed(1)}×</span>
          </label>
          <input
            type="range"
            min={1}
            max={2}
            step={0.1}
            value={exaggeration}
            onChange={(event) => onExaggeration(Number(event.target.value))}
            className="w-full accent-cyan-grid"
            aria-label="Terrain exaggeration"
          />
        </fieldset>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 font-mono text-[11px] text-ink-muted">
          <dt>Imagery</dt>
          <dd className="text-ink">{STATUS_TEXT[status.imagery]}</dd>
          <dt>Terrain</dt>
          <dd className="text-ink">{TERRAIN_TEXT[status.terrain]}</dd>
        </dl>
      </div>
    </Panel>
  );
}
