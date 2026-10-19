// The inputs to the routing graph, read from the committed files. Shared by the elevation fetch and the graph build,
// so both see the same road pieces and therefore the same sample points.
import { readFileSync } from 'node:fs';
import type { BuildInput, ControlInput, SourceRoad } from '../src/routing/buildGraph';
import type { PlaceRow } from '../src/routing/graphFile';

export const ROADS = 'public/data/roads.geojson';
export const GRAPH_OUT = 'public/data/routing-graph.json';
export const ELEVATION_CACHE = 'scripts/elevation-cache.json';

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

/** Everything the graph is built from, except elevation. */
export function readRoutingInputs(): Omit<BuildInput, 'elevationAt'> {
  const roadsFile = JSON.parse(readFileSync(ROADS, 'utf8')) as { features: SourceRoad[] };
  const places = (JSON.parse(readFileSync('src/data/places.json', 'utf8')) as PlaceJson[]).map(toPlace);
  const extra = JSON.parse(readFileSync('scripts/routing-extra-places.json', 'utf8')) as { places: PlaceJson[] };
  const controls = JSON.parse(readFileSync('scripts/routing-controls.json', 'utf8')) as { controls: ControlInput[] };
  return {
    roads: roadsFile.features,
    controls: controls.controls,
    places: [...places, ...extra.places.map(toPlace)],
    source: `Census TIGER/Line roads (${ROADS}); places from src/data/places.json`,
  };
}
