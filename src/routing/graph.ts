import type { ControlKind, LonLat, RoadClass } from './types';
import { metersBetween } from './geo';
import { decodePolyline } from './polyline';
import { ROAD_CLASS_ORDER } from './roadClasses';
import { GRAPH_FILE_VERSION, type GraphFile, type PlaceRow } from './graphFile';
import { classSpeedMph, pieceSpeedMs } from './speed';

/**
 * The routing graph in memory, as typed arrays for fast search. Built once from the graph file. Nodes are
 * junctions, and each edge is one undirected road piece. Edge direction is a bit in the adjacency list:
 * `ref = edge * 2` runs from the edge's `from` node to its `to` node, and `ref = edge * 2 + 1` runs back.
 */
export class RoutingGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  readonly edgeFrom: Int32Array;
  readonly edgeTo: Int32Array;
  readonly edgeMeters: Float64Array;
  readonly edgeClass: Uint8Array;
  readonly edgeHighway: Uint16Array;
  readonly edgeName: Uint16Array;
  readonly edgeCrossing: Uint16Array;
  readonly edgeCurvature: Float64Array;
  /** Mountain score, 0 to 100 (mountain.ts). Highways are 0. */
  readonly edgeMountain: Uint8Array;
  /** 1 for a valley road beside the 101 (CORRIDOR_WEIGHT applies in canyon routing), else 0. */
  readonly edgeCorridor: Uint8Array;
  /** Steepness in percent, or -1 when the piece has no elevation. Read it with gradeOf. */
  readonly edgeGradePct: Float64Array;
  /** Pre-computed free-flow speed (m/s) for each edge, the curve limit included. */
  readonly edgeSpeedMs: Float64Array;
  readonly edgeGeometry: string[];
  /** Node-to-edge adjacency in compressed form: adjacent refs for node n are adjacency[offset[n]..offset[n+1]). */
  readonly adjacencyOffset: Int32Array;
  readonly adjacency: Int32Array;
  /** 1 when a node has at least one edge that is not a highway. Used to snap stops away from freeway ramps. */
  readonly surfaceNode: Uint8Array;
  readonly controls: Map<number, { kind: ControlKind; label: string }>;
  readonly intersections: { node: number; label: string }[];
  readonly places: PlaceRow[];
  readonly names: string[];
  readonly highways: string[];
  readonly crossings: string[];
  readonly source: string;

  private constructor(file: GraphFile) {
    const nodePoints = decodePolyline(file.nodes);
    this.nodeCount = nodePoints.length;
    this.edgeCount = file.edges.length;
    this.lon = new Float64Array(this.nodeCount);
    this.lat = new Float64Array(this.nodeCount);
    nodePoints.forEach(([x, y], i) => {
      this.lon[i] = x;
      this.lat[i] = y;
    });

    const m = this.edgeCount;
    this.edgeFrom = new Int32Array(m);
    this.edgeTo = new Int32Array(m);
    this.edgeMeters = new Float64Array(m);
    this.edgeClass = new Uint8Array(m);
    this.edgeHighway = new Uint16Array(m);
    this.edgeName = new Uint16Array(m);
    this.edgeCrossing = new Uint16Array(m);
    this.edgeCurvature = new Float64Array(m);
    this.edgeMountain = new Uint8Array(m);
    this.edgeCorridor = new Uint8Array(m);
    this.edgeGradePct = new Float64Array(m);
    this.edgeSpeedMs = new Float64Array(m);
    this.edgeGeometry = new Array<string>(m);

    const degree = new Int32Array(this.nodeCount + 1);
    file.edges.forEach((row, e) => {
      const [from, to, poly, meters, cls, hw, name, crossing, curvature, mountain, corridor, gradeTenths] = row;
      this.edgeFrom[e] = from;
      this.edgeTo[e] = to;
      this.edgeMeters[e] = meters;
      this.edgeClass[e] = cls;
      this.edgeHighway[e] = hw;
      this.edgeName[e] = name;
      this.edgeCrossing[e] = crossing;
      this.edgeCurvature[e] = curvature;
      this.edgeMountain[e] = mountain;
      this.edgeCorridor[e] = corridor;
      this.edgeGradePct[e] = gradeTenths < 0 ? -1 : gradeTenths / 10;
      this.edgeGeometry[e] = poly;
      const cls2: RoadClass = ROAD_CLASS_ORDER[cls];
      this.edgeSpeedMs[e] = pieceSpeedMs(cls2, file.highways[hw] ?? '', curvature);
      degree[from]++;
      degree[to]++;
    });

    this.adjacencyOffset = new Int32Array(this.nodeCount + 1);
    for (let n = 0; n < this.nodeCount; n++) this.adjacencyOffset[n + 1] = this.adjacencyOffset[n] + degree[n];
    this.adjacency = new Int32Array(this.adjacencyOffset[this.nodeCount]);
    const fill = new Int32Array(this.nodeCount);
    for (let e = 0; e < m; e++) {
      const from = this.edgeFrom[e];
      const to = this.edgeTo[e];
      this.adjacency[this.adjacencyOffset[from] + fill[from]++] = e * 2;
      this.adjacency[this.adjacencyOffset[to] + fill[to]++] = e * 2 + 1;
    }

    this.surfaceNode = new Uint8Array(this.nodeCount);
    for (let e = 0; e < m; e++) {
      if (this.edgeClass[e] === 0) continue;
      this.surfaceNode[this.edgeFrom[e]] = 1;
      this.surfaceNode[this.edgeTo[e]] = 1;
    }

    this.controls = new Map();
    for (const [node, kind, label] of file.controls) this.controls.set(node, { kind, label });
    this.intersections = file.intersections.map(([node, label]) => ({ node, label }));
    this.places = file.places;
    this.names = file.names;
    this.highways = file.highways;
    this.crossings = file.crossings;
    this.source = file.source;
  }

  static fromFile(file: GraphFile): RoutingGraph {
    if (file.version !== GRAPH_FILE_VERSION) {
      throw new Error(`Routing graph version ${file.version} is not ${GRAPH_FILE_VERSION}. Rebuild it with npm run routing:build.`);
    }
    return new RoutingGraph(file);
  }

  /** Other end of an adjacency ref, and the edge it belongs to. */
  endOf(ref: number): number {
    const e = ref >> 1;
    return ref & 1 ? this.edgeFrom[e] : this.edgeTo[e];
  }

  startOf(ref: number): number {
    const e = ref >> 1;
    return ref & 1 ? this.edgeTo[e] : this.edgeFrom[e];
  }

  /** Geometry of an edge in the direction of its ref, [lon, lat] points. */
  geometryOf(ref: number): LonLat[] {
    const points = decodePolyline(this.edgeGeometry[ref >> 1]);
    return ref & 1 ? points.reverse() : points;
  }

  nodePoint(node: number): LonLat {
    return [this.lon[node], this.lat[node]];
  }

  classOf(edge: number): RoadClass {
    return ROAD_CLASS_ORDER[this.edgeClass[edge]];
  }

  highwayOf(edge: number): string {
    return this.highways[this.edgeHighway[edge]] ?? '';
  }

  nameOf(edge: number): string {
    return this.names[this.edgeName[edge]] ?? '';
  }

  crossingOf(edge: number): string {
    return this.crossings[this.edgeCrossing[edge]] ?? '';
  }

  /** Steepness in percent, or null when the piece has no elevation. */
  gradeOf(edge: number): number | null {
    const grade = this.edgeGradePct[edge];
    return grade < 0 ? null : grade;
  }

  /** Mph for display, from the class table. */
  speedMphOf(edge: number): number {
    return classSpeedMph(this.classOf(edge), this.highwayOf(edge));
  }

  /**
   * The nearest node to a point. Prefers junctions with a non-freeway road, so a stop is not snapped onto a ramp
   * unless nothing else is within `surfaceFallbackMeters`. Linear scan: fine for a handful of stops.
   */
  nearestNode(lon: number, lat: number, surfaceFallbackMeters = 1500): { node: number; meters: number } | null {
    let best = -1;
    let bestMeters = Infinity;
    let bestSurface = -1;
    let bestSurfaceMeters = Infinity;
    for (let n = 0; n < this.nodeCount; n++) {
      const meters = metersBetween([lon, lat], [this.lon[n], this.lat[n]]);
      if (meters < bestMeters) {
        bestMeters = meters;
        best = n;
      }
      if (this.surfaceNode[n] && meters < bestSurfaceMeters) {
        bestSurfaceMeters = meters;
        bestSurface = n;
      }
    }
    if (bestSurface >= 0 && bestSurfaceMeters <= Math.max(surfaceFallbackMeters, bestMeters)) {
      return { node: bestSurface, meters: bestSurfaceMeters };
    }
    return best >= 0 ? { node: best, meters: bestMeters } : null;
  }
}
