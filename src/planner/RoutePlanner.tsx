// Canyon Cutting: plan a route through stops A, B, C and so on, save it, and hand it to playback.
// The panel is a plate on the left of the map. Its state lives in planState.ts; the map drawing is PlannerOverlay.
import { useCallback, useEffect, useMemo, useReducer, useState, type FormEvent } from 'react';
import type * as Cesium from 'cesium';
import type { MapLook } from '../map/look';
import { Chip } from '../ui/primitives';
import { customStop } from './engine';
import { formatClock, fromLocalInput, toLocalInput } from './format';
import { PlannerOverlay } from './PlannerOverlay';
import { RouteOptions } from './RouteOptions';
import { defaultRouteName, INITIAL_PLAN, planReducer, type DepartState } from './planState';
import { PRESET_ROUTES } from './presets';
import { RouteSummary } from './RouteSummary';
import { createLocalRouteStore, newRouteId, type RouteStore, type SavedRoute } from './routeStore';
import { SavedRoutes } from './SavedRoutes';
import { StopList } from './StopList';
import { StopSearch } from './StopSearch';
import { useRoutePlan } from './useRoutePlan';
import type { Network, Route, Stop } from './types';

export interface RoutePlannerProps {
  viewer: Cesium.Viewer | null;
  look: MapLook;
  /** Hands the planned route to playback. */
  onPlay: (route: Route) => void;
}

const NETWORK_LABEL: Record<Network, string> = { canyons: 'Prefer canyons, avoid freeways', all: 'All roads' };

