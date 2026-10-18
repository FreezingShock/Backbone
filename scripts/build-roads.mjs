// Builds public/data/roads.geojson from one of two road sources:
//   node scripts/build-roads.mjs               OpenStreetMap highway ways, via the Overpass API
//   node scripts/build-roads.mjs --tiger <dir>  U.S. Census TIGER/Line roads: the county .shp files in <dir>
// Run by hand when the extract needs a refresh. Commit the output so the static deploy serves it.
// The app never queries these sources itself. Attribution is written into the file.
// Endpoint and status: docs/data-sources.md.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const OUT = 'public/data/roads.geojson';
// Same box as the graticule in src/layers/graticule.ts. Keep them in step.
const BBOX = { south: 33.98, west: -118.95, north: 34.2, east: -118.5 };
const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL 1.0)';
const TIGER_ATTRIBUTION = 'U.S. Census Bureau, TIGER/Line 2024 (public domain)';
const TIGER_SOURCE = 'https://www2.census.gov/geo/tiger/TIGER2024/ROADS/ (06037, 06111)';

// Tier 1: the named through-routes, plus anything tagged as a motorway, trunk or primary road.
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

// TIGER has no OSM tags. Map its MTFCC feature classes onto the OSM highway values tierOf() reads.
const MTFCC_HIGHWAY = {
  S1100: 'primary', // primary road, limited access (freeways and interstates)
  S1200: 'secondary', // secondary road (state routes and major county roads)
  S1400: 'residential', // local neighborhood road
  S1630: 'motorway_link', // ramp
  S1500: 'track', // 4WD or unimproved road, fire roads
  S1750: 'track', // vehicular trail
  S1640: 'service', // service drive
  S1730: 'service', // alley
  S1740: 'service', // private road
  S1780: 'service', // parking lot road
  S1710: 'footway', // walkway or pedestrian trail
  S1720: 'steps', // stairway
  S1820: 'cycleway', // bike path
  S1830: 'bridleway', // bridle path
};

const round = (n) => Math.round(n * 1e5) / 1e5;
const inBox = ([lon, lat]) =>
  lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;

async function fromOverpass() {
  const query = `[out:json][timeout:180];
way["highway"]["highway"!~"^(proposed|construction|raceway|bus_guideway|platform|elevator)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
out geom tags;`;

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) {
    throw new Error(`Overpass returned HTTP ${response.status} from ${ENDPOINT}`);
  }
  const { elements } = await response.json();

  const ways = [];
  for (const way of elements) {
    if (way.type !== 'way' || !way.geometry || way.geometry.length < 2) continue;
    ways.push({
      tags: way.tags ?? {},
      coords: way.geometry.map((p) => [p.lon, p.lat]),
    });
  }
  return { source: ENDPOINT, attribution: OSM_ATTRIBUTION, ways };
}

async function fromTiger(dir) {
  // Loaded only for this mode, so the Overpass path needs no extra package.
  const { open } = await import('shapefile');
  const shpFiles = (await readdir(dir)).filter((f) => f.endsWith('.shp')).sort();
  if (shpFiles.length === 0) throw new Error(`No .shp files found in ${dir}`);

  const ways = [];
  for (const file of shpFiles) {
    const source = await open(join(dir, file));
    for (;;) {
      const { done, value } = await source.read();
      if (done) break;
      const { geometry, properties } = value;
      if (!geometry) continue;
      // Keep a whole road if any of its vertices falls in the box, as the Overpass query does.
      const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
      for (const coords of lines) {
        if (coords.length < 2 || !coords.some(inBox)) continue;
        ways.push({
          tags: {
            // TIGER puts the direction in front of the name ("N Topanga Canyon Blvd"). Drop it so the name matches ARTERY_NAME.
            ...(properties.FULLNAME ? { name: properties.FULLNAME.replace(/^(N|S|E|W|NE|NW|SE|SW) /, '') } : {}),
            highway: MTFCC_HIGHWAY[properties.MTFCC] ?? 'road',
          },
          coords,
        });
      }
    }
  }
  return { source: TIGER_SOURCE, attribution: TIGER_ATTRIBUTION, ways };
}

const tigerFlag = process.argv.indexOf('--tiger');
if (tigerFlag !== -1 && !process.argv[tigerFlag + 1]) {
  throw new Error('--tiger needs the folder that holds the county .shp files');
}
const input = tigerFlag === -1 ? await fromOverpass() : await fromTiger(process.argv[tigerFlag + 1]);

const features = input.ways.map(({ tags, coords }) => ({
  type: 'Feature',
  properties: {
    ...(tags.name ? { name: tags.name } : {}),
    ...(tags.ref ? { ref: tags.ref } : {}),
    highway: tags.highway,
    tier: tierOf(tags),
  },
  geometry: {
    type: 'LineString',
    coordinates: coords.map(([lon, lat]) => [round(lon), round(lat)]),
  },
}));

const collection = {
  type: 'FeatureCollection',
  attribution: input.attribution,
  source: input.source,
  generatedAt: new Date().toISOString(),
  bbox: BBOX,
  features,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(collection));

const counts = [1, 2, 3].map((tier) => `tier ${tier}: ${features.filter((f) => f.properties.tier === tier).length}`);
console.log(`Wrote ${features.length} ways to ${OUT} (${counts.join(', ')})`);
