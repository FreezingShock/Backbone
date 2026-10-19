// Joins road ends that should meet but do not share a point in the source data. Census TIGER/Line often leaves a
// road end a few metres short of the road it meets (a T-junction drawn with a gap), or two ends a metre apart at
// a seam. Without a join the graph has a gap, and a trip that drives straight through reads as "no road route".
//
// Two passes, both in metres on a local flat map:
//   1. Ends within the tolerance of each other are one junction (their centroid).
//   2. An end within the tolerance of another road's middle gets a vertex on that road, so the road is cut there.
// Highway-class lines are never a join target, because freeways run beside local roads and must not be bridged to
// them. A highway line can still have its own ends joined to other roads (ramps meeting surface streets).

import { metersBetween } from './geo';
import type { LonLat } from './types';

const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;
const same = (a: LonLat, b: LonLat): boolean => round5(a[0]) === round5(b[0]) && round5(a[1]) === round5(b[1]);

/** Cell size of the segment index. Large enough that a join query checks only the neighboring cells. */
const SEGMENT_CELL_M = 200;

interface Planar {
  x: number;
  y: number;
}

/**
 * Joins line ends. `lines` holds [lon, lat] coordinates and is changed in place: read the joined lines back from the
 * same array afterwards, since a line that gained a vertex is replaced by a new array. `targetable[i]` says whether
 * line i may receive a junction on its middle (false for highway-class lines). Endpoints are rounded to the same
 * 5-decimal grid the graph builder uses, so a joined end and its target vertex compare equal.
 */
export function joinRoadEnds(lines: LonLat[][], targetable: boolean[], toleranceM = 12): void {
  if (lines.length === 0) return;
  const meanLat = lines.reduce((sum, coords) => sum + coords[0][1], 0) / lines.length;
  const kx = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const ky = 110574;
  const toPlanar = ([lon, lat]: LonLat): Planar => ({ x: lon * kx, y: lat * ky });
  const toLonLat = ({ x, y }: Planar): LonLat => [round5(x / kx), round5(y / ky)];

  // End index: 2 * line for the first point, 2 * line + 1 for the last.
  const endPoint = (end: number): LonLat => {
    const coords = lines[end >> 1];
    return end & 1 ? coords[coords.length - 1] : coords[0];
  };
  const setEnd = (end: number, point: LonLat): void => {
    const coords = lines[end >> 1];
    if (end & 1) coords[coords.length - 1] = point;
    else coords[0] = point;
  };

  // Pass 1: cluster ends that are within the tolerance of each other.
  const endCount = lines.length * 2;
  const parent = Array.from({ length: endCount }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const endCells = new Map<string, number[]>();
  const cellKey = (p: Planar, size: number) => `${Math.floor(p.x / size)},${Math.floor(p.y / size)}`;
  const endPlanar: Planar[] = [];
  for (let end = 0; end < endCount; end++) {
    const p = toPlanar(endPoint(end));
    endPlanar.push(p);
    const key = cellKey(p, toleranceM);
    const bucket = endCells.get(key);
    if (bucket) bucket.push(end);
    else endCells.set(key, [end]);
  }
  for (let end = 0; end < endCount; end++) {
    const p = endPlanar[end];
    const cx = Math.floor(p.x / toleranceM);
    const cy = Math.floor(p.y / toleranceM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of endCells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (other <= end) continue;
          const q = endPlanar[other];
          if (Math.hypot(p.x - q.x, p.y - q.y) <= toleranceM) parent[find(other)] = find(end);
        }
      }
    }
  }
  const clusters = new Map<number, number[]>();
  for (let end = 0; end < endCount; end++) {
    const root = find(end);
    const members = clusters.get(root);
    if (members) members.push(end);
    else clusters.set(root, [end]);
  }
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const sum = members.reduce(
      (acc, end) => {
        const p = endPlanar[end];
        acc.x += p.x;
        acc.y += p.y;
        return acc;
      },
      { x: 0, y: 0 },
    );
    const centroid = toLonLat({ x: sum.x / members.length, y: sum.y / members.length });
    for (const end of members) setEnd(end, centroid);
  }

  // Pass 2: an end near the middle of a targetable line joins it. Index the middle segments of those lines.
  const cells = new Map<string, { line: number; seg: number }[]>();
  lines.forEach((coords, line) => {
    if (!targetable[line]) return;
    for (let seg = 0; seg + 1 < coords.length; seg++) {
      const a = toPlanar(coords[seg]);
      const b = toPlanar(coords[seg + 1]);
      const x0 = Math.floor(Math.min(a.x, b.x) / SEGMENT_CELL_M);
      const x1 = Math.floor(Math.max(a.x, b.x) / SEGMENT_CELL_M);
      const y0 = Math.floor(Math.min(a.y, b.y) / SEGMENT_CELL_M);
      const y1 = Math.floor(Math.max(a.y, b.y) / SEGMENT_CELL_M);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const bucket = cells.get(key);
          if (bucket) bucket.push({ line, seg });
          else cells.set(key, [{ line, seg }]);
        }
      }
    }
  });

  // Where each target line gets a new vertex: [segment index, t along the segment, point].
  const inserts = new Map<number, { seg: number; t: number; point: LonLat }[]>();
  for (let end = 0; end < endCount; end++) {
    const own = end >> 1;
    const p = toPlanar(endPoint(end));
    const cx = Math.floor(p.x / SEGMENT_CELL_M);
    const cy = Math.floor(p.y / SEGMENT_CELL_M);
    let best: { line: number; seg: number; t: number; d: number } | null = null;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const { line, seg } of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (line === own) continue;
          const id = line * 1e6 + seg;
          if (seen.has(id)) continue;
          seen.add(id);
          const a = toPlanar(lines[line][seg]);
          const b = toPlanar(lines[line][seg + 1]);
          const vx = b.x - a.x;
          const vy = b.y - a.y;
          const len2 = vx * vx + vy * vy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
          const d = Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
          if (d <= toleranceM && (!best || d < best.d)) best = { line, seg, t, d };
        }
      }
    }
    if (!best) continue;

    const target = lines[best.line];
    const a = toPlanar(target[best.seg]);
    const b = toPlanar(target[best.seg + 1]);
    const point = toLonLat({ x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t });
    // Within a metre of an existing vertex: use that vertex rather than add a near-duplicate.
    const nearA = metersBetween(point, target[best.seg]) < 1;
    const nearB = metersBetween(point, target[best.seg + 1]) < 1;
    if (nearA || nearB) {
      setEnd(end, nearA ? target[best.seg] : target[best.seg + 1]);
      continue;
    }
    setEnd(end, point);
    const list = inserts.get(best.line);
    const item = { seg: best.seg, t: best.t, point };
    if (list) list.push(item);
    else inserts.set(best.line, [item]);
  }

  for (const [line, list] of inserts) {
    const coords = lines[line];
    list.sort((x, y) => x.seg - y.seg || x.t - y.t);
    const out: LonLat[] = [];
    let next = 0;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) {
        // Points inserted on segment i-1 go between coords[i-1] and coords[i].
        while (next < list.length && list[next].seg === i - 1) {
          const candidate = list[next++].point;
          const last = out[out.length - 1];
          if (!last || !same(last, candidate)) out.push(candidate);
        }
      }
      const last = out[out.length - 1];
      if (!last || !same(last, coords[i])) out.push(coords[i]);
    }
    lines[line] = out;
  }
}
