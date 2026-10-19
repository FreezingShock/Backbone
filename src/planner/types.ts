// The planner uses the routing contract from src/routing/types.ts (types only). The one planner-only type is
// Network: which roads a route may use. The routing engine maps it to its PlanOptions flags.
export type {
  Difficulty,
  Leg,
  LonLat,
  PlanOptions,
  Route,
  RoadClass,
  Step,
  StepKind,
  Stop,
  StopKind,
} from '../routing/types';

/** `canyons` plans on canyon crossings only. `all` also uses arterials, collectors and local streets. */
export type Network = 'canyons' | 'all';
