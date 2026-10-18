// Builds public/data/roads.geojson from OpenStreetMap highway ways, via the Overpass API.
// Run by hand when the extract needs a refresh: node scripts/build-roads.mjs
// Commit the output so the static deploy serves it. The app never queries Overpass itself.
// Data: © OpenStreetMap contributors, ODbL. Endpoint and status: docs/data-sources.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const OUT = 'public/data/roads.geojson';
// Same box as the graticule in src/layers/graticule.ts. Keep them in step.
const BBOX = { south: 33.98, west: -118.95, north: 34.2, east: -118.5 };

// Tier 1: the named through-routes, plus anything OSM tags as a motorway, trunk or primary road.
const ARTERY_NAME = /^(topanga canyon (blvd|boulevard|road|rd)|kanan dume (road|rd)|malibu canyon (road|rd)|pacific coast (highway|hwy)|mulholland (highway|hwy)|ventura (freeway|fwy))$/i;
const ARTERY_REF = /^(CA 1|CA 27|US 101)$/;

/** 1 = arteries (thick, bright), 2 = arterials and collectors (amber), 3 = local roads and trails (thin, dim). */
export function tierOf(tags) {
  const refs = (tags.ref ?? '').split(';').map((r) => r.trim());
  if (tags.name && ARTERY_NAME.test(tags.name)) return 1;
  if (refs.some((r) => ARTERY_REF.test(r))) return 1;
  if (/^(motorway|trunk|primary)(_link)?$/.test(tags.highway)) return 1;
  if (/^(secondary|tertiary)(_link)?$/.test(tags.highway)) return 2;
  return 3;
}

const query = `[out:json][timeout:180];
way["highway"]["highway"!~"^(proposed|construction|raceway|bus_guideway|platform|elevator)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
out geom tags;`;

const round = (n) => Math.round(n * 1e5) / 1e5;

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ data: query }),
});
if (!response.ok) {
  throw new Error(`Overpass returned HTTP ${response.status} from ${ENDPOINT}`);
}
const { elements } = await response.json();

const features = [];
for (const way of elements) {
  if (way.type !== 'way' || !way.geometry || way.geometry.length < 2) continue;
  const tags = way.tags ?? {};
  const tier = tierOf(tags);
  features.push({
    type: 'Feature',
    properties: {
      ...(tags.name ? { name: tags.name } : {}),
      ...(tags.ref ? { ref: tags.ref } : {}),
      highway: tags.highway,
      tier,
    },
    geometry: {
      type: 'LineString',
      coordinates: way.geometry.map((p) => [round(p.lon), round(p.lat)]),
    },
  });
}

const collection = {
  type: 'FeatureCollection',
  attribution: '© OpenStreetMap contributors (ODbL 1.0)',
  source: ENDPOINT,
  generatedAt: new Date().toISOString(),
  bbox: BBOX,
  features,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(collection));

const counts = [1, 2, 3].map((tier) => `tier ${tier}: ${features.filter((f) => f.properties.tier === tier).length}`);
console.log(`Wrote ${features.length} ways to ${OUT} (${counts.join(', ')})`);
