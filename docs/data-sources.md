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

Checked 2026-10-19. Built by `npm run routing:build` (scripts/build-routing-graph.ts) into `public/data/routing-graph.json` (about 1.9 MB, 19.7k junctions, 25.6k road pieces). The engine is in `src/routing/`. It runs in the browser and needs no server.

| Input | Source | Status |
|-------|--------|--------|
| Road lines, names, classes | `public/data/roads.geojson` (Census TIGER/Line 2024) | Used. Junctions are road endpoints, as TIGER stores them, plus inner points where two differently named roads meet at an angle (TIGER sometimes shares a vertex in the middle of both lines, e.g. Ventura Blvd and Topanga Canyon Blvd). A name change along a straight road is not a junction. One-way signs are not in TIGER, so every road runs both ways. |
| Speed limits | None in the graph | Gap. Speeds are estimates by class (freeway 60, arterial and canyon crossing 40, collector 30, local 25 mph, times 0.9 cruise, capped by the curve). Replace with posted limits when a source is verified. |
| Stop signs, traffic signals | OpenStreetMap nodes tagged `highway=stop` and `highway=traffic_signals` (ODbL, © OpenStreetMap contributors), fetched by `npm run routing:controls` into `scripts/routing-controls.json` | Used. Checked 2026-10-19: 3,065 controls kept (2,452 stop signs, 613 signals) from 4,992 nodes in the road box. A node is kept only if it sits within 30 m of a junction, one control per junction. Delays are estimates (6 s stop sign, 20 s signal). See the notes below for known gaps. |
| Grade | None | Gap. No elevation is in the graph, so difficulty ignores grade. |
| Overpass (OSM stop signs and signals) | maps.mail.ru (used), overpass-api.de (503), overpass.kumi.systems (429, 500), overpass.osm.ch (empty answer from a stale database, osm base 117831, so not used) | Checked 2026-10-19. maps.mail.ru answered after 504 retries; the script tries mirrors in order and asks the next one when an answer is empty. OSM roads and speeds are still not used. |
| Geofabrik and BBBike extracts | BBBike LosAngeles.osm.pbf (214 MB) | Reachable, but its bounding box is -118.5 to -118.0 longitude, so it misses the west valleys and the canyons. Not used. The Geofabrik California extract did not connect on 2026-10-19. |
| Places and city centers | `src/data/places.json` | Used. Cities, towns and neighborhoods become city stops. |
| Calabasas High School | Wikidata Q5018284, P625 claim: 34.13806, -118.6275 | Added from `scripts/routing-extra-places.json`. |
| Canyon junction names | Derived from the crossing list in `scripts/road-classes.mjs` | Each junction of a canyon crossing with another named crossing or arterial. |

Stop sign and signal data, checked 2026-10-19:
- Built by `npm run routing:controls` (`scripts/fetch-routing-controls.ts`). It tiles the road box into 16 queries and caches each answer with `--cache DIR`. It uses the same junction rule as the graph build (`junctionKeys` in `src/routing/buildGraph.ts`), so every kept control lands on a graph junction. Run `npm run routing:build` after it. `--from FILE` rebuilds from a saved Overpass response.
- Counts: 4,992 nodes read (3,934 stop, 1,058 signal). 961 are more than 30 m from any junction. 966 share a junction with a kept control, and only one control is kept per junction.
- Junction rule change (2026-10-19): the graph used to cut roads only at endpoints. A crossing where two differently named roads share an inner vertex had no node, so signals there were dropped. Ventura Blvd and Topanga Canyon Blvd is one example, with 5 OSM signal nodes at about 34.1685, -118.6058. Nodes went from 17.8k to 19.7k and the named intersections from 279 to 399. A name change along a straight road is not a junction.
- Known limits: (1) State Rte 27 and Topanga Canyon Blvd are two TIGER lines for the same road, so where they zigzag they can make false junctions. Some stop signs along SR 27 are labeled "State Rte 27 & Topanga Canyon Blvd" when the cross street is elsewhere. (2) Tile 1-1 (34.035 to 34.09, -118.8375 to -118.725, Malibu Creek and Las Virgenes) returned no nodes from maps.mail.ru on two tries, and the other mirrors were down, so it is unverified. (3) The tile in the southeast corner came from overpass.kumi.systems with an OSM snapshot from 2026-07-28. The source note in the file lists the snapshot time of each tile.
- Checked by hand: the Woodland Hills to Calabasas route plans 28 control steps, Newbury Park to Thousand Oaks 23, Westlake Village to Calabasas 24, and Woodland Hills to Westlake Village 41, each with the delay in its ETA (`src/routing/controls.test.ts`). Tests cover: the file is ODbL-attributed, inside the box, and has valid kinds; the built graph holds every control on its junction; the Ventura Blvd and Topanga Canyon Blvd junction is on the graph; routes through a stop sign or a signal get a step, and the search charges the delay.

Engine defaults, chosen here and stated in the code:
- Canyon routes avoid highway-class roads (US 101, PCH, freeway ramps). A leg uses one only when nothing else connects its stops, and the route then carries a warning.
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
- **OpenStreetMap data** (stop signs, signals) needs the ODbL attribution. It is shown in the Roads layer note.
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
- [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL): place coordinates, and stop sign and signal nodes for routing. Attribution is shown in the Points of interest and Roads layer notes.
