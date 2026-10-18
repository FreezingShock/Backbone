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

## Road tiers

`scripts/build-roads.mjs` sets a `tier` on each road from its OSM tags, or from the TIGER feature class (MTFCC) mapped to the same tags. The app only reads the tier.

| Tier | Drawn as | Roads |
|------|----------|-------|
| 1 | Thick, near-white | Topanga Canyon Blvd, Kanan Dume Rd, Malibu Canyon Rd, Pacific Coast Hwy, Mulholland Hwy, Ventura Fwy, CA 1, CA 27, US 101, and OSM motorway, trunk, or primary |
| 2 | Medium, amber | OSM secondary and tertiary (arterials and collectors) |
| 3 | Thin, dim cyan | Everything else: local streets, tracks, paths, footways |

Road names are labeled on tiers 1 and 2 only. Labels are spaced apart and shown when the camera is close enough.

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
