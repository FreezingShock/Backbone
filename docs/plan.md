# Backbone: plan

Last updated: 2026-10-18. Status: Phase 1 MVP scaffold runs on localhost (3D globe, basemaps, camera controls, layer panel). Data feeds are not wired yet.

Summary: build a CesiumJS web app first. A small backend polls the fire and closure feeds every 5 minutes, and Electron wraps the same app later. The free route works now: NASA, NIFC, and USGS data are public, and the Cesium ion Community tier covers personal and non-commercial use.

The Bryson Fire is the first test case. CAL FIRE lists it at 147 acres and 39% contained (last update 2026-10-16, 9:16 PM), near Encinal Canyon Road, with Encinal Canyon Road and Decker Road closed.

## Decisions

Picks are the defaults. Confirm or change each one.

| # | Decision | Options | Pick |
|---|----------|---------|------|
| 1 | Imagery look | Google Photorealistic 3D Tiles (closest to Google Earth, billed per request), or open NAIP and USGS 3DEP (free, less polished) | Open data. Google tiles stay an optional later add-on for the Earth look. |
| 2 | License | Cesium ion Community (free, personal and evaluation use), or Commercial ($149/month individual) | Community. Confirmed: personal, non-commercial, open data only. |
| 3 | Routing engine for Canyon Cutting | Self-hosted Valhalla, or a hosted API such as OpenRouteService or Mapbox | Valhalla on a Southern California OSM extract. Free, and supports hiking. |
| 4 | Map area | Topanga and the Santa Monica Mountains, all of LA County, or all of California | Topanga and the Santa Monica Mountains first. Grow by changing the data extract. |
| 5 | Travel modes | Driving only, or driving and hiking | Both, with a mode switch. Canyon Cutting is best with trails. |
| 6 | Alerts | Map and list only, or desktop and phone notifications | Map and list now. Notifications come with the Electron build. |

## Stack

| Layer | Pick | Why |
|-------|------|-----|
| 3D globe and camera | CesiumJS (`cesium` on npm, 1.146.0, latest on 2026-10-18), rendered inside a React component | Terrain, 3D Tiles, and camera flights. Runs in a browser and inside Electron. |
| UI | React, Tailwind CSS, Vite, TypeScript | Panels, layer toggles, route rail, and the saved-places list. Fast builds. |
| Hosting | Vercel: the static app, plus Vercel Functions in `api/` | Simple deploys, preview URLs per PR, and server code next to the app. |
| Data store | Supabase (Postgres): cached feed snapshots and saved routes | Managed Postgres. PostGIS is available there if geometry queries are needed later. Confirm the need before wiring it in. |
| Feed polling | Backend jobs every ~5 minutes, starting with Vercel cron | Each feed is fetched once and served to every browser. Check cron limits for the chosen Vercel plan; 5-minute polling may need a paid plan or an external scheduler. |
| Routing | Valhalla on a small VM, using the same OSM extract | Driving and hiking, with custom avoid areas for closed roads. Long-running, so it does not go on Vercel. |
| Terrain | USGS 3DEP 1 m elevation, converted to Cesium terrain tiles | Free public data with fine ridges and canyons. |
| Aerial imagery | USDA NAIP, with Bing imagery through Cesium ion as a fallback | Free and public domain. Check the photo year for each area. |
| Photoreal option | Google Photorealistic 3D Tiles through Cesium ion or the Map Tiles API | Closest to Google Earth. Billed per tile and session. |
| Roads, trails, labels | OpenStreetMap California extract from Geofabrik, served as PMTiles | Free. Canyon roads and trails are mapped in OSM. |
| Desktop | Electron, wrapping the same web build | Offline packs, notifications, and auto-updates. |

Hosting note: a static app and serverless functions fit on Vercel. Valhalla and any large routing tiles do not. They live on the VM, and the Vercel functions call them over HTTP.

## Workflow

1. Set the region: a bounding box around Topanga and the Santa Monica Mountains, plus a radius picker for places outside it.
2. Build the 3D base once: download the 1 m DEM and NAIP photos for the box, tile them, and host the tiles.
3. Cut the California OSM extract to the box. Build Valhalla routing tiles from the same file.
4. Start the backend poller. Each feed has its own schedule, and the latest result is stored with a timestamp.
5. Build the browser app. It loads the base tiles, then the backend's live layers, and asks the backend for updates every minute.
6. Add Canyon Cutting on top of the routing service.
7. Wrap the finished web app in Electron.

## Public data sources

The fire data is public and fresh. Closures are the weak spot. No single feed covers both state highways and county roads such as Encinal Canyon Road. Full details, endpoints, and verification status are in [data-sources.md](data-sources.md).

## Requirements

### 3D and exploration

CesiumJS gives a real 3D globe with terrain. Add three camera modes, and load detail by zoom level so the app stays fast.

- **Orbit:** drag to circle a point, such as a fire or a canyon, from all sides.
- **Fly-to:** pick a saved place (Topanga Canyon, Encinal Canyon, the Bryson Fire) and the camera flies there.
- **Free-fly:** WASD and the mouse, for moving through canyons at ground level.
- **Terrain exaggeration:** a slider from 1.0 to 2.0 so ridges are easier to read.
- **Time of day:** a sun slider, so canyon walls cast real shadows.

Loading and the radius picker:

- The box is tiled once. Cesium streams only the tiles in view, at the detail the screen needs.
- The radius picker draws a circle around any place. It sets the area for fire and closure queries and for offline packs in Electron. It does not load extra tiles, because the box already covers the area.

