import { bearingDeg, turnBetween } from './geo';
import type { RoutingGraph } from './graph';
import { difficultyScore, rollUpDifficulty } from './difficulty';
import type { Leg, LonLat, Stop, Step, StepKind } from './types';
import { controlDelayS, turnDelayS } from './speed';

/** Turns smaller than this are going straight on, even when the road name changes. */
const STRAIGHT_DEG = 25;
/** Along one named road, only a turn at least this sharp gets its own step. Canyon roads bend constantly. */
const SAME_ROAD_TURN_DEG = 45;

interface Part {
  meters: number;
  score: number;
}

function kindForTurn(turn: number): StepKind {
  const size = Math.abs(turn);
  const left = turn < 0;
  if (size >= 160) return 'u-turn';
  if (size >= 120) return left ? 'sharp-left' : 'sharp-right';
  if (size >= 45) return left ? 'turn-left' : 'turn-right';
  return left ? 'slight-left' : 'slight-right';
}

function instructionFor(kind: StepKind, road: string): string {
  const onto = road ? ` onto ${road}` : '';
  switch (kind) {
    case 'u-turn':
      return `Make a U-turn${onto}`;
    case 'sharp-left':
      return `Make a sharp left${onto}`;
    case 'sharp-right':
      return `Make a sharp right${onto}`;
    case 'turn-left':
      return `Turn left${onto}`;
    case 'turn-right':
      return `Turn right${onto}`;
    case 'slight-left':
      return `Keep left${onto}`;
    case 'slight-right':
      return `Keep right${onto}`;
    default:
      return road ? `Continue on ${road}` : 'Continue straight';
  }
}

export interface LegInput {
  from: Stop;
  to: Stop;
  /** The snapped junction the leg starts from. */
  fromNode: number;
  /** Directed refs from fromNode to toNode, as found by the search. */
  refs: number[];
}

export interface BuiltLeg {
  leg: Leg;
  parts: Part[];
}

/**
 * Turns a path of road pieces into a leg: its geometry (stop to junction, the road, junction to stop), its
 * time and distance (including turn and control delays), its difficulty, and its turn-by-turn steps. Steps
 * carry the distance and time to the next step, so a UI can say "in 1.2 km, turn right".
 */
export function buildLeg(graph: RoutingGraph, input: LegInput): BuiltLeg {
  const { from, to, fromNode, refs } = input;
  const geometry: LonLat[] = [[from.lon, from.lat]];
  const pushPoint = (point: LonLat) => {
    const last = geometry[geometry.length - 1];
    if (last[0] !== point[0] || last[1] !== point[1]) geometry.push(point);
  };
  const fromPoint = graph.nodePoint(fromNode);
  pushPoint(fromPoint);

  // Per-piece data, in order.
  const pieces = refs.map((ref) => {
    const edge = ref >> 1;
    const points = graph.geometryOf(ref);
    for (const point of points) pushPoint(point);
    return {
      ref,
      edge,
      points,
      meters: graph.edgeMeters[edge],
      seconds: graph.edgeMeters[edge] / graph.edgeSpeedMs[edge],
      name: graph.nameOf(edge),
      cls: graph.classOf(edge),
      highway: graph.highwayOf(edge),
    };
  });
  pushPoint([to.lon, to.lat]);

  const parts: Part[] = pieces.map((piece) => ({
    meters: piece.meters,
    score: difficultyScore({
      curvatureDegPerKm: graph.edgeCurvature[piece.edge],
      cls: piece.cls,
      speedMph: graph.speedMphOf(piece.edge),
      unpaved: piece.highway === 'track',
    }),
  }));

  // Walk the pieces, collecting the junction events and the running distance and time.
  const firstRoad = pieces[0]?.name ?? '';
  type Mark = { meters: number; seconds: number; step: Step };
  const marks: Mark[] = [];

  const depart: Step = {
    kind: 'depart',
    roadName: firstRoad,
    lon: from.lon,
    lat: from.lat,
    distanceM: 0,
    durationS: 0,
    instruction: firstRoad ? `Start on ${firstRoad}` : `Start toward ${to.name}`,
  };
  marks.push({ meters: 0, seconds: 0, step: depart });

  let meters = 0;
  let seconds = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    meters += piece.meters;
    seconds += piece.seconds;
    if (i === pieces.length - 1) break;

    // The junction between this piece and the next.
    const next = pieces[i + 1];
    const node = graph.endOf(piece.ref);
    const control = graph.controls.get(node);
    const [lon, lat] = graph.nodePoint(node);

    const incoming = piece.points.length >= 2 ? bearingDeg(piece.points[piece.points.length - 2], piece.points[piece.points.length - 1]) : null;
    const outgoing = next.points.length >= 2 ? bearingDeg(next.points[0], next.points[1]) : null;
    const turn = incoming !== null && outgoing !== null ? turnBetween(incoming, outgoing) : 0;
    const sameRoad = next.name === piece.name;
    const isManeuver = sameRoad ? Math.abs(turn) >= SAME_ROAD_TURN_DEG : true;

    if (control) {
      const step: Step = {
        kind: control.kind,
        roadName: piece.name,
        lon,
        lat,
        distanceM: 0,
        durationS: 0,
        instruction: control.kind === 'stop-sign' ? `Stop at the stop sign${control.label ? ` at ${control.label}` : ''}` : `Traffic signal${control.label ? ` at ${control.label}` : ''}`,
      };
      marks.push({ meters, seconds, step });
      seconds += controlDelayS(control.kind);
    }

    seconds += turnDelayS(turn);
    if (isManeuver) {
      const kind: StepKind = sameRoad || Math.abs(turn) >= STRAIGHT_DEG ? kindForTurn(turn) : 'straight';
      const step: Step = {
        kind,
        roadName: next.name,
        lon,
        lat,
        distanceM: 0,
        durationS: 0,
        instruction: instructionFor(kind, next.name),
      };
      marks.push({ meters, seconds, step });
    }
  }

  const arrive: Step = {
    kind: 'arrive',
    roadName: pieces[pieces.length - 1]?.name ?? '',
    lon: to.lon,
    lat: to.lat,
    distanceM: 0,
    durationS: 0,
    instruction: `Arrive at ${to.name}`,
  };
  marks.push({ meters, seconds, step: arrive });

  // Fill in each step's distance and time to the next step.
  const steps: Step[] = marks.map((mark, i) => {
    const following = marks[i + 1];
    return {
      ...mark.step,
      distanceM: following ? Math.round(following.meters - mark.meters) : 0,
      durationS: following ? Math.round(following.seconds - mark.seconds) : 0,
    };
  });

  const distanceM = meters;
  const durationS = Math.round(seconds);
  const rolled = rollUpDifficulty(parts.map((part) => ({ meters: part.meters, score: part.score })));

  return {
    leg: {
      from,
      to,
      distanceM,
      durationS,
      difficulty: rolled.difficulty,
      geometry,
      steps,
    },
    parts,
  };
}