export function RoutePlanner({ viewer, look, onPlay }: RoutePlannerProps) {
  const [open, setOpen] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [plan, dispatch] = useReducer(planReducer, INITIAL_PLAN);
  const result = useRoutePlan(plan);
  const [selectedOption, setSelectedOption] = useState(0);
  // A new plan starts from the preferred route again.
  useEffect(() => setSelectedOption(0), [result.options]);
  const chosenIndex = Math.min(selectedOption, Math.max(result.options.length - 1, 0));
  const alternates = useMemo(
    () => result.options.filter((_, index) => index !== chosenIndex).map((option) => option.route),
    [result.options, chosenIndex],
  );
  const store: RouteStore = useMemo(() => createLocalRouteStore(), []);
  const [saved, setSaved] = useState<SavedRoute[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveDraft, setSaveDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // What the user is typing in the departure box. Null means show the planned time (or now).
  const [departDraft, setDepartDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    store.list().then((routes) => {
      if (!cancelled) setSaved(routes);
    });
    return () => {
      cancelled = true;
    };
  }, [open, store]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const addStop = useCallback((stop: Stop) => dispatch({ type: 'add', stop }), []);
  const pinStop = useCallback((lon: number, lat: number) => dispatch({ type: 'add', stop: customStop(lon, lat) }), []);
  const route: Route | null = result.options[chosenIndex]?.route ?? null;
  const lastStop = plan.stops.at(-1);

  const setDepart = (depart: DepartState) => {
    setDepartDraft(null);
    dispatch({ type: 'depart', depart });
  };
  const departDate = plan.depart.mode === 'at' ? new Date(plan.depart.iso) : new Date();

  const load = (loaded: { id: string | null; name: string; stops: Stop[]; network: Network }) => {
    dispatch({ type: 'load', stops: loaded.stops, network: loaded.network });
    setActiveId(loaded.id);
    setSaveDraft(null);
    setPickMode(false);
    setNotice(`Loaded ${loaded.name}`);
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saveDraft === null) return;
    const name = saveDraft.trim() || defaultRouteName(plan.stops);
    const now = new Date().toISOString();
    const existing = saved.find((candidate) => candidate.id === activeId);
    const record: SavedRoute = {
      id: existing?.id ?? newRouteId(),
      name,
      stops: plan.stops,
      network: plan.network,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await store.save(record);
    setSaved(await store.list());
    setActiveId(record.id);
    setSaveDraft(null);
    setNotice(`Saved ${name}`);
  };

  const rename = async (route: SavedRoute, name: string) => {
    await store.save({ ...route, name, updatedAt: new Date().toISOString() });
    setSaved(await store.list());
  };

  const remove = async (route: SavedRoute) => {
    await store.remove(route.id);
    setSaved(await store.list());
    if (activeId === route.id) setActiveId(null);
    setNotice(`Deleted ${route.name}`);
  };

  if (!open) {
    return (
      <div className="pointer-events-none absolute top-20 left-4">
        <Chip variant="serif" className="pointer-events-auto bg-surface backdrop-blur" onClick={() => setOpen(true)}>
          Canyon Cutting
        </Chip>
      </div>
    );
  }

  const canPlay = route !== null && !result.loading;
  const save = () => {
    if (plan.stops.length === 0) return;
    setSaveDraft(activeId ? (saved.find((candidate) => candidate.id === activeId)?.name ?? '') : defaultRouteName(plan.stops));
  };

  return (
    <>
      <PlannerOverlay
        viewer={viewer}
        look={look}
        stops={plan.stops}
        route={route}
        alternates={alternates}
        pickMode={pickMode}
        onPickStop={pinStop}
      />
      <section
        aria-label="Canyon Cutting route planner"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && pickMode) {
            event.stopPropagation();
            setPickMode(false);
          }
        }}
        className="plate absolute top-20 left-4 bottom-36 z-20 flex w-[min(21rem,calc(100%-2rem))] flex-col"
      >
        <header className="flex items-center justify-between border-b border-rule px-3 py-2">
          <h2 className="font-serif text-[13px] tracking-[0.2em] text-accent uppercase">Canyon Cutting</h2>
          <button
            type="button"
            onClick={() => {
              setPickMode(false);
              setOpen(false);
            }}
            aria-label="Close route planner"
            className="cursor-pointer rounded-[2px] px-2 font-mono text-[16px] text-ink-2 hover:text-accent"
          >
            ×
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          <div role="group" aria-label="Roads to use" className="flex flex-wrap gap-1.5">
            {(Object.keys(NETWORK_LABEL) as Network[]).map((network) => (
              <Chip
                key={network}
                active={plan.network === network}
                onClick={() => dispatch({ type: 'network', network })}
              >
                {NETWORK_LABEL[network]}
              </Chip>
            ))}
          </div>

          <StopSearch
            network={plan.network}
            near={lastStop ? { lon: lastStop.lon, lat: lastStop.lat } : undefined}
            placeholder={plan.stops.length === 0 ? 'Start: a place, a junction, a town' : 'Add a stop'}
            onPick={addStop}
          />

          <StopList
            stops={plan.stops}
            legs={route?.legs ?? null}
            onMove={(from, to) => dispatch({ type: 'move', from, to })}
            onRemove={(index) => dispatch({ type: 'remove', index })}
          />

          {result.error && (
            <p role="alert" className="font-mono text-[12px] text-alert">
              {result.error}
            </p>
          )}
          {!result.error && plan.stops.length === 1 && (
            <p className="font-mono text-[12px] text-ink-2">Add a second stop to see the route.</p>
          )}
          {result.loading && <p className="font-mono text-[12px] text-ink-2">Planning…</p>}

          {result.options.length > 1 && (
            <RouteOptions options={result.options} selected={chosenIndex} onSelect={setSelectedOption} />
          )}
          {route && <RouteSummary route={route} />}
          {route?.warnings.map((warning) => (
            <p key={warning} className="font-mono text-[11px] text-ink-3">
              {warning}
            </p>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canPlay}
              onClick={() => route && onPlay(route)}
              className="cursor-pointer rounded-[2px] border border-accent bg-accent px-4 py-1.5 font-mono text-[12px] tracking-wider text-paper uppercase transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              Play
            </button>
            <Chip disabled={plan.stops.length < 2} onClick={() => dispatch({ type: 'reverse' })}>
              Reverse
            </Chip>
            <Chip active={pickMode} onClick={() => setPickMode((on) => !on)} aria-label="Click the map to add stops">
              {pickMode ? 'Clicking map…' : 'Pick on map'}
            </Chip>
            <Chip disabled={plan.stops.length === 0} onClick={save}>
              {activeId ? 'Update' : 'Save'}
            </Chip>
            <Chip disabled={plan.stops.length === 0} onClick={() => { setActiveId(null); setSaveDraft(null); dispatch({ type: 'clear' }); }}>
              Clear
            </Chip>
          </div>

          {saveDraft !== null && (
            <form onSubmit={onSave} className="flex gap-2">
              <input
                autoFocus
                aria-label="Route name"
                placeholder="Name this route"
                value={saveDraft}
                onChange={(event) => setSaveDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSaveDraft(null);
                }}
                className="min-w-0 flex-1 rounded-[2px] border border-rule bg-transparent px-2 py-1 font-serif text-[14px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
              <Chip type="submit">Save</Chip>
            </form>
          )}

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-2">
            <span>Leave</span>
            <input
              type="datetime-local"
              aria-label="Departure time"
              value={departDraft ?? toLocalInput(departDate)}
              onChange={(event) => {
                const value = event.target.value;
                const date = fromLocalInput(value);
                // Partial typing is not a time yet: keep the draft until the box holds a valid one.
                if (date) setDepart({ mode: 'at', iso: date.toISOString() });
                else setDepartDraft(value);
              }}
              className="rounded-[2px] border border-rule bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
            />
            <Chip active={plan.depart.mode === 'now'} onClick={() => setDepart({ mode: 'now' })}>
              Now
            </Chip>
            {route && (
              <span className="ml-auto tabular-nums text-ink">
                arrive {formatClock(route.arriveAt)}
              </span>
            )}
          </div>

          {notice && (
            <p role="status" className="font-mono text-[11px] text-accent">
              {notice}
            </p>
          )}

          <SavedRoutes
            saved={saved}
            presets={PRESET_ROUTES}
            activeId={activeId}
            onLoad={load}
            onRename={rename}
            onDelete={remove}
          />
        </div>
      </section>
    </>
  );
}
