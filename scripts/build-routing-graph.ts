// Builds public/data/routing-graph.json from the committed road lines, the place list and the elevation cache.
// Run from the repo root: npm run routing:build
// Inputs: public/data/roads.geojson (Census TIGER/Line, classed by scripts/road-classes.mjs),
// src/data/places.json, scripts/routing-extra-places.json, scripts/routing-controls.json, and
// scripts/elevation-cache.json (written by npm run routing:elevation). The build itself never touches the network.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildGraphFile } from '../src/routing/buildGraph';
import { elevationKey, type ElevationLookup } from '../src/routing/mountain';
import { ELEVATION_CACHE, GRAPH_OUT, readRoutingInputs } from './routing-inputs';

const cache = existsSync(ELEVATION_CACHE)
  ? (JSON.parse(readFileSync(ELEVATION_CACHE, 'utf8')) as { points: Record<string, number | null> }).points
  : null;

let misses = 0;
const elevationAt: ElevationLookup | undefined = cache
  ? (lon, lat) => {
      const value = cache[elevationKey(lon, lat)];
      if (value === undefined) misses++;
      return value ?? null;
    }
  : undefined;

if (!cache) console.warn(`No ${ELEVATION_CACHE}: grade is left out and mountain scores lean on the other signals. Run npm run routing:elevation.`);

const { file, report } = buildGraphFile({ ...readRoutingInputs(), elevationAt });

writeFileSync(GRAPH_OUT, JSON.stringify(file));
const kb = Math.round(readFileSync(GRAPH_OUT).length / 1024);
console.log(`Wrote ${GRAPH_OUT} (${kb} KB)`);
if (cache && misses > 0) console.warn(`${misses} elevation samples were not in the cache. Run npm run routing:elevation to fill them.`);
console.log(JSON.stringify(report, null, 2));
