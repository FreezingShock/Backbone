# Backbone: data sources

Last checked: 2026-10-18. Only open data is used by default. Rows marked "not tested live" were not reached from the planning environment, so test each endpoint before building on it.

## Sources

| Data | Source | How to access | Refresh | Checked |
|------|--------|---------------|---------|---------|
| Fire outlines | NIFC WFIGS Current Wildland Fire Perimeters | ArcGIS Feature Service, plus GeoJSON and CSV downloads. Use fixed filters. | Every 5 minutes. Old fires drop off hourly. | Catalog page read |
| Hotspots | NASA FIRMS: VIIRS (NOAA-20, NOAA-21) and MODIS | Area API as CSV, with a free `MAP_KEY` | Near real time, per satellite pass | FIRMS API page read |
| Incident status, acres, containment, closures | CAL FIRE incident pages, such as the Bryson Fire | HTML only in our check. No official feed found yet. | Several updates a day during a fire | Bryson Fire page read |
| Evacuation zones | Zone IDs on the CAL FIRE incident page | Page text. Zone shapes not located. | During incidents | Page read |
| State highway closures | Caltrans emergency road closures (data.gov), and Caltrans QuickMap | Open dataset download. QuickMap is the live map. | Live (not confirmed) | Listed in search results only |
| County road closures, such as Encinal Canyon Road | LA County Public Works notices | No feed found | Unknown | Gap |
| Elevation | USGS 3DEP 1 m DEM | National Map elevation services | Static | Not tested live |
| Aerial photos | USDA NAIP through USGS | ImageServer or bulk download | Static, updated every few years | Not tested live |
| Roads, labels | Census TIGER/Line 2024 roads for LA County (06037) and Ventura County (06111), built by `node scripts/build-roads.mjs --tiger <dir>` into `public/data/roads.geojson` | Shapefile zips from `https://www2.census.gov/geo/tiger/TIGER2024/ROADS/`, clipped to the Santa Monica Mountains box. Public domain. | Refresh by hand, then commit the output | Built 2026-10-18 from the zips. Overpass was unusable from the build sandbox that day (resets, HTTP 500, and one mirror returned empty data), so `scripts/build-roads.mjs` without `--tiger` is untested live. |
| Trails | Not yet sourced. TIGER has no hiking trails. OSM trails need Overpass or a Geofabrik extract. | Gap | Unknown | Gap |
| Place names and points of interest | Wikidata (CC0) and OpenStreetMap (ODbL). Each coordinate comes from one of them. Where both have a point, the distance between them is recorded. | Wikidata entity IDs and OSM node or area tags, recorded per place in `src/data/places.json`. Built once; not fetched by the app. | Static | Checked 2026-10-18 for 50 places (Wikidata API and Nominatim). Blurbs are written for this app. |
| 3D Google tiles (optional) | Map Tiles API, Photorealistic 3D Tiles | Google Cloud key with billing enabled | Continuous | Pricing page read 2026-10-16 |

## Road hierarchy

`scripts/road-classes.mjs` sets a `class` on each road, from its name, route ref, and OSM highway tag (or the TIGER feature class mapped to the same tags). Canyon crossings also get a `crossing` short name. The build script calls it, and `node scripts/build-roads.mjs --reclassify` re-applies it to the committed file without the source data. The app reads `class` and `crossing` only. The crossing list is hand-written, so add to it there.

| Class | Drawn as | Roads |
|-------|----------|-------|
| highway | Muted grey. "Avoid" for canyon routes. Its layer dims when unchecked. | US 101, Ventura and Moorpark freeways, Pacific Coast Hwy, their ramps |
| crossing | Thick, highlighted (blue on paper, emerald on navy). Labeled. | Canyon roads over the mountains: Malibu Canyon, Kanan Dume, Topanga Canyon (incl. SR 27), Old Topanga, Las Virgenes, Decker, Encinal Canyon, Westlake Blvd, Potrero, Lynn, Wendy, Mulholland Hwy and Dr, Latigo Canyon, Yerba Buena, Reyes Adobe, Kanan, Lindero Canyon, Triunfo Canyon, Liberty Canyon, Corral Canyon, Little Sycamore, Lobo Canyon, Palo Comado |
| arterial | Medium, red on paper and amber on navy | TIGER state routes and major county roads, plus named valley boulevards such as Thousand Oaks Blvd and Ventura Blvd |
| collector | Thin | Other named through roads (Rd, Blvd, Ave, Pkwy) |
| local | Thinnest, dim | Streets (Dr, Ln, Ct, Cir, Pl, Way), service roads, fire roads, tracks, paths |

