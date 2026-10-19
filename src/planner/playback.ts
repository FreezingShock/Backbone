// Hand-off from the planner to playback. The playback controller is built in src/playback/ by another thread and
// is not on main yet, so this is the one place to call it from. Until then it returns false and the panel says so.
import type { Route } from './types';

/** Returns true when playback accepted the route. */
export function playPlannedRoute(route: Route): boolean {
  void route;
  return false;
}