Performance targets, to measure in Phase 2:

- 60 fps on a mid-range laptop with fire, road, and trail layers on.
- Full 1 m terrain only near the camera. Use coarser levels farther away.
- Use Cesium primitives, not Entities, for roads and trails. Entities slow down with thousands of lines.
- Cap imagery detail at zoom 17 unless the camera is close.

Layer toggles: fire outlines, hotspots, closures, roads, trails, evacuation zones, and the Canyon Cutting route.

Google option: Photorealistic 3D Tiles can replace the NAIP base on the same camera. Google's policies limit caching, so check them before you store any tiles offline. Offline packs should use open data unless the policy allows it.

### Live updates without clicks

Fire outlines, hotspots, and closures come from a backend poller, not from the browser. The browser asks the backend for fresh data every minute and updates each layer in place, so the map changes without any clicks.

The browser never calls government feeds directly. That keeps the app fast and avoids rate limits.

| Feed | Poll every | Notes |
|------|-----------|-------|
| WFIGS perimeters | 5 minutes | The source refreshes every 5 minutes, and changes can take up to 15 minutes to show. |
| FIRMS hotspots | 10 to 15 minutes | Satellite passes arrive irregularly. Check data availability first. |
| CAL FIRE incident page | 15 minutes | Parsed from HTML, so it is fragile. Keep the last good result. |
| Road closures | 5 to 10 minutes | Depends on the source chosen in the data section. |

How the map updates:

- Each fire has an ID, and the browser keeps one polygon per fire. A new perimeter replaces the old polygon in place. Nothing else redraws.
- A fire that drops out of the feed is removed after the next poll.
- Each layer shows its own age, such as "updated 2 min ago", so a stale feed is obvious.
- Optional: blend between the last two perimeters to show spread.

### Canyon Cutting: multi-stop routes and cutscene

Canyon Cutting plans a route through several stops, then plays it as a camera fly-through. You place stops on the map, the app orders and routes them, and one button plays the cutscene.

How a route is built, in order:

1. **Place stops.** Click the 3D map, type a name, or pick a saved place. Drag a stop to move it.
2. **Pick a mode for each leg.** Drive, Hike, or Mixed (drive to a trailhead, then hike).
3. **Order the stops.** Keep your order, or press Optimize. With up to 8 stops the app checks every order. Above 8 it uses a fast heuristic.
4. **Route.** Valhalla returns each leg's line, distance, and elevation gain. Closed roads and active fire outlines go in as avoid areas, so the route goes around the Bryson Fire and Encinal Canyon Road while they are closed.
5. **Review.** The route appears as a line with a marker at each stop. An elevation profile under the map shows the climbs. Click the profile to move the camera to that point.
6. **Play the cutscene.** The camera follows the route at a set height above the terrain, slows in tight turns, and pauses at each stop with the stop's name. Controls: play, pause, speed, skip to next stop, and free-look to leave the path and return to it.

How it works, for the build:

- Route geometry is sampled about once per second, then smoothed into camera positions with a spline. Cesium's sampled-position property handles playback.
- Camera height is terrain height plus an offset, such as 150 m, so the camera stays above canyon walls.
- Routes save as GeoJSON, so you can reload or share them. Saved routes can live in Supabase.

Usability details:

- A route rail on the left lists the stops. Drag to reorder. A Play button sits at the top.
- Saved routes have names. Reload one or export it as GeoJSON.

## Electron path

Electron packages the same web app for Windows and Mac. Phase 5 is packaging and desktop features, not a rewrite.

What Electron adds:

- Offline map packs: open-data tiles for a region you choose, stored on disk.
- Desktop notifications when a new fire starts within a set distance of a saved place.
- A tray icon and auto-updates.
- Optional: run Valhalla as a local process so Canyon Cutting works without internet. It is heavier to ship, so decide later.

Watch-outs:

- Cesium ion Community is for personal and non-commercial use. Distributing the app to others needs a Commercial plan first.
- Check Google's policies before caching Google tiles offline.
- Electron 44.9.0 is the latest on npm (2026-10-18). Rebuild on each major Electron release.

## Phased workflow

| Phase | Goal | Done when |
|-------|------|-----------|
| 1. Data | DEM, NAIP, OSM extract, and the WFIGS and FIRMS poller for the Santa Monica Mountains box | Test tiles load, and the poller stores a fresh WFIGS snapshot |
| 2. 3D base | Terrain, imagery, orbit, fly-to, and free-fly in the browser | Fly from Topanga to Malibu at 60 fps on a laptop |
| 3. Live layers | Fire outlines, hotspots, closures, with the Bryson Fire as the test case | The Bryson outline updates with no reload |
| 4. Canyon Cutting | Stops, routing, and cutscene | A four-stop Topanga route plays as a fly-through |
| 5. Desktop | Electron build, offline packs, and notifications | Installs on Windows or Mac and runs the same app |

Nothing has been built yet. Open questions:

- [ ] Accept the picks in the decisions table, or change any of them.
- [ ] Confirm the county closure source for Encinal Canyon Road.
- [x] Commercial use is ruled out. Open data only, so Cesium ion Community is the plan.
- [ ] Confirm the Vercel plan for 5-minute cron polling (see Stack).
- [ ] Confirm whether Supabase is needed from Phase 1, or only from Phase 3 for saved routes.

Once the decisions are settled, Phase 1 starts.
