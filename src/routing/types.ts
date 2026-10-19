// Shared contract for Canyon Cutting routing. Types only, no runtime code, so the planner UI and the playback
// camera can import it without pulling in the engine. Change names here first and tell the other threads.

/** [lon, lat] in degrees. */
export type LonLat = [number, number];

/** Road classes from the graph build (scripts/road-classes.mjs). Highway is freeways and their ramps. */
export type RoadClass = 'highway' | 'crossing' | 'arterial' | 'collector' | 'local';

export type StopKind = 'city' | 'poi' | 'intersection' | 'custom';

export interface Stop {
  /** Stable id: a place id from src/data/places.json, an intersection key, or `custom:lon,lat`. */
  id: string;
  name: string;
  kind: StopKind;
  lon: number;
  lat: number;
}

/** Easy is the mildest. The colors live in src/routing/difficulty.ts (Minecraft text colors). */
export const DIFFICULTIES = ['easy', 'intermediate', 'medium', 'hard', 'difficult'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Traffic controls that add a step and a delay. Only the ones the graph data knows about appear. */
export type ControlKind = 'stop-sign' | 'traffic-signal';

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

/**
 * One instruction along a route. `distanceM` and `durationS` cover the road from this step to the next step,
 * so a turn-by-turn UI can show "in 1.2 km, turn right". The last step (`arrive`) has zero for both.
 */
export interface Step {
  kind: StepKind;
  /** The road you are on after this step. Empty string for unnamed roads. */
  roadName: string;
  lon: number;
  lat: number;
  distanceM: number;
  durationS: number;
  instruction: string;
}

/**
 * A run of one named road within a leg, for per-road difficulty. Consecutive road pieces with the same name and
 * canyon crossing are merged. The difficulty comes from the same score as the leg (src/routing/difficulty.ts).
 */
export interface Segment {
  roadName: string;
  /** Canyon crossing label such as "Lynn" or "Potrero", or '' when the road is not one of the named crossings. */
  crossing: string;
  cls: RoadClass;
  distanceM: number;
  durationS: number;
  difficulty: Difficulty;
  /** 0 (straight) to 1 (100 degrees of heading change per km or more). Length-weighted over the run. */
  curvature: number;
  /** Degrees of heading change per km, length-weighted. */
  curvatureDegPerKm: number;
  /** Percent grade. null until the graph carries elevation, so the UI can say "not measured". */
  gradePct: number | null;
  /** The 0 to 100 difficulty score the band comes from. */
  score: number;
}

export interface Leg {
  from: Stop;
  to: Stop;
  distanceM: number;
  durationS: number;
  difficulty: Difficulty;
  geometry: LonLat[];
  steps: Step[];
  /** Per-road runs, in order. Their distances add up to distanceM. Optional so older callers keep working. */
  segments?: Segment[];
}

export interface Route {
  stops: Stop[];
  legs: Leg[];
  distanceM: number;
  durationS: number;
  difficulty: Difficulty;
  geometry: LonLat[];
  /** ISO 8601 time. */
  departAt: string;
  /** ISO 8601 time, departAt plus durationS. */
  arriveAt: string;
  /** Things the rider should know, such as a freeway stretch or missing control data. */
  warnings: string[];
  /** Main canyon road, the one with the most distance (for example "Lynn"). Set by planRoute and planRoutes. */
  label?: string;
  /** Position in the planRoutes result. 0 is the preferred route. Unset on routes from older calls. */
  alternative?: number;
  /** Share of the distance (0 to 1) on highway-class roads. 0 means the route never touches a freeway. */
  highwayShare?: number;
}

export interface PlanOptions {
  /** ISO 8601 time to depart. Default: now. */
  departAt?: string;
  /**
   * Default true. Highway-class roads are priced at about four times their drive time, so canyon roads win unless
   * a freeway saves a lot of distance. They are never banned, so a route is found whenever one exists.
   */
  avoidHighways?: boolean;
  /** Default false. Local streets (service roads, tracks, neighborhood streets) are priced at three times their time, below a freeway. */
  avoidLocal?: boolean;
  /** planRoutes only: how many distinct canyon alternatives to return, 1 to 3. Default 3. */
  maxRoutes?: number;
}

export interface SuggestNear {
  lon: number;
  lat: number;
}
