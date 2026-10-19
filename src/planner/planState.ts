// The planner's editable state and its pure reducer. Kept free of React and Cesium so it can be tested under node.
import type { Network, Stop } from './types';

/** Departure is "now" until someone picks a time. "Now" is read when the route is planned, not when the page loads. */
export type DepartState = { mode: 'now' } | { mode: 'at'; iso: string };

export interface PlanState {
  stops: Stop[];
  network: Network;
  depart: DepartState;
}

export type PlanAction =
  | { type: 'add'; stop: Stop; index?: number }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'reverse' }
  | { type: 'clear' }
  | { type: 'load'; stops: Stop[]; network: Network }
  | { type: 'network'; network: Network }
  | { type: 'depart'; depart: DepartState };

export const MAX_STOPS = 25;

export const INITIAL_PLAN: PlanState = { stops: [], network: 'canyons', depart: { mode: 'now' } };

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'add': {
      if (state.stops.length >= MAX_STOPS) return state;
      const last = state.stops[state.stops.length - 1];
      // Ignore a repeat of the stop just added: it would make a zero-length leg.
      if (action.index === undefined && last && last.id === action.stop.id) return state;
      const index = action.index === undefined ? state.stops.length : Math.min(Math.max(action.index, 0), state.stops.length);
      const stops = [...state.stops];
      stops.splice(index, 0, action.stop);
      return { ...state, stops };
    }
    case 'remove':
      if (action.index < 0 || action.index >= state.stops.length) return state;
      return { ...state, stops: state.stops.filter((_, index) => index !== action.index) };
    case 'move': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= state.stops.length || to >= state.stops.length) return state;
      const stops = [...state.stops];
      const [moved] = stops.splice(from, 1);
      stops.splice(to, 0, moved);
      return { ...state, stops };
    }
    case 'reverse':
      return { ...state, stops: [...state.stops].reverse() };
    case 'clear':
      return { ...state, stops: [] };
    case 'load':
      return { ...state, stops: action.stops.slice(0, MAX_STOPS), network: action.network };
    case 'network':
      return { ...state, network: action.network };
    case 'depart':
      return { ...state, depart: action.depart };
  }
}

/** Name for a route that has no name yet: "A to B", or "A to B to C" with three or more stops. */
export function defaultRouteName(stops: readonly Stop[]): string {
  if (stops.length === 0) return 'New route';
  if (stops.length === 1) return stops[0].name;
  return stops.map((stop) => stop.name).join(' to ');
}
