// Builds scripts/routing-controls.json from OpenStreetMap: stop signs (highway=stop) and traffic signals
// (highway=traffic_signals) in the road box. Run from the repo root: npm run routing:controls
//
// Source: OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright). Fetched through an
// Overpass API mirror. The box is the one scripts/build-roads.mjs clips to, so the controls match the roads.
// A node is kept only when it sits within CONTROL_SNAP_M of a junction the routing graph will have, using the
// same junction rule as src/routing/buildGraph.ts. One control is kept per junction. Each control is labeled with
// the names of the roads that meet at its junction, e.g. "Topanga Canyon Blvd & Ventura Blvd".
//
// Usage:
//   npm run routing:controls                          query the Overpass mirrors (network needed)
//   npx -y tsx scripts/fetch-routing-controls.ts --from FILE   read a saved Overpass JSON response instead
//   npx -y tsx scripts/fetch-routing-controls.ts --cache DIR   keep each tile's raw response in DIR, reuse them
// Run `npm run routing:build` afterwards to rebuild public/data/routing-graph.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { junctionKeys, routingRoads, type Junction, type SourceRoad } from '../src/routing/buildGraph';
import type { ControlKind, LonLat } from '../src/routing/types';

// Same box as scripts/build-roads.mjs (and the graticule in src/layers/graticule.ts). Keep them in step.
const BBOX = { south: 33.98, west: -118.95, north: 34.2, east: -118.5 };
const TILES = 4; // The box is split into TILES x TILES queries, so no single request runs long.
const CONCURRENT = 4;
const CONTROL_SNAP_M = 30; // Matches controlSnapMeters in src/routing/buildGraph.ts.
const ROADS = 'public/data/roads.geojson';
const OUT = 'scripts/routing-controls.json';

// Tried in order. maps.mail.ru answered with fresh data when this was written. overpass.osm.ch was left out:
// it answered with an empty result from a stale database (osm base 117831) when checked. Overpass-api.de and
// overpass.kumi.systems were down or returned 500, 503 and 429 when checked.
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const KIND: Record<string, ControlKind> = { stop: 'stop-sign', traffic_signals: 'traffic-signal' };

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: { highway?: string };
}
interface OverpassResponse {
  elements: OverpassNode[];
  osm3s?: { timestamp_osm_base?: string };
  mirror?: string;
}
interface Tile {
  south: number;
  north: number;
  west: number;
  east: number;
}
interface ControlRow {
  id: string;
  kind: ControlKind;
  label: string;
  lon: number;
  lat: number;
}

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};
const fromFile = argValue('--from');
const cacheDir = argValue('--cache');

const overpassQuery = ({ south, west, north, east }: Tile): string =>
  `[out:json][timeout:180];(node["highway"="stop"](${south},${west},${north},${east});node["highway"="traffic_signals"](${south},${west},${north},${east}););out body;`;

