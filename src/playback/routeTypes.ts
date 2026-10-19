// Route shapes that playback reads. These mirror the routing contract agreed in the project: Stop, Route, Leg, Step.
// The routing engine owns the real definitions in src/routing/types.ts, which is not on main yet. When that file
// lands, replace this file with `export type { ... } from '../routing/types';` and keep the names the same.

export type LonLat = [number, number];

export type StopKind = 'city' | 'poi' | 'intersection' | 'custom';

export interface Stop {
  id: string;
  name: string;
  kind: StopKind;
  lon: number;
  lat: number;
}

export type Difficulty = 'easy' | 'intermediate' | 'medium' | 'hard' | 'difficult';

export type StepKind =
  | 'depart'
  | 'turn-left'
  | 'turn-right'
  | 'slight-left'
  | 'slight-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'straight'
  | 'u-turn'
  | 'stop-sign'
  | 'traffic-signal'
  | 'arrive';

export interface Step {
  kind: StepKind;
  roadName: string;
  lon: number;
  lat: number;
  distanceM: number;
  durationS: number;
  instruction: string;
}

export interface Leg {
  from: Stop;
  to: Stop;
  distanceM: number;
  durationS: number;
  difficulty: Difficulty;
  geometry: LonLat[];
  steps: Step[];
}

export interface Route {
  stops: Stop[];
  legs: Leg[];
  distanceM: number;
  durationS: number;
  difficulty: Difficulty;
  geometry: LonLat[];
  /** ISO 8601 time strings. */
  departAt: string;
  arriveAt: string;
}
