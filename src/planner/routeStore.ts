// Saved routes. The UI talks to the RouteStore interface only, so Supabase can replace the local store later
// without touching the panel. Methods are async for that reason, even though localStorage is synchronous.
import type { Network, Stop } from './types';

export interface SavedRoute {
  id: string;
  name: string;
  stops: Stop[];
  network: Network;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStore {
  list(): Promise<SavedRoute[]>;
  /** Inserts or replaces by id. */
  save(route: SavedRoute): Promise<void>;
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = 'backbone-routes';
const VERSION = 1;

function isStop(value: unknown): value is Stop {
  if (!value || typeof value !== 'object') return false;
  const stop = value as Record<string, unknown>;
  return (
    typeof stop.id === 'string' &&
    typeof stop.name === 'string' &&
    typeof stop.lon === 'number' &&
    typeof stop.lat === 'number' &&
    ['city', 'poi', 'intersection', 'custom'].includes(stop.kind as string)
  );
}

function isSavedRoute(value: unknown): value is SavedRoute {
  if (!value || typeof value !== 'object') return false;
  const route = value as Record<string, unknown>;
  return (
    typeof route.id === 'string' &&
    typeof route.name === 'string' &&
    (route.network === 'canyons' || route.network === 'all') &&
    Array.isArray(route.stops) &&
    route.stops.every(isStop)
  );
}

/** localStorage, under one key. A blocked or full store degrades to "nothing saved" instead of an error. */
export function createLocalRouteStore(storage: Storage | null = safeStorage()): RouteStore {
  const read = (): SavedRoute[] => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { version?: number; routes?: unknown };
      return Array.isArray(parsed.routes) ? parsed.routes.filter(isSavedRoute) : [];
    } catch {
      return [];
    }
  };
  const write = (routes: SavedRoute[]): void => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, routes }));
    } catch {
      // Quota or blocked storage: the route stays for this session only.
    }
  };
  return {
    async list() {
      return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async save(route) {
      const others = read().filter((existing) => existing.id !== route.id);
      write([...others, route]);
    },
    async remove(id) {
      write(read().filter((existing) => existing.id !== id));
    },
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function newRouteId(): string {
  return `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
