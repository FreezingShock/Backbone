// Fetches elevation for every sample point on the routing graph and caches it in scripts/elevation-cache.json, so
// the graph build can score mountains and grade without the network. Run after the road lines change:
//   npm run routing:elevation
// Source: USGS National Elevation Dataset, 10 m, through the public opentopodata.org API (dataset ned10m). Checked
// 2026-10-19: 100 points per request, about one request per second, a 1000 requests per day limit. Cached points are
// never fetched again, so a rerun only asks for new ones.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildGraphFile } from '../src/routing/buildGraph';
import { decodePolyline } from '../src/routing/polyline';
import { elevationKey, sampleLine } from '../src/routing/mountain';
import type { LonLat } from '../src/routing/types';
import { ELEVATION_CACHE, readRoutingInputs } from './routing-inputs';

const ENDPOINT = 'https://api.opentopodata.org/v1/ned10m';
const BATCH = 100;
const GAP_MS = 1100;
const SOURCE = 'USGS National Elevation Dataset 10 m (ned10m) via api.opentopodata.org';

interface CacheFile {
  source: string;
  fetchedAt: string;
  points: Record<string, number | null>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every sample point on every road piece, keyed as the cache keys them. */
function samplePoints(): Map<string, LonLat> {
  const { file } = buildGraphFile({ ...readRoutingInputs() });
  const points = new Map<string, LonLat>();
  for (const row of file.edges) {
    for (const [lon, lat] of sampleLine(decodePolyline(row[2]))) {
      const key = elevationKey(lon, lat);
      if (!points.has(key)) points.set(key, [Number(lon.toFixed(5)), Number(lat.toFixed(5))]);
    }
  }
  return points;
}

async function fetchBatch(batch: LonLat[]): Promise<(number | null)[]> {
  const locations = batch.map(([lon, lat]) => `${lat},${lon}`).join('|');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`${ENDPOINT}?locations=${locations}`);
      if (response.ok) {
        const body = (await response.json()) as { status: string; results: { elevation: number | null }[] };
        if (body.status === 'OK' && body.results.length === batch.length) {
          return body.results.map((result) => (result.elevation === null ? null : Math.round(result.elevation * 10) / 10));
        }
      }
    } catch {
      // Network hiccup: retry below.
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`opentopodata did not answer for a batch starting at ${batch[0][1]},${batch[0][0]}`);
}

const cache: CacheFile = existsSync(ELEVATION_CACHE)
  ? (JSON.parse(readFileSync(ELEVATION_CACHE, 'utf8')) as CacheFile)
  : { source: SOURCE, fetchedAt: '', points: {} };

const wanted = samplePoints();
const missing = [...wanted].filter(([key]) => !(key in cache.points)).map(([, point]) => point);
console.log(`${wanted.size} sample points, ${wanted.size - missing.length} cached, ${missing.length} to fetch`);

const save = () => {
  cache.fetchedAt = new Date().toISOString();
  writeFileSync(ELEVATION_CACHE, JSON.stringify(cache));
};

for (let i = 0; i < missing.length; i += BATCH) {
  const batch = missing.slice(i, i + BATCH);
  const values = await fetchBatch(batch);
  batch.forEach(([lon, lat], j) => {
    cache.points[elevationKey(lon, lat)] = values[j];
  });
  if ((i / BATCH) % 25 === 24) save();
  console.log(`fetched ${Math.min(i + BATCH, missing.length)} of ${missing.length}`);
  if (i + BATCH < missing.length) await sleep(GAP_MS);
}
save();
const nulls = Object.values(cache.points).filter((value) => value === null).length;
console.log(`Wrote ${ELEVATION_CACHE}: ${Object.keys(cache.points).length} points, ${nulls} with no elevation`);
