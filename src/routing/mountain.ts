// Mountain scoring for Canyon Cutting. Pure functions, no file or network access, so the graph build and the tests
// share them. Each road piece gets a 0 to 100 mountain score from open signals: its elevation above the valley floor
// (USGS NED, sampled by scripts/fetch-elevation.ts), its distance from the 101 freeway corridor, its curvature and
// grade, and whether it is one of the named canyon roads (the crossing class in scripts/road-classes.mjs).
import type { LonLat, RoadClass } from './types';
import { metersBetween } from './geo';

/** Freeway names that make up the 101 corridor. Roads near these in the valley get the strongest penalty. */
export const CORRIDOR_NAME = /^(US Hwy 101|Ventura Fwy|Hollywood Fwy|US Hwy 101 Bus)/i;

/** Elevation and grade are sampled along each road piece at this spacing, in meters. */
export const SAMPLE_STEP_M = 250;
/** Elevation at or below this is valley floor for the score. Metres above sea level. */
export const VALLEY_FLOOR_M = 200;
/** Elevation at or above this scores full height. Metres above sea level. */
export const RIDGE_M = 500;
/** Within this distance of the 101 the valley penalty on distance is zero. Meters. */
export const CORRIDOR_NEAR_M = 800;
/** Beyond this distance from the 101 the distance term is full. Meters. */
export const CORRIDOR_FAR_M = 3300;
/** A non-canyon road this close to the 101 at valley elevation is part of the corridor. Meters. */
export const CORRIDOR_VALLEY_M = 1500;
/** Search weight on a valley road beside the 101 in canyon routing. */
export const CORRIDOR_WEIGHT = 5;
/**
 * Search weight on a freeway in canyon routing. Above the corridor weight, so a valley road that gets a car off the
 * freeway is cheaper than the freeway itself, and a route cannot climb out of the valley on the 101.
 */
export const FREEWAY_MOUNTAIN_WEIGHT = 8;
/** A road piece scoring at least this counts as a mountain road in a route's mountainShare. */
export const MOUNTAIN_ROAD_MIN = 50;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Points along a polyline, every `stepM` meters of arc length, always including both ends. Spacing is measured along
 * the line, not per vertex, so a densely drawn road is not sampled more often than a straight one. Interpolated points
 * are not rounded, so callers that look elevations up by coordinate must round the key (see elevationKey).
 */