async function queryTile(tile: Tile): Promise<{ json: OverpassResponse; url: string }> {
  const body = new URLSearchParams({ data: overpassQuery(tile) });
  let lastError = '';
  let empty: { json: OverpassResponse; url: string } | null = null;
  for (const url of ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(240_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as OverpassResponse;
        // An empty answer can come from a stale or broken mirror, so ask the next one before accepting it.
        if (json.elements.length === 0) {
          empty = { json, url };
          console.warn(`empty answer from ${url} for ${JSON.stringify(tile)}; trying the next mirror`);
          break;
        }
        return { json, url };
      } catch (error) {
        lastError = `${url}: ${(error as Error).message}`;
        console.warn(`retry ${attempt} ${lastError}`);
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }
  if (empty) return empty;
  throw new Error(`No Overpass mirror answered for tile ${JSON.stringify(tile)}. Last error: ${lastError}`);
}

// Reads a tile from the cache when there is one, otherwise queries the mirrors and saves the answer there.
async function cachedTile(tile: Tile, index: string): Promise<{ json: OverpassResponse; url: string }> {
  const path = cacheDir ? join(cacheDir, `tile-${index}.json`) : null;
  if (path && existsSync(path)) {
    const json = JSON.parse(readFileSync(path, 'utf8')) as OverpassResponse;
    return { json, url: json.mirror ?? 'cache' };
  }
  const result = await queryTile(tile);
  if (path) writeFileSync(path, JSON.stringify({ ...result.json, mirror: result.url }));
  return result;
}

async function fetchElements(): Promise<{ elements: OverpassNode[]; osmBases: string; source: string }> {
  if (fromFile) {
    const json = JSON.parse(readFileSync(fromFile, 'utf8')) as OverpassResponse;
    return { elements: json.elements as OverpassNode[], osmBases: json.osm3s?.timestamp_osm_base ?? '', source: `saved file ${fromFile}` };
  }
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const tiles: { index: string; tile: Tile }[] = [];
  const rows = (BBOX.north - BBOX.south) / TILES;
  const cols = (BBOX.east - BBOX.west) / TILES;
  for (let i = 0; i < TILES; i++) {
    for (let j = 0; j < TILES; j++) {
      tiles.push({
        index: `${i}-${j}`,
        tile: {
          south: +(BBOX.south + rows * i).toFixed(5),
          north: +(BBOX.south + rows * (i + 1)).toFixed(5),
          west: +(BBOX.west + cols * j).toFixed(5),
          east: +(BBOX.west + cols * (j + 1)).toFixed(5),
        },
      });
    }
  }
  const byId = new Map<number, OverpassNode>();
  const osmBases = new Set<string>();
  const mirrors = new Set<string>();
  // A few tiles at a time, so one slow answer does not hold up the rest.
  for (let start = 0; start < tiles.length; start += CONCURRENT) {
    const batch = tiles.slice(start, start + CONCURRENT);
    const results = await Promise.all(batch.map(({ tile, index }) => cachedTile(tile, index)));
    results.forEach(({ json, url }, k) => {
      if (json.osm3s?.timestamp_osm_base) osmBases.add(json.osm3s.timestamp_osm_base);
      mirrors.add(url);
      for (const element of json.elements as OverpassNode[]) byId.set(element.id, element);
      console.log(`tile ${batch[k].index}: ${json.elements.length} nodes (${url})`);
    });
  }
  return { elements: [...byId.values()], osmBases: [...osmBases].sort().join(', '), source: [...mirrors].join(', ') };
}

const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;
const keyOf = (lon: number, lat: number): string => `${lon.toFixed(5)},${lat.toFixed(5)}`;

// Metres between two points, equirectangular. Good to well under 1% at this size.
function metersBetween(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const mid = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lon2 - lon1) * 111_320 * Math.cos(mid);
  const dy = (lat2 - lat1) * 110_574;
  return Math.hypot(dx, dy);
}

interface IndexedJunction extends Junction {
  lon: number;
  lat: number;
}

// Main roads first, so a label names the arterials and crossings before the streets.
const CLASS_RANK: Record<string, number> = { crossing: 0, arterial: 1, collector: 2, local: 3, highway: 4 };

// Best road class for each road name, set while the junctions are indexed.
let rankOf = new Map<string, number>();

// The label for a junction: the pair of roads that cross there, the most important first (crossings, then
// arterials, then streets), or the two most important names when no two lines meet at an angle.
function junctionLabel(junction: Junction): string {
  const score = (name: string) => rankOf.get(name) ?? 9;
  const byImportance = (a: string, b: string) => score(a) - score(b) || a.localeCompare(b);
  const pairs = junction.crossings.map((pair) => [...pair].sort(byImportance) as [string, string]);
  if (pairs.length > 0) {
    pairs.sort((a, b) => score(a[0]) + score(a[1]) - score(b[0]) - score(b[1]) || `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`));
    return pairs[0].join(' & ');
  }
  return [...junction.names].sort(byImportance).slice(0, 2).join(' & ');
}