Crossing and arterial names are labeled. Labels are spaced apart and shown when the camera is close enough.

The demo route (Layers > Canyon-only demo route) plans Newbury Park, Westlake Village, Thousand Oaks, and Calabasas over crossings only, with no highway class edges. It is computed in the browser from the road graph (`src/lib/roads/route.ts`, tested in `src/lib/roads/route.test.ts`). Its stop coordinates are approximate town centers, not surveyed points.

## Routing (Canyon Cutting)

Checked 2026-10-19. Built by `npm run routing:build` (scripts/build-routing-graph.ts) into `public/data/routing-graph.json` (about 1.7 MB, 17.3k junctions, 20.6k road pieces). Elevation comes from `npm run routing:elevation` (scripts/fetch-elevation.ts), which fills the cache the build reads. The engine is in `src/routing/`. It runs in the browser and needs no server.

| Input | Source | Status |
|-------|--------|--------|
| Road lines, names, classes | `public/data/roads.geojson` (Census TIGER/Line 2024) | Used. Junctions are road endpoints, as TIGER stores them. One-way signs are not in TIGER, so every road runs both ways. |
| Speed limits | None in the graph | Gap. Speeds are estimates by class (freeway 60, arterial and canyon crossing 40, collector 30, local 25 mph, times 0.9 cruise, capped by the curve). Replace with posted limits when a source is verified. |
| Stop signs, traffic signals | Hand-curated list in `scripts/routing-controls.json` (empty) | Gap. The engine adds the step and a delay (6 s stop sign, 20 s signal, estimates) when an entry sits within 30 m of a junction. Routes say so in their warnings. |
| Elevation, grade, mountain score | USGS National Elevation Dataset 10 m (ned10m) through `api.opentopodata.org`. Checked 2026-10-19: returns values (311 m at 34.1, -118.6), 100 points per request, about 1 request per second, 1000 requests per day. Cached in `scripts/elevation-cache.json` by `npm run routing:elevation`, so the build never calls it. | Used. About 27k sample points every 250 m along the road lines. Feeds the mountain score (height above the valley floor, distance from the 101, curvature, steepness) and segment grade. Difficulty does not use grade yet. |
| 101 corridor | Freeway lines named US Hwy 101, Ventura Fwy, Hollywood Fwy and US Hwy 101 Bus in `public/data/roads.geojson` | Used. Valley roads within 1.5 km of it at valley elevation are priced at 5 in canyon mode, and the freeway at 8. |
| Overpass (OSM roads, signs, speeds) | overpass-api.de, overpass.kumi.systems, overpass.osm.ch, maps.mail.ru | Unreachable on 2026-10-19: resets, HTTP 500 and 504, or an empty count for a known bbox. Not used. |
| Geofabrik and BBBike extracts | BBBike LosAngeles.osm.pbf (214 MB) | Reachable, but its bounding box is -118.5 to -118.0 longitude, so it misses the west valleys and the canyons. Not used. |
| Places and city centers | `src/data/places.json` | Used. Cities, towns and neighborhoods become city stops. |
| Calabasas High School | Wikidata Q5018284, P625 claim: 34.13806, -118.6275 | Added from `scripts/routing-extra-places.json`. |
| Canyon junction names | Derived from the crossing list in `scripts/road-classes.mjs` | Each junction of a canyon crossing with another named crossing or arterial. |