export function sampleLine(points: LonLat[], stepM: number = SAMPLE_STEP_M): LonLat[] {
  if (points.length === 0) return [];
  const out: LonLat[] = [points[0]];
  // Meters travelled since the last emitted point.
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = metersBetween(a, b);
    if (length === 0) continue;
    // Distance along this piece of the next point to emit.
    let next = stepM - carried;
    while (next <= length) {
      const t = next / length;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += stepM;
    }
    carried = length - (next - stepM);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

/** Cache key for an elevation sample: five decimals, about one metre. */
export function elevationKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

/** Elevation in metres for a point, or null when none is known. */
export type ElevationLookup = (lon: number, lat: number) => number | null;

/** Elevation and grade of one road piece. Null when no sample had a value. */
export interface PieceTerrain {
  meanElevM: number | null;
  /** Mean steepness in percent, length-weighted: total absolute rise over total run. */
  gradePct: number | null;
}

/** Samples a road piece's elevation and works out its mean height and steepness. */
export function pieceTerrain(samples: LonLat[], elevationAt: ElevationLookup | undefined): PieceTerrain {
  if (!elevationAt) return { meanElevM: null, gradePct: null };
  let sum = 0;
  let count = 0;
  let rise = 0;
  let run = 0;
  let previous: { z: number; point: LonLat } | null = null;
  for (const point of samples) {
    const z = elevationAt(point[0], point[1]);
    if (z === null) {
      previous = null;
      continue;
    }
    sum += z;
    count++;
    if (previous) {
      rise += Math.abs(z - previous.z);
      run += metersBetween(previous.point, point);
    }
    previous = { z, point };
  }
  if (count === 0) return { meanElevM: null, gradePct: null };
  return {
    meanElevM: sum / count,
    gradePct: run > 0 ? (100 * rise) / run : null,
  };
}

/** Nearest-vertex lookup for the 101 corridor. Cells are 0.01 degrees, about 1 km. */
export class CorridorIndex {
  private readonly cells = new Map<number, LonLat[]>();
  private readonly cellDeg = 0.01;
  /** Anything farther than this reads as this. Meters. */
  static readonly CAP_M = CORRIDOR_FAR_M + 1000;
  /** Cells this many steps away cover the cap, with a little to spare. */
  private static readonly RINGS = 5;

  constructor(lines: LonLat[][]) {
    for (const line of lines) {
      for (const point of line) {
        const key = this.keyOf(Math.floor(point[0] / this.cellDeg), Math.floor(point[1] / this.cellDeg));
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(point);
        else this.cells.set(key, [point]);
      }
    }
  }

  get empty(): boolean {
    return this.cells.size === 0;
  }

  /** Distance in meters to the nearest corridor vertex, capped at CAP_M. */
  distanceM(lon: number, lat: number): number {
    if (this.cells.size === 0) return CorridorIndex.CAP_M;
    const cx = Math.floor(lon / this.cellDeg);
    const cy = Math.floor(lat / this.cellDeg);
    const rings = CorridorIndex.RINGS;
    let best = CorridorIndex.CAP_M;
    for (let dx = -rings; dx <= rings; dx++) {
      for (let dy = -rings; dy <= rings; dy++) {
        const bucket = this.cells.get(this.keyOf(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const point of bucket) {
          const meters = metersBetween([lon, lat], point);
          if (meters < best) best = meters;
        }
      }
    }
    return best;
  }

  /** One number per cell: the grid is far smaller than 2^20 in each direction. */
  private keyOf(cx: number, cy: number): number {
    return (cx + 1000000) * 2000000 + (cy + 1000000);
  }
}

export interface TerrainInput {
  cls: RoadClass;
  curvatureDegPerKm: number;
  terrain: PieceTerrain;
  /** Closest distance from any sample on the piece to the 101 corridor, in meters. */
  corridorM: number;
}

export interface TerrainScore {
  /** 0 (valley flat beside the freeway) to 100 (a high, steep, winding canyon or ridge road). Highways are 0. */
  mountain: number;
  /** True for a valley road beside the 101 that is not a named canyon. Priced at CORRIDOR_WEIGHT in canyon routing. */
  corridor: boolean;
}

/**
 * Scores one road piece. Weights (sum 1 before the canyon bonus): height above the valley floor 0.35, distance from
 * the 101 corridor 0.25, curvature 0.10, steepness 0.10, and a named canyon crossing 0.30. A missing elevation is
 * treated as halfway up, so the score falls back on the other signals rather than guessing.
 */
export function scoreTerrain(input: TerrainInput): TerrainScore {
  if (input.cls === 'highway') return { mountain: 0, corridor: false };
  const { meanElevM, gradePct } = input.terrain;
  const height = meanElevM === null ? 0.5 : clamp01((meanElevM - VALLEY_FLOOR_M) / (RIDGE_M - VALLEY_FLOOR_M));
  const far = clamp01((input.corridorM - CORRIDOR_NEAR_M) / (CORRIDOR_FAR_M - CORRIDOR_NEAR_M));
  const winding = clamp01(input.curvatureDegPerKm / 150);
  const steep = gradePct === null ? 0 : clamp01(gradePct / 6);
  const canyon = input.cls === 'crossing' ? 1 : 0;
  const raw = 0.35 * height + 0.25 * far + 0.1 * winding + 0.1 * steep + 0.3 * canyon;
  const corridor = input.cls !== 'crossing' && input.corridorM < CORRIDOR_VALLEY_M && height < 0.5;
  return { mountain: Math.round(100 * clamp01(raw)), corridor };
}

/**
 * Search weight for one road piece in canyon mode, as a multiple of its drive time. Mountain roads cost about 0.8 to 1.3,
 * valley roads near the freeway cost CORRIDOR_WEIGHT, and everything else falls between. Never below 0.8, which keeps
 * the A* heuristic admissible (see search.ts).
 */
export function mountainWeight(mountain: number, corridor: boolean): number {
  if (corridor) return CORRIDOR_WEIGHT;
  const valley = 1 - mountain / 100;
  return 0.8 + 2.2 * valley * valley;
}
