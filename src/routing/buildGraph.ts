import type { ControlKind, LonLat, RoadClass } from './types';
import { curvatureDegPerKm, metersBetween, polylineMeters } from './geo';
import { encodePolyline } from './polyline';
import { classIndex } from './roadClasses';
import { GRAPH_FILE_VERSION, type ControlRow, type EdgeRow, type GraphFile, type IntersectionRow, type PlaceRow } from './graphFile';

/** Road features as they come from public/data/roads.geojson (Census TIGER, classed by scripts/road-classes.mjs). */
export interface SourceRoad {
  properties: { name?: string; highway?: string; class?: RoadClass; crossing?: string };
  geometry: { coordinates: LonLat[] };
}

/** A traffic control placed by hand or from a source. Snapped to the nearest graph node. */
export interface ControlInput {
  lon: number;
  lat: number;
  kind: ControlKind;
  label: string;
}

export interface BuildInput {
  roads: SourceRoad[];
  controls: ControlInput[];
  places: PlaceRow[];
  source: string;
  /** Controls farther than this from any node are dropped and reported. */
  controlSnapMeters?: number;
}

export interface BuildReport {
  roads: number;
  nodes: number;
  edges: number;
  intersections: number;
  controlsPlaced: number;
  controlsDropped: string[];
}

/** Ways a car does not drive. Kept out of the graph. */
const NON_DRIVABLE = new Set(['footway', 'cycleway', 'path', 'steps', 'pedestrian', 'bridleway']);

const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;
const coordKey = (point: LonLat): string => `${point[0].toFixed(5)},${point[1].toFixed(5)}`;

class Table {
  private readonly index = new Map<string, number>();
  readonly values: string[] = [''];

  add(value: string): number {
    if (!value) return 0;
    const found = this.index.get(value);
    if (found !== undefined) return found;
    const next = this.values.length;
    this.index.set(value, next);
    this.values.push(value);
    return next;
  }
}

/** A drivable road line after cleaning: repeated points merged, non-driving ways dropped. */
export interface Road {
  cls: RoadClass;
  highway: string;
  name: string;
  crossing: string;
  coords: LonLat[];
}

/** Road features that a car can drive, with their points rounded as the graph stores them. */
export function drivableRoads(features: SourceRoad[]): Road[] {
  const roads: Road[] = [];
  for (const feature of features) {
    const cls = feature.properties.class;
    const highway = feature.properties.highway ?? '';
    if (!cls || NON_DRIVABLE.has(highway)) continue;
    const coords: LonLat[] = [];
    for (const [lon, lat] of feature.geometry.coordinates) {
      const point: LonLat = [round5(lon), round5(lat)];
      const last = coords[coords.length - 1];
      if (!last || coordKey(last) !== coordKey(point)) coords.push(point);
    }
    if (coords.length < 2) continue;
    roads.push({ cls, highway, name: feature.properties.name ?? '', crossing: feature.properties.crossing ?? '', coords });
  }
  return roads;
}