// The junctions the routing graph will have, indexed on a grid so a 30 m search checks only nearby cells.
function buildJunctionIndex(): { nearby: (lon: number, lat: number) => { junction: IndexedJunction; meters: number }[]; count: number } {
  const features = (JSON.parse(readFileSync(ROADS, 'utf8')) as { features: SourceRoad[] }).features;
  const roads = routingRoads(features);
  const junctions = junctionKeys(roads);
  rankOf = new Map();
  for (const road of roads) {
    const rank = CLASS_RANK[road.cls] ?? 9;
    if (road.name && rank < (rankOf.get(road.name) ?? 9)) rankOf.set(road.name, rank);
  }
  const cell = 0.001; // About 90 m by 110 m, so a 30 m search reaches only the 3x3 cells around a point.
  const grid = new Map<string, IndexedJunction[]>();
  for (const [key, junction] of junctions) {
    const [lon, lat] = key.split(',').map(Number);
    const cellKey = `${Math.floor(lon / cell)},${Math.floor(lat / cell)}`;
    const indexed: IndexedJunction = { ...junction, lon, lat };
    if (!grid.has(cellKey)) grid.set(cellKey, []);
    grid.get(cellKey)!.push(indexed);
  }
  const nearby = (lon: number, lat: number) => {
    const cx = Math.floor(lon / cell);
    const cy = Math.floor(lat / cell);
    const found: { junction: IndexedJunction; meters: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const junction of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const meters = metersBetween(lon, lat, junction.lon, junction.lat);
          if (meters <= CONTROL_SNAP_M) found.push({ junction, meters });
        }
      }
    }
    return found.sort((a, b) => a.meters - b.meters);
  };
  return { nearby, count: junctions.size };
}

async function main(): Promise<void> {
  const { elements, osmBases, source } = await fetchElements();
  const index = buildJunctionIndex();

  const kept: ControlRow[] = [];
  const dropped = { far: 0, duplicate: 0 };
  const seenJunction = new Set<string>();
  const ordered = elements
    .filter((element) => element.type === 'node' && element.tags?.highway && KIND[element.tags.highway])
    .sort((a, b) => a.id - b.id);

  for (const element of ordered) {
    const lon = round5(element.lon);
    const lat = round5(element.lat);
    const near = index.nearby(lon, lat);
    if (near.length === 0) {
      dropped.far++;
      continue;
    }
    // The routing build snaps to the nearest junction, and each junction holds one control.
    const nearest = near[0].junction;
    const junctionKey = keyOf(nearest.lon, nearest.lat);
    if (seenJunction.has(junctionKey)) {
      dropped.duplicate++;
      continue;
    }
    seenJunction.add(junctionKey);
    const label = junctionLabel(nearest);
    kept.push({
      id: `node/${element.id}`,
      kind: KIND[element.tags!.highway!],
      label,
      lon,
      lat,
    });
  }

  const counts = kept.reduce<Record<string, number>>((acc, control) => ({ ...acc, [control.kind]: (acc[control.kind] ?? 0) + 1 }), {});
  const file = {
    source:
      `OpenStreetMap stop signs (highway=stop) and traffic signals (highway=traffic_signals), ODbL, © OpenStreetMap contributors. ` +
      `Fetched from ${source} for the box ${BBOX.south},${BBOX.west} to ${BBOX.north},${BBOX.east}; OSM snapshot time per tile: ${osmBases || 'unknown'}. ` +
      `Kept when within ${CONTROL_SNAP_M} m of a junction in ${ROADS}, as src/routing/buildGraph.ts defines junctions. Regenerate with npm run routing:controls.`,
    controls: kept,
  } satisfies { source: string; controls: ControlRow[] };
  writeFileSync(OUT, JSON.stringify(file, null, 1) + '\n');
  console.log(
    `Wrote ${OUT}: ${kept.length} controls ${JSON.stringify(counts)}; ` +
      `${elements.length} OSM nodes read, ${dropped.far} more than ${CONTROL_SNAP_M} m from a junction, ${dropped.duplicate} sharing a junction with a kept one; ` +
      `${index.count} junctions indexed.`,
  );
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
