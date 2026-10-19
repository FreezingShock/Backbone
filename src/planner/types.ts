// The planner's data contract. Shapes match the routing engine's types (src/routing/types.ts, owned by the
// routing thread). When that file lands on main, re-export from it here and delete this copy.

export type StopKind = 'city' | 'poi' | 'intersection' | 'custom';

export type Difficulty = 'easy' | 'intermediate' | 'medium' | 'hard' | 'difficult';

/** `canyons` plans on canyon crossings only. `all` also uses arterials, collectors and local streets. */
export type Network = 'canyons' | 'all';

export type LonLat = [number, number];

export interface Stop {
  id: string;
  name: string;
  kind: StopKind;
  lon: number;
  lat: number;
}

/** One maneuver or road section along a leg. `distanceM` and `durationS` run to the next step. */
export interface Step {
  kind: string;
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
  /** ISO 8601 times. */
  departAt: string;
  arriveAt: string;
}
