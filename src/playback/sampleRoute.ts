// A stand-in route for development, until the planner's routes reach the page. It plans the canyon-only demo stops on
// the road graph (the real geometry in public/data/roads.geojson), then derives turns from the bends in that line.
// Stop signs and traffic lights are placeholders on fixed points, not surveyed data. Remove this file when the
// planner's routes are used.
import { loadRoadCollection } from '../layers/roads';
import { CANYON_DEMO_STOPS } from '../lib/roads/demoRoute';
import { buildRoadGraph, planRoute, type PlannedRoute, type RoadGraph } from '../lib/roads/route';
import { bearingBetween, metersBetween, wrapAngle } from './track';
import type { Difficulty, Leg, LonLat, Route, Step, StepKind, Stop } from './routeTypes';

/** Speed used to estimate time on canyon roads, meters per second. About 35 mph. */
const SAMPLE_SPEED_MPS = 15.6;
const SAMPLE_DIFFICULTY: Difficulty = 'medium';

/** Turn kind for a bend in degrees (positive is right of travel). */
export function bendKind(degrees: number): StepKind {
  const magnitude = Math.abs(degrees);
  const left = degrees < 0;
  if (magnitude <= 45) return left ? 'slight-left' : 'slight-right';
  if (magnitude <= 110) return left ? 'turn-left' : 'turn-right';
  if (magnitude <= 160) return left ? 'sharp-left' : 'sharp-right';
  return 'u-turn';
}

/** A maneuver and how far along its path it sits, in meters. */
export interface PathManeuver {
  step: Step;
  atM: number;
}

/**
 * Turns along one path. `points` are the path's coordinates, `names` the road name of each segment
 * (names.length === points.length - 1). Emits a step where the road bends or changes name. Distances are left at
 * zero here; sampleRouteFromPlan fills them in across the whole route.
 * Every fourth straight crossing gets a stop-sign placeholder and every seventh a traffic-light placeholder.
 */
export function deriveManeuvers(points: LonLat[], names: string[]): PathManeuver[] {
  const out: PathManeuver[] = [];
  let crossings = 0;
  let along = 0;

  for (let i = 1; i < points.length - 1; i++) {
    along += metersBetween(points[i - 1], points[i]);
    const inName = names[i - 1] ?? '';
    const outName = names[i] ?? '';
    const bend =
      (wrapAngle(bearingBetween(points[i], points[i + 1]) - bearingBetween(points[i - 1], points[i])) * 180) / Math.PI;
    if (Math.abs(bend) < 20 && inName === outName) continue;

    let kind: StepKind = Math.abs(bend) < 20 ? 'straight' : bendKind(bend);
    if (kind === 'straight') {
      crossings += 1;
      if (crossings % 4 === 0) kind = 'stop-sign';
      else if (crossings % 7 === 0) kind = 'traffic-signal';
    }
    const control = kind === 'stop-sign' || kind === 'traffic-signal';
    out.push({
      step: {
        kind,
        roadName: outName,
        lon: points[i][0],
        lat: points[i][1],
        distanceM: 0,
        durationS: 0,
        instruction: control ? `${kind === 'stop-sign' ? 'Stop sign' : 'Traffic light'} (sample) on ${outName}` : outName,
      },
      atM: along,
    });
  }
  return out;
}

/** Turns a planned route into the Route shape. Depart and arrive steps bracket the whole route. */
export function sampleRouteFromPlan(graph: RoadGraph, planned: PlannedRoute, departAt: Date): Route {
  const maneuvers: { leg: number; maneuver: PathManeuver }[] = [];
  const legs: Leg[] = [];
  let offset = 0;

  planned.legs.forEach((planLeg, index) => {
    const points = planLeg.path.map((key) => graph.nodes.get(key)).filter((p): p is LonLat => Boolean(p));
    const names = planLeg.edges.map((edge) => edge.name);
    const meters = planLeg.edges.reduce((sum, edge) => sum + edge.meters, 0);
    const first = points[0];
    const last = points[points.length - 1];

    if (index === 0) {
      maneuvers.push({
        leg: index,
        maneuver: {
          step: { kind: 'depart', roadName: names[0] ?? '', lon: first[0], lat: first[1], distanceM: 0, durationS: 0, instruction: `Depart ${planLeg.from.name}` },
          atM: 0,
        },
      });
    }
    for (const maneuver of deriveManeuvers(points, names)) {
      maneuvers.push({ leg: index, maneuver: { ...maneuver, atM: offset + maneuver.atM } });
    }
    if (index === planned.legs.length - 1) {
      maneuvers.push({
        leg: index,
        maneuver: {
          step: { kind: 'arrive', roadName: names[names.length - 1] ?? '', lon: last[0], lat: last[1], distanceM: 0, durationS: 0, instruction: `Arrive at ${planLeg.to.name}` },
          atM: offset + meters,
        },
      });
    }

    // Stops sit on the road node the planner snapped them to, so markers land on the line.
    const stop = (name: string, id: string, at: LonLat): Stop => ({ id, name, kind: 'city', lon: at[0], lat: at[1] });
    legs.push({
      from: stop(planLeg.from.name, `stop-${index}`, first),
      to: stop(planLeg.to.name, `stop-${index + 1}`, last),
      distanceM: meters,
      durationS: meters / SAMPLE_SPEED_MPS,
      difficulty: SAMPLE_DIFFICULTY,
      geometry: points,
      steps: [],
    });
    offset += meters;
  });

  // Each step's distance and time run to the next step, as the contract defines them. The last one is zero.
  maneuvers.forEach((entry, i) => {
    const next = maneuvers[i + 1];
    const distanceM = next ? Math.max(next.maneuver.atM - entry.maneuver.atM, 0) : 0;
    entry.maneuver.step.distanceM = distanceM;
    entry.maneuver.step.durationS = distanceM / SAMPLE_SPEED_MPS;
    legs[entry.leg].steps.push(entry.maneuver.step);
  });

  const distanceM = legs.reduce((sum, leg) => sum + leg.distanceM, 0);
  const durationS = legs.reduce((sum, leg) => sum + leg.durationS, 0);
  const geometry = legs.flatMap((leg, index) => (index === 0 ? leg.geometry : leg.geometry.slice(1)));
  return {
    stops: legs.map((leg) => leg.from).concat(legs.length ? [legs[legs.length - 1].to] : []),
    legs,
    distanceM,
    durationS,
    difficulty: SAMPLE_DIFFICULTY,
    geometry,
    departAt: departAt.toISOString(),
    arriveAt: new Date(departAt.getTime() + durationS * 1000).toISOString(),
    warnings: ['Sample route: stop signs and traffic lights are placeholders.'],
  };
}

/** Loads the road file and builds the sample route from the canyon demo stops. */
export async function loadSampleRoute(): Promise<Route> {
  const data = await loadRoadCollection();
  const graph = buildRoadGraph(data.features, (cls) => cls === 'crossing');
  const planned = planRoute(graph, CANYON_DEMO_STOPS);
  return sampleRouteFromPlan(graph, planned, new Date());
}