Engine defaults, chosen here and stated in the code:
- Canyon routes avoid highway-class roads (US 101, PCH, freeway ramps). A leg uses one only when nothing else connects its stops, and the route then carries a warning.
- Canyon mode with mountainRoads on (the planner's Canyon Cutting mode): each road piece costs its drive time times a weight. Mountain roads (score near 100) cost about 0.8, valley roads cost up to 2.8, valley roads beside the 101 cost 5, and freeways 8. Alternatives are priced away from the roads of the routes before them, kept only when at least half their road is mountain and they share less than 60% of the shorter route. The top route is the most mountain-heavy one. Each route has `mountainShare` and a `summary` such as "via Topanga, then Mulholland Hwy west".
- ETA is driving time over the graph, plus 0 to 4 s for each turn (under 45° free, under 120° 2 s, sharper 4 s), plus control delays. Turns are not part of the search, only the timing.
- Difficulty is a 0 to 100 score per road piece: curvature (up to 50), class (up to 12), narrow road (8), unpaved (15), grade (up to 20, unused for now). Bands: easy under 15, intermediate under 30, medium under 45, hard under 60, difficult above. Colors are Minecraft chat colors: green, yellow, gold, red, dark red. A leg or route rolls up as its length-weighted mean.
- Steps: a name change always gets a step, and a turn under 25° on a new road reads as "continue". Along one road, only turns of 45° or more get a step.

Verified in tests (`npx -y tsx --test src/routing/*.test.ts`): A* matches plain Dijkstra on the built graph; Woodland Hills to Calabasas, Newbury Park to Thousand Oaks and Westlake Village to Calabasas each plan. Planning takes about 16 ms for three stops after a 33 ms graph load.

## Feed polling

## Feed polling

| Feed | Poll every | Notes |
|------|-----------|-------|
| WFIGS perimeters | 5 minutes | The source refreshes every 5 minutes, and changes can take up to 15 minutes to show. |
| FIRMS hotspots | 10 to 15 minutes | Satellite passes arrive irregularly. Check data availability first. |
| CAL FIRE incident page | 15 minutes | Parsed from HTML, so it is fragile. Keep the last good result. |
| Road closures | 5 to 10 minutes | Depends on the source chosen above. |

## Limits and gotchas

- **Cesium ion Community** is free for personal, non-commercial, and evaluation use. It includes 1,000 Google Photorealistic root tiles and 1,000 Bing imagery sessions a month. Commercial starts at $149 a month for one person.
- **Map Tiles API** bills per request on the Photorealistic 3D Tiles SKU, with a 10,000 root-tileset query daily cap. The old $200 credit note is out of date, so check current pricing first.
- **WFIGS** asks callers not to repeat relative-date queries, which can overload it. Use fixed filters.
- **Suomi NPP** hotspot data stops in November 2026. Build on NOAA-20 and NOAA-21.
- **Encinal Canyon Road** is a county road as far as we know. Confirm with LA County Public Works. Closures are the weak spot: no single feed covers both state highways and county roads.
- **CAL FIRE** has no official feed found. Parsing the HTML is fragile, so keep the last good result when parsing fails.

## Links

- [CAL FIRE: Bryson Fire](https://www.fire.ca.gov/incidents/2026/10/15/bryson-fire)
- [WFIGS Current Wildland Fire Perimeters](https://wifire-data.sdsc.edu/dataset/wfigs-current-wildland-fire-perimeters)
- [NASA FIRMS API](https://firms.modaps.eosdis.nasa.gov/api/)
- [Cesium ion pricing](https://cesium.com/pricing/)
- [Map Tiles API usage and billing](https://developers.google.com/maps/documentation/tile/usage-and-billing)
- [Caltrans emergency road closures (data.gov)](https://catalog.data.gov/dataset/caltrans-emergency-road-closures)
- [Caltrans Lane Closure System docs](https://cwwp2.dot.ca.gov/documentation/lcs/lcs.htm)
- [Wikidata](https://www.wikidata.org/) (CC0): place coordinates, IDs in `src/data/places.json`
- [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL): place coordinates. Attribution is shown in the Points of interest layer note.
