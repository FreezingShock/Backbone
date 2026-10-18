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
| Roads, trails, labels | OpenStreetMap, Geofabrik California extract | PBF download, and Overpass API for quick queries | Daily extracts | Not tested live |
| 3D Google tiles (optional) | Map Tiles API, Photorealistic 3D Tiles | Google Cloud key with billing enabled | Continuous | Pricing page read 2026-10-16 |

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
