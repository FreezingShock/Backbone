import type { ControlKind, LonLat, RoadClass } from './types';
import { curvatureDegPerKm, metersBetween, polylineMeters } from './geo';
import { encodePolyline } from './polyline';
import { classIndex } from './roadClasses';
import { joinRoadEnds } from './join';
import { CORRIDOR_NAME, CorridorIndex, pieceTerrain, sampleLine, scoreTerrain, type ElevationLookup } from './mountain';
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
  /** Road ends this close to another road (or to each other) are joined. Default 12 m. */
  joinMeters?: number;
  /**
   * Elevation in meters for a point, from the sampled elevation cache (scripts/fetch-elevation.ts). Without it, grade
   * is left out and mountain scores lean on the other signals.
   */
  elevationAt?: ElevationLookup;
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

/**
 * Builds the routing graph from classed road lines. Road ends that meet with a small gap are joined first (join.ts).
 * Nodes are road endpoints, which is how TIGER stores intersections, plus any interior point where another road
 * starts. Each road is cut at its nodes into pieces, and each piece becomes one undirected edge. Pure: no file or
 * network access, so it runs in tests.
 */
export function buildGraphFile(input: BuildInput): { file: GraphFile; report: BuildReport } {
  const controlSnapMeters = input.controlSnapMeters ?? 30;

  type Road = { cls: RoadClass; highway: string; name: string; crossing: string; coords: LonLat[] };
  const roads: Road[] = [];
  for (const feature of input.roads) {
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

  // Join road ends that meet with a gap in the source (see join.ts). Highway lines are never a join target.
  const joined = roads.map((road) => road.coords);
  joinRoadEnds(joined, roads.map((road) => road.cls !== 'highway'), input.joinMeters ?? 12);
  roads.forEach((road, i) => {
    road.coords = joined[i];
  });
  const usable = roads.filter((road) => road.coords.length >= 2);
  roads.length = 0;
  roads.push(...usable);

  // The 101 corridor: freeway lines by name. Valley roads near these are penalized in canyon routing (mountain.ts).
  const corridor = new CorridorIndex(roads.filter((road) => road.cls === 'highway' && CORRIDOR_NAME.test(road.name)).map((road) => road.coords));

  const endpointKeys = new Set<string>();
  for (const road of roads) {
    endpointKeys.add(coordKey(road.coords[0]));
    endpointKeys.add(coordKey(road.coords[road.coords.length - 1]));
  }

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

      const curvature = curvatureDegPerKm(piece);
      const samples = sampleLine(piece);
      let corridorM = CorridorIndex.CAP_M;
      if (!corridor.empty) for (const [lon, lat] of samples) corridorM = Math.min(corridorM, corridor.distanceM(lon, lat));
      const terrain = pieceTerrain(samples, input.elevationAt);
      const score = scoreTerrain({ cls: road.cls, curvatureDegPerKm: curvature, terrain, corridorM });

      edges.push([
        from,
        to,
        encodePolyline(piece),
        Math.round(meters * 10) / 10,
        classIndex(road.cls),
        highways.add(road.highway),
        names.add(road.name),
        crossings.add(road.crossing),
        Math.round(curvature),
        score.mountain,
        score.corridor ? 1 : 0,
        terrain.gradePct === null ? -1 : Math.round(terrain.gradePct * 10),
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
