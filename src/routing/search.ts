import { metersBetween } from './geo';
import type { RoutingGraph } from './graph';
import { controlDelayS, MAX_SPEED_MS } from './speed';

export interface PathResult {
  /** Adjacency refs from start to goal, each one a directed edge (see RoutingGraph). */
  refs: number[];
  /** Search cost in seconds: driving time plus control delays. Turn delays are added later, per step. */
  seconds: number;
  meters: number;
}

/** A min-heap of [priority, node] pairs. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly nodes: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, node: number): void {
    const keys = this.keys;
    const nodes = this.nodes;
    keys.push(key);
    nodes.push(node);
    let i = keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= keys[i]) break;
      [keys[parent], keys[i]] = [keys[i], keys[parent]];
      [nodes[parent], nodes[i]] = [nodes[i], nodes[parent]];
      i = parent;
    }
  }

  /** Removes the smallest entry. Call only when size > 0. */
  pop(): { key: number; node: number } {
    const keys = this.keys;
    const nodes = this.nodes;
    const top = { key: keys[0], node: nodes[0] };
    const lastKey = keys.pop()!;
    const lastNode = nodes.pop()!;
    if (keys.length > 0) {
      keys[0] = lastKey;
      nodes[0] = lastNode;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < keys.length && keys[left] < keys[smallest]) smallest = left;
        if (right < keys.length && keys[right] < keys[smallest]) smallest = right;
        if (smallest === i) break;
        [keys[smallest], keys[i]] = [keys[i], keys[smallest]];
        [nodes[smallest], nodes[i]] = [nodes[i], nodes[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * A* over the road graph, minimizing driving time. `allow` decides which edges may be used, which is how
 * highways are kept out. The heuristic is straight-line distance at the fastest speed the graph allows, so it
 * never overestimates and the first path found to the goal is the fastest.
 */
export function findPath(graph: RoutingGraph, start: number, goal: number, allow: (edge: number) => boolean): PathResult | null {
  if (start === goal) return { refs: [], seconds: 0, meters: 0 };

  const goalLon = graph.lon[goal];
  const goalLat = graph.lat[goal];
  const heuristic = (node: number): number => metersBetween([graph.lon[node], graph.lat[node]], [goalLon, goalLat]) / MAX_SPEED_MS;

  const cost = new Float64Array(graph.nodeCount).fill(Infinity);
  const meters = new Float64Array(graph.nodeCount);
  const via = new Int32Array(graph.nodeCount).fill(-1);
  const heap = new MinHeap();

  cost[start] = 0;
  heap.push(heuristic(start), start);

  while (heap.size > 0) {
    const { key, node } = heap.pop();
    if (node === goal) break;
    const g = cost[node];
    if (key > g + heuristic(node) + 1e-9) continue;

    for (let i = graph.adjacencyOffset[node]; i < graph.adjacencyOffset[node + 1]; i++) {
      const ref = graph.adjacency[i];
      const edge = ref >> 1;
      if (!allow(edge)) continue;
      const next = graph.endOf(ref);
      const pieceSeconds = graph.edgeMeters[edge] / graph.edgeSpeedMs[edge];
      const delay = graph.controls.get(next);
      const candidate = g + pieceSeconds + (delay ? controlDelayS(delay.kind) : 0);
      if (candidate < cost[next]) {
        cost[next] = candidate;
        meters[next] = meters[node] + graph.edgeMeters[edge];
        via[next] = ref;
        heap.push(candidate + heuristic(next), next);
      }
    }
  }

  if (!Number.isFinite(cost[goal])) return null;

  const refs: number[] = [];
  for (let node = goal; node !== start; ) {
    const ref = via[node];
    refs.push(ref);
    node = graph.startOf(ref);
  }
  refs.reverse();
  return { refs, seconds: cost[goal], meters: meters[goal] };
}
