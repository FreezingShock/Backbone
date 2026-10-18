// Shortest paths over the road hierarchy. Pure functions with no Cesium import, so they run under node in tests.
// Edges are built from the road features in public/data/roads.geojson. Two roads share a node when their
// endpoints have the same rounded coordinates, which is how Census TIGER/Line stores intersections.

export const ROAD_CLASSES = ['highway', 'crossing', 'arterial', 'collector', 'local'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export type LonLat = [number, number];

export interface RoadFeature {
  properties: { name?: string; highway?: string; class?: RoadClass; crossing?: string };
  geometry: { coordinates: LonLat[] };
}

export interface RoadEdge {
  to: string;
  meters: number;
  name: string;
  cls: RoadClass;
  crossing?: string;
}

export interface RoadGraph {
  nodes: Map<string, LonLat>;
  adjacency: Map<string, RoadEdge[]>;
}

export interface RouteStop {
  name: string;
  lon: number;
  lat: number;
}

export interface SnappedStop extends RouteStop {
  /** Graph node the stop was snapped to, as `lon,lat`. */
  node: string;
  /** Distance from the stop's coordinates to that node. */
  snapMeters: number;
}

export interface RouteLeg {
  from: SnappedStop;
  to: SnappedStop;
  /** Node keys from `from` to `to`, inclusive. */
  path: string[];
  edges: RoadEdge[];
  meters: number;
}

export interface PlannedRoute {
  stops: SnappedStop[];
  legs: RouteLeg[];
  meters: number;
}

export function nodeKey([lon, lat]: LonLat): string {
  return `${lon},${lat}`;
}

/** Ground distance in meters. Equirectangular, which is accurate to well under 1% at these scales. */
export function metersBetween(a: LonLat, b: LonLat): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111320 * Math.cos(midLat);
  const dy = (b[1] - a[1]) * 110540;
  return Math.hypot(dx, dy);
}

export function buildRoadGraph(features: RoadFeature[], include: (cls: RoadClass) => boolean): RoadGraph {
  const nodes = new Map<string, LonLat>();
  const adjacency = new Map<string, RoadEdge[]>();
  const link = (from: string, to: string, edge: Omit<RoadEdge, 'to'>) => {
    const list = adjacency.get(from);
    if (list) list.push({ ...edge, to });
    else adjacency.set(from, [{ ...edge, to }]);
  };

  for (const feature of features) {
    const cls = feature.properties.class;
    if (!cls || !include(cls)) continue;
    const name = feature.properties.name ?? '';
    const crossing = feature.properties.crossing;
    const coords = feature.geometry.coordinates;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const keyA = nodeKey(a);
      const keyB = nodeKey(b);
      if (keyA === keyB) continue;
      nodes.set(keyA, a);
      nodes.set(keyB, b);
      const meters = metersBetween(a, b);
      const shared = { meters, name, cls, ...(crossing ? { crossing } : {}) };
      link(keyA, keyB, shared);
      link(keyB, keyA, shared);
    }
  }
  return { nodes, adjacency };
}

/** The graph node closest to a point, or null when the graph is empty. Linear scan: fine for a few stops. */
export function nearestNode(graph: RoadGraph, lon: number, lat: number): { key: string; meters: number } | null {
  let best: { key: string; meters: number } | null = null;
  for (const [key, point] of graph.nodes) {
    const meters = metersBetween([lon, lat], point);
    if (!best || meters < best.meters) best = { key, meters };
  }
  return best;
}

/** Min-heap of [cost, node] pairs for Dijkstra. */
class MinHeap {
  private items: [number, string][] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: [number, string]): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): [number, string] | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/** Shortest path by road length, or null when the two nodes are not connected in this graph. */
export function shortestPath(graph: RoadGraph, from: string, to: string): { path: string[]; edges: RoadEdge[]; meters: number } | null {
  const cost = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, { node: string; edge: RoadEdge }>();
  const heap = new MinHeap();
  heap.push([0, from]);

  while (heap.size > 0) {
    const [best, node] = heap.pop()!;
    if (node === to) break;
    if (best > (cost.get(node) ?? Infinity)) continue;
    for (const edge of graph.adjacency.get(node) ?? []) {
      const next = best + edge.meters;
      if (next < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, next);
        previous.set(edge.to, { node, edge });
        heap.push([next, edge.to]);
      }
    }
  }

  if (!cost.has(to)) return null;
  const path = [to];
  const edges: RoadEdge[] = [];
  for (let node = to; node !== from; ) {
    const step = previous.get(node)!;
    edges.push(step.edge);
    path.push(step.node);
    node = step.node;
  }
  path.reverse();
  edges.reverse();
  return { path, edges, meters: cost.get(to)! };
}

/**
 * Plans a route through stops in order. Each stop snaps to the nearest graph node.
 * Throws when two consecutive stops cannot be joined in this graph.
 */
export function planRoute(graph: RoadGraph, stops: RouteStop[]): PlannedRoute {
  const snapped: SnappedStop[] = stops.map((stop) => {
    const near = nearestNode(graph, stop.lon, stop.lat);
    if (!near) throw new Error(`No road near ${stop.name}`);
    return { ...stop, node: near.key, snapMeters: near.meters };
  });

  const legs: RouteLeg[] = [];
  for (let i = 1; i < snapped.length; i++) {
    const from = snapped[i - 1];
    const to = snapped[i];
    const found = shortestPath(graph, from.node, to.node);
    if (!found) throw new Error(`No road path from ${from.name} to ${to.name}`);
    legs.push({ from, to, path: found.path, edges: found.edges, meters: found.meters });
  }
  return { stops: snapped, legs, meters: legs.reduce((sum, leg) => sum + leg.meters, 0) };
}

/** Coordinates along a planned route, one entry per graph node, for drawing. */
export function routeCoordinates(graph: RoadGraph, route: PlannedRoute): LonLat[] {
  const coords: LonLat[] = [];
  for (const leg of route.legs) {
    for (const key of leg.path) {
      const point = graph.nodes.get(key);
      if (!point) continue;
      if (coords.length === 0 || nodeKey(coords[coords.length - 1]) !== key) coords.push(point);
    }
  }
  return coords;
}
