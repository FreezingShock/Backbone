// The route as one line in distance and time. Pure functions, no Cesium import, so they run under node in tests.
// Playback moves along the track by time: a route of 30 minutes takes 30 minutes of route time, and the playback
// speed only changes how fast that route time passes on screen.
import type { Leg, LonLat, Route, Step } from './routeTypes';

const EARTH_LAT_M = 110540;
const EARTH_LON_M = 111320;

/** Ground distance in meters over short spans. Equirectangular, accurate well under 1% at route scale. */
export function metersBetween(a: LonLat, b: LonLat): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * EARTH_LON_M * Math.cos(midLat), (b[1] - a[1]) * EARTH_LAT_M);
}

/** Compass heading in radians, clockwise from north, of the segment from a to b. */
export function bearingBetween(a: LonLat, b: LonLat): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = b[1] - a[1];
  return Math.atan2(dx, dy);
}

export interface Track {
  points: LonLat[];
  /** Distance along the track at each point, meters. Same length as `points`. */
  cumM: number[];
  /** Route time at each point, seconds. Same length as `points`. */
  cumS: number[];
  totalM: number;
  totalS: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** Joins the legs into one track. Route time inside a leg is spread over its geometry in proportion to distance. */
export function buildTrack(route: Route): Track {
  const points: LonLat[] = [];
  const cumM: number[] = [];
  const cumS: number[] = [];
  const legs: { geometry: LonLat[]; durationS: number }[] =
    route.legs.length > 0
      ? route.legs.map((leg: Leg) => ({ geometry: leg.geometry, durationS: leg.durationS }))
      : [{ geometry: route.geometry, durationS: route.durationS }];

  let distance = 0;
  let legStartS = 0;
  for (const leg of legs) {
    const geometry = leg.geometry;
    const legS = Number.isFinite(leg.durationS) ? leg.durationS : 0;
    // This leg's own length. Its time is spread over it in proportion to distance.
    let legM = 0;
    for (let i = 1; i < geometry.length; i++) legM += metersBetween(geometry[i - 1], geometry[i]);

    let walked = 0;
    for (let i = 0; i < geometry.length; i++) {
      const point = geometry[i];
      if (i > 0) walked += metersBetween(geometry[i - 1], point);
      if (points.length > 0) {
        // The join point between two legs is shared. Keep it once.
        const last = points[points.length - 1];
        if (last[0] === point[0] && last[1] === point[1]) continue;
        distance += metersBetween(last, point);
      }
      points.push(point);
      cumM.push(distance);
      cumS.push(legStartS + (legM > 0 ? legS * (walked / legM) : 0));
    }
    legStartS += legS;
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return {
    points,
    cumM,
    cumS,
    totalM: distance,
    totalS: legStartS > 0 ? legStartS : route.durationS,
    minLon,
    maxLon,
    minLat,
    maxLat,
  };
}

/** Index of the last entry in the ascending `values` that is <= target. */
function floorIndex(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  if (hi < 0) return 0;
  if (target <= values[0]) return 0;
  if (target >= values[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (values[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where the track is at a given distance: position, heading and the matching route time. */
export interface TrackSample {
  lon: number;
  lat: number;
  /** Heading of the segment under this distance, radians clockwise from north. */
  heading: number;
  seconds: number;
}

/** Writes the track sample at distance `m` into `out`. Clamped to the ends. Reuses `out`, so it does not allocate. */
export function sampleAtDistance(track: Track, m: number, out: TrackSample): TrackSample {
  const { points, cumM, cumS } = track;
  const n = points.length;
  if (n === 0) return out;
  const target = Math.min(Math.max(m, 0), track.totalM);
  if (n === 1) {
    out.lon = points[0][0];
    out.lat = points[0][1];
    out.heading = 0;
    out.seconds = 0;
    return out;
  }
  const i = Math.min(floorIndex(cumM, target), n - 2);
  const a = points[i];
  const b = points[i + 1];
  const span = cumM[i + 1] - cumM[i];
  const f = span > 0 ? (target - cumM[i]) / span : 0;
  out.lon = a[0] + (b[0] - a[0]) * f;
  out.lat = a[1] + (b[1] - a[1]) * f;
  out.heading = bearingBetween(a, b);
  out.seconds = cumS[i] + (cumS[i + 1] - cumS[i]) * f;
  return out;
}

/** Distance along the track for a route time. Route time is the master clock, so this maps it back to meters. */
export function distanceAtSeconds(track: Track, seconds: number): number {
  const { cumS, cumM } = track;
  const n = cumS.length;
  if (n === 0) return 0;
  const target = Math.min(Math.max(seconds, 0), track.totalS);
  const i = Math.min(floorIndex(cumS, target), n - 2);
  if (i < 0) return 0;
  const span = cumS[i + 1] - cumS[i];
  if (!(span > 0)) return cumM[i];
  return cumM[i] + ((cumM[i + 1] - cumM[i]) * (target - cumS[i])) / span;
}

/** Nearest track distance to a point. Linear scan; called once per step when a route starts. */
export function distanceOfPoint(track: Track, lon: number, lat: number): number {
  const { points, cumM } = track;
  let bestM = 0;
  let bestSq = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ax = (a[0] - lon) * EARTH_LON_M * Math.cos((lat * Math.PI) / 180);
    const ay = (a[1] - lat) * EARTH_LAT_M;
    const bx = (b[0] - lon) * EARTH_LON_M * Math.cos((lat * Math.PI) / 180);
    const by = (b[1] - lat) * EARTH_LAT_M;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? Math.min(Math.max(-(ax * dx + ay * dy) / len2, 0), 1) : 0;
    const px = ax + dx * f;
    const py = ay + dy * f;
    const sq = px * px + py * py;
    if (sq < bestSq) {
      bestSq = sq;
      bestM = cumM[i] + (cumM[i + 1] - cumM[i]) * f;
    }
  }
  return bestM;
}

export interface PlacedStep {
  step: Step;
  /** Distance along the track where the maneuver happens, meters. */
  meters: number;
  seconds: number;
}

/** Puts every step on the track, in order of travel. */
export function placeSteps(track: Track, steps: Step[]): PlacedStep[] {
  const sample: TrackSample = { lon: 0, lat: 0, heading: 0, seconds: 0 };
  const placed = steps.map((step) => {
    const meters = distanceOfPoint(track, step.lon, step.lat);
    sampleAtDistance(track, meters, sample);
    return { step, meters, seconds: sample.seconds };
  });
  return placed.sort((a, b) => a.meters - b.meters);
}

/** Track points between two distances, with the end points interpolated. Used for the highlighted stretch of road. */
export function slice(track: Track, fromM: number, toM: number): LonLat[] {
  const out: LonLat[] = [];
  const sample: TrackSample = { lon: 0, lat: 0, heading: 0, seconds: 0 };
  if (toM <= fromM) return out;
  sampleAtDistance(track, fromM, sample);
  out.push([sample.lon, sample.lat]);
  for (let i = 0; i < track.points.length; i++) {
    const m = track.cumM[i];
    if (m > fromM && m < toM) out.push(track.points[i]);
  }
  sampleAtDistance(track, toM, sample);
  out.push([sample.lon, sample.lat]);
  return out;
}

/** Every step that has a time at or before `seconds` belongs to the road already travelled. */
export function currentStepIndex(placed: PlacedStep[], meters: number): number {
  let index = -1;
  for (let i = 0; i < placed.length; i++) {
    if (placed[i].meters <= meters + 0.5) index = i;
    else break;
  }
  return index;
}

/** Normalizes an angle to (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** Moves `current` toward `target` along the shorter arc. `alpha` is 0..1. */
export function lerpAngle(current: number, target: number, alpha: number): number {
  return current + wrapAngle(target - current) * alpha;
}

/** The next `count` placed steps after `index`, with each one's distance ahead of `meters`, in order of travel. */
export function upcomingSteps(placed: PlacedStep[], index: number, meters: number, count: number): { step: Step; meters: number }[] {
  return placed.slice(index + 1, index + 1 + count).map((item) => ({
    step: item.step,
    meters: Math.max(item.meters - meters, 0),
  }));
}