/** Compass bearing of a segment in degrees, 0 = north, 90 = east. Good enough for a few metres. */
function bearingOf(from: LonLat, to: LonLat): number {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const dy = to[1] - from[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** The angle between two directions of travel through a point, folded to 0..90 degrees. Straight on is 0. */
function crossingAngle(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  const between = Math.min(diff, 360 - diff);
  return Math.min(between, 180 - between);
}

/** A junction of the drivable roads, with the pairs of road names that cross or meet there. */
export interface Junction {
  /** Names of the named roads that have a point here. */
  names: Set<string>;
  /** Pairs of names whose lines meet at an angle here, e.g. a cross street and the road it meets. */
  crossings: [string, string][];
}

/**
 * The junctions of the drivable roads: the points where routing nodes sit. These are road endpoints, which is how
 * TIGER stores most intersections, plus each inner point where two differently named roads meet at an angle. Some
 * TIGER crossings are a shared vertex in the middle of both lines, with no line ending there. A name change along
 * one straight road is not a junction, and neither is a repeated copy of the same road.
 */
export function junctionKeys(roads: Road[]): Map<string, Junction> {
  const ends = new Set<string>();
  // Per point: the roads through it, with their directions of travel away from the point.
  const through = new Map<string, { name: string; bearings: number[] }[]>();
  for (const road of roads) {
    const last = road.coords.length - 1;
    road.coords.forEach((point, i) => {
      const key = coordKey(point);
      if (i === 0 || i === last) ends.add(key);
      if (!road.name) return;
      const bearings: number[] = [];
      if (i > 0) bearings.push(bearingOf(point, road.coords[i - 1]));
      if (i < last) bearings.push(bearingOf(point, road.coords[i + 1]));
      let list = through.get(key);
      if (!list) through.set(key, (list = []));
      list.push({ name: road.name, bearings });
    });
  }
  const junctions = new Map<string, Junction>();
  for (const [key, list] of through) {
    const names = new Set(list.map((entry) => entry.name));
    const crossings: [string, string][] = [];
    for (let i = 0; i < list.length; i++) {
      for (let k = i + 1; k < list.length; k++) {
        const a = list[i];
        const b = list[k];
        if (a.name === b.name) continue;
        const meet = a.bearings.some((x) => b.bearings.some((y) => crossingAngle(x, y) >= 30));
        if (!meet) continue;
        const pair: [string, string] = a.name < b.name ? [a.name, b.name] : [b.name, a.name];
        if (!crossings.some((c) => c[0] === pair[0] && c[1] === pair[1])) crossings.push(pair);
      }
    }
    if (ends.has(key) || crossings.length > 0) junctions.set(key, { names, crossings });
  }
  for (const key of ends) if (!junctions.has(key)) junctions.set(key, { names: new Set(), crossings: [] });
  return junctions;
}

/**
 * Builds the routing graph from classed road lines. Nodes are road endpoints, which is how TIGER stores
 * intersections, plus any interior point where another road starts. Each road is cut at its nodes into pieces,
 * and each piece becomes one undirected edge. Pure: no file or network access, so it runs in tests.
 */
export function buildGraphFile(input: BuildInput): { file: GraphFile; report: BuildReport } {
  const controlSnapMeters = input.controlSnapMeters ?? 30;

  const roads = drivableRoads(input.roads);
  const endpointKeys = junctionKeys(roads);

  const nodeIndex = new Map<string, number>();
  const nodePoints: LonLat[] = [];
  const nodeOf = (point: LonLat): number => {
    const key = coordKey(point);
    let found = nodeIndex.get(key);
    if (found === undefined) {
      found = nodePoints.length;
      nodeIndex.set(key, found);
      nodePoints.push(point);
    }
    return found;
  };

  const names = new Table();
  const highways = new Table();
  const crossings = new Table();
  const seen = new Set<string>();
  const edges: EdgeRow[] = [];

  for (const road of roads) {
    const last = road.coords.length - 1;
    const cuts = [0];
    for (let i = 1; i < last; i++) if (endpointKeys.has(coordKey(road.coords[i]))) cuts.push(i);
    cuts.push(last);

    for (let c = 1; c < cuts.length; c++) {
      const piece = road.coords.slice(cuts[c - 1], cuts[c] + 1);
      const from = nodeOf(piece[0]);
      const to = nodeOf(piece[piece.length - 1]);
      if (from === to) continue;
      const meters = polylineMeters(piece);
      if (meters < 1) continue;

      // TIGER repeats some roads (one feature per direction or per block). Keep the first copy.
      const dedupeKey = `${Math.min(from, to)}|${Math.max(from, to)}|${road.cls}|${road.name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      edges.push([
        from,
        to,
        encodePolyline(piece),
        Math.round(meters * 10) / 10,
        classIndex(road.cls),
        highways.add(road.highway),
        names.add(road.name),
        crossings.add(road.crossing),
        Math.round(curvatureDegPerKm(piece)),
      ]);
    }
  }

  // Intersections: a junction where a named canyon crossing meets another named crossing or arterial road.
  const CROSSING = classIndex('crossing');
  const ARTERIAL = classIndex('arterial');
  const junctionNames = new Map<number, { crossing: Set<string>; arterial: Set<string> }>();
  for (const edge of edges) {
    const cls = edge[4];
    if (cls !== CROSSING && cls !== ARTERIAL) continue;
    const name = names.values[edge[6]];
    if (!name) continue;
    for (const node of [edge[0], edge[1]]) {
      let entry = junctionNames.get(node);
      if (!entry) junctionNames.set(node, (entry = { crossing: new Set(), arterial: new Set() }));
      (cls === CROSSING ? entry.crossing : entry.arterial).add(name);
    }
  }
  const intersections: IntersectionRow[] = [];
  for (const [node, entry] of junctionNames) {
    if (entry.crossing.size === 0) continue;
    const first = [...entry.crossing].sort()[0];
    const second = [...entry.crossing, ...entry.arterial].filter((n) => n !== first).sort()[0];
    if (!second) continue;
    intersections.push([node, `${first} & ${second}`]);
  }
  intersections.sort((a, b) => a[1].localeCompare(b[1]));

  const controls: ControlRow[] = [];
  const controlsDropped: string[] = [];
  for (const control of input.controls) {
    let best = -1;
    let bestMeters = Infinity;
    for (let i = 0; i < nodePoints.length; i++) {
      const meters = metersBetween([control.lon, control.lat], nodePoints[i]);
      if (meters < bestMeters) {
        bestMeters = meters;
        best = i;
      }
    }
    if (best < 0 || bestMeters > controlSnapMeters) {
      controlsDropped.push(`${control.label}: ${Math.round(bestMeters)} m from the nearest road`);
      continue;
    }
    controls.push([best, control.kind, control.label]);
  }

  const file: GraphFile = {
    version: GRAPH_FILE_VERSION,
    source: input.source,
    nodes: encodePolyline(nodePoints),
    names: names.values,
    highways: highways.values,
    crossings: crossings.values,
    edges,
    intersections,
    controls,
    places: input.places,
  };

  return {
    file,
    report: {
      roads: roads.length,
      nodes: nodePoints.length,
      edges: edges.length,
      intersections: intersections.length,
      controlsPlaced: controls.length,
      controlsDropped,
    },
  };
}
