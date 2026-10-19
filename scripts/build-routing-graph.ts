// Builds public/data/routing-graph.json from the committed road lines and the place list.
// Run from the repo root: npm run routing:build
// Inputs: public/data/roads.geojson (Census TIGER/Line, classed by scripts/road-classes.mjs),
// src/data/places.json, scripts/routing-extra-places.json, and scripts/routing-controls.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildGraphFile, type ControlInput, type SourceRoad } from '../src/routing/buildGraph';
import type { PlaceRow } from '../src/routing/graphFile';

const ROADS = 'public/data/roads.geojson';
const OUT = 'public/data/routing-graph.json';

interface PlaceJson {
  id: string;
  name: string;
  kind: string;
  lon: number;
  lat: number;
}

const CITY_KINDS = new Set(['city', 'town', 'neighborhood']);
const toPlace = (place: PlaceJson): PlaceRow => ({
  id: place.id,
  name: place.name,
  kind: CITY_KINDS.has(place.kind) ? 'city' : 'poi',
  lon: place.lon,
  lat: place.lat,
});

const roadsFile = JSON.parse(readFileSync(ROADS, 'utf8')) as { features: SourceRoad[]; source?: string };
const places = (JSON.parse(readFileSync('src/data/places.json', 'utf8')) as PlaceJson[]).map(toPlace);
const extra = JSON.parse(readFileSync('scripts/routing-extra-places.json', 'utf8')) as { places: PlaceJson[] };
const controls = JSON.parse(readFileSync('scripts/routing-controls.json', 'utf8')) as { controls: ControlInput[] };

const { file, report } = buildGraphFile({
  roads: roadsFile.features,
  controls: controls.controls,
  places: [...places, ...extra.places.map(toPlace)],
  source: `Census TIGER/Line roads (${ROADS}); places from src/data/places.json`,
});

writeFileSync(OUT, JSON.stringify(file));
const kb = Math.round(readFileSync(OUT).length / 1024);
console.log(`Wrote ${OUT} (${kb} KB)`);
console.log(JSON.stringify(report, null, 2));
