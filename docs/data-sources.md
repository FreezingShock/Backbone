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
