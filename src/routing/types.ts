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
  /** ISO 8601 time. */
  departAt: string;
  /** ISO 8601 time, departAt plus durationS. */
  arriveAt: string;
  /** Things the rider should know, such as a fallback to highways or missing control data. */
  warnings: string[];
}

export interface PlanOptions {
  /** ISO 8601 time to depart. Default: now. */
  departAt?: string;
  /** Default true: canyon routes never use a highway-class road unless nothing else connects the stops. */
  avoidHighways?: boolean;
  /** Default false. Drops the local class (streets, service roads, tracks). */
  avoidLocal?: boolean;
}

export interface SuggestNear {
  lon: number;
  lat: number;
}
