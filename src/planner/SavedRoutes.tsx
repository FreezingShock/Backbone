import { useState } from 'react';
import { Chip } from '../ui/primitives';
import type { PresetRoute } from './presets';
import type { SavedRoute } from './routeStore';

export interface SavedRoutesProps {
  saved: SavedRoute[];
  presets: PresetRoute[];
  activeId: string | null;
  onLoad: (route: { id: string | null; name: string; stops: SavedRoute['stops']; network: SavedRoute['network'] }) => void;
  onRename: (route: SavedRoute, name: string) => void;
  onDelete: (route: SavedRoute) => void;
}

/** Your saved routes (load, rename, delete) and the built-in presets (load only). */
export function SavedRoutes({ saved, presets, activeId, onLoad, onRename, onDelete }: SavedRoutesProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Saved routes" className="flex flex-col gap-2">
        <h3 className="font-serif text-[13px] tracking-[0.16em] text-ink uppercase">Saved routes</h3>
        {saved.length === 0 && <p className="font-serif text-[14px] text-ink-2">Nothing saved yet. Plan a route, then save it.</p>}
        <ul className="flex flex-col gap-1">
          {saved.map((route) => {
            const renaming = renamingId === route.id;
            const confirming = confirmingId === route.id;
            return (
              <li
                key={route.id}
                className={`flex flex-wrap items-center gap-2 rounded-[2px] border px-2 py-1.5 ${
                  activeId === route.id ? 'border-accent bg-accent-soft' : 'border-transparent hover:border-rule'
                }`}
              >
                {renaming ? (
                  <form
                    className="flex min-w-0 flex-1 gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = draft.trim();
                      if (name) onRename(route, name);
                      setRenamingId(null);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Route name"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                      className="min-w-0 flex-1 rounded-[2px] border border-rule bg-transparent px-2 py-0.5 font-serif text-[14px] text-ink focus:border-accent focus:outline-none"
                    />
                    <Chip type="submit">Save</Chip>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onLoad({ id: route.id, name: route.name, stops: route.stops, network: route.network })}
                      className="min-w-0 flex-1 cursor-pointer text-left"
                    >
                      <span className="block truncate font-serif text-[15px] text-ink">{route.name}</span>
                      <span className="block font-mono text-[10px] tracking-wider text-ink-3 uppercase">
                        {route.stops.length} stops · {route.network === 'canyons' ? 'canyon roads' : 'all roads'}
                      </span>
                    </button>
                    <Chip
                      aria-label={`Rename ${route.name}`}
                      onClick={() => {
                        setRenamingId(route.id);
                        setDraft(route.name);
                        setConfirmingId(null);
                      }}
                    >
                      Rename
                    </Chip>
                    {confirming ? (
                      <Chip
                        aria-label={`Confirm delete ${route.name}`}
                        className="border-alert text-alert"
                        onClick={() => {
                          setConfirmingId(null);
                          onDelete(route);
                        }}
                      >
                        Confirm
                      </Chip>
                    ) : (
                      <Chip aria-label={`Delete ${route.name}`} onClick={() => setConfirmingId(route.id)}>
                        Delete
                      </Chip>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Preset routes" className="flex flex-col gap-2">
        <h3 className="font-serif text-[13px] tracking-[0.16em] text-ink uppercase">Presets</h3>
        <ul className="flex flex-col gap-1">
          {presets.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => onLoad({ id: null, name: preset.name, stops: preset.stops, network: preset.network })}
                className="w-full cursor-pointer rounded-[2px] border border-transparent px-2 py-1.5 text-left hover:border-rule"
              >
                <span className="block font-serif text-[15px] text-ink">{preset.name}</span>
                <span className="block font-mono text-[11px] text-ink-2">{preset.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
