// Builds public/data/roads.geojson from one of three modes:
//   node scripts/build-roads.mjs               OpenStreetMap highway ways, via the Overpass API
//   node scripts/build-roads.mjs --tiger <dir>  U.S. Census TIGER/Line roads: the county .shp files in <dir>
//   node scripts/build-roads.mjs --reclassify   Re-applies the road hierarchy to the file already in public/data
// Run by hand when the extract needs a refresh. Commit the output so the static deploy serves it.
// The app never queries these sources itself. Attribution is written into the file.
// Endpoint and status: docs/data-sources.md. The hierarchy rules live in scripts/road-classes.mjs.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { classifyRoad } from './road-classes.mjs';

const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const OUT = 'public/data/roads.geojson';
// Same box as the graticule in src/layers/graticule.ts. Keep them in step.
const BBOX = { south: 33.98, west: -118.95, north: 34.2, east: -118.5 };
const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL 1.0)';
const TIGER_ATTRIBUTION = 'U.S. Census Bureau, TIGER/Line 2024 (public domain)';
const TIGER_SOURCE = 'https://www2.census.gov/geo/tiger/TIGER2024/ROADS/ (06037, 06111)';

// TIGER has no OSM tags. Map its MTFCC feature classes onto the OSM highway values that classifyRoad() reads.
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

// Overpass tags use ';' to list several route refs. The first one that classifies as a highway or crossing wins.
function refFor(tags) {
  return (tags.ref ?? '').split(';').map((r) => r.trim()).find((r) => r) ?? '';
}

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

/** Adds `class` and, for canyon crossings, `crossing` to a feature's properties. */
function hierarchyProperties({ name, ref, highway }) {
  const { class: roadClass, crossing } = classifyRoad({ name, ref, highway });
  return { class: roadClass, ...(crossing ? { crossing } : {}) };
}

const COUNT_LINE = (features) =>
  ['highway', 'crossing', 'arterial', 'collector', 'local']
    .map((cls) => `${cls} ${features.filter((f) => f.properties.class === cls).length}`)
    .join(', ');

const mode = process.argv[2];
if (mode === '--reclassify') {
  // Keeps the geometry and source attribution. Only the hierarchy properties change.
  const old = JSON.parse(await readFile(OUT, 'utf8'));
  const features = old.features.map((feature) => {
    const { tier, class: _previous, crossing: _previousCrossing, ...rest } = feature.properties;
    return {
      ...feature,
      properties: {
        ...rest,
        ...hierarchyProperties({ name: rest.name, ref: rest.ref, highway: rest.highway }),
      },
    };
  });
  await writeFile(OUT, JSON.stringify({ ...old, generatedAt: new Date().toISOString(), features }));
  console.log(`Reclassified ${features.length} ways in ${OUT} (${COUNT_LINE(features)})`);
  process.exit(0);
}

if (mode === '--tiger' && !process.argv[3]) {
  throw new Error('--tiger needs the folder that holds the county .shp files');
}
const input = mode === '--tiger' ? await fromTiger(process.argv[3]) : await fromOverpass();

const features = input.ways.map(({ tags, coords }) => ({
  type: 'Feature',
  properties: {
    ...(tags.name ? { name: tags.name } : {}),
    ...(tags.ref ? { ref: tags.ref } : {}),
    highway: tags.highway,
    ...hierarchyProperties({ name: tags.name, ref: refFor(tags), highway: tags.highway }),
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
console.log(`Wrote ${features.length} ways to ${OUT} (${COUNT_LINE(features)})`);
