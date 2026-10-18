import type { MapLayer } from '../layers/types';
import type { MapLook } from '../map/look';
import type { RuntimeStatus } from '../map/types';
import { Panel } from './primitives';

export interface LayerPanelProps {
  layers: MapLayer[];
  visibility: Record<string, boolean>;
  onToggle: (id: string, visible: boolean) => void;
  exaggeration: number;
  onExaggeration: (value: number) => void;
  status: RuntimeStatus;
  look: MapLook;
}

const STATUS_TEXT: Record<RuntimeStatus['imagery'], string> = {
  loading: 'loading',
  ok: 'USGS imagery',
  error: 'offline or blocked',
};

const TERRAIN_TEXT: Record<RuntimeStatus['terrain'], string> = {
  loading: 'loading',
  ion: 'Cesium World Terrain',
  open: 'AWS Terrain Tiles',
  error: 'failed to load',
};

const GROUP_HEADING = 'mb-1 font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase';

export function LayerPanel({
  layers,
  visibility,
  onToggle,
  exaggeration,
  onExaggeration,
  status,
  look,
}: LayerPanelProps) {
  const groups = [...new Set(layers.map((layer) => layer.group))];

  return (
    <Panel title="Layers" className="flex min-h-0 flex-1 flex-col overflow-y-auto" bodyClassName="p-3">
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <fieldset key={group} className="flex flex-col gap-1.5">
            <legend className={GROUP_HEADING}>{group}</legend>
            {layers
              .filter((layer) => layer.group === group)
              .map((layer) => {
                const checked = visibility[layer.id] ?? layer.defaultVisible;
                return (
                  <label
                    key={layer.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-[2px] px-1 py-1 font-serif text-[15px] text-ink hover:bg-accent-soft"
                  >
                    <span>{layer.label}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => onToggle(layer.id, event.target.checked)}
                      className="size-3.5 accent-accent"
                    />
                  </label>
                );
              })}
            {layers
              .filter((layer) => layer.group === group && layer.legend && (visibility[layer.id] ?? layer.defaultVisible))
              .map((layer) => (
                <div key={`${layer.id}-legend`} className="mb-1 flex flex-col gap-1 px-1 font-mono text-[10px] text-ink-2">
                  {layer.legend?.(look).map((item) => (
                    <div key={item.label} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block w-6 shrink-0 rounded-full"
                        style={{
                          backgroundColor: item.color,
                          height: item.thickness,
                          opacity: item.opacity ?? 1,
                        }}
                      />
                      <span>{item.label}</span>
                    </div>
                  ))}
                  {layer.note && <p className="pt-0.5 text-[9px] leading-snug text-ink-3">{layer.note}</p>}
                </div>
              ))}
          </fieldset>
        ))}

        <fieldset className="flex flex-col gap-2 border-t border-rule pt-3">
          <legend className={GROUP_HEADING}>Terrain</legend>
          <label className="flex items-center justify-between font-mono text-xs text-ink-2">
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
            className="w-full"
            aria-label="Terrain exaggeration"
          />
        </fieldset>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-rule pt-3 font-mono text-[11px] text-ink-3">
          <dt>Imagery</dt>
          <dd className="text-ink">{STATUS_TEXT[status.imagery]}</dd>
          <dt>Terrain</dt>
          <dd className="text-ink">{TERRAIN_TEXT[status.terrain]}</dd>
        </dl>
      </div>
    </Panel>
  );
}
