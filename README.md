# Backbone

An open-data, non-commercial 3D map of Topanga and the Santa Monica Mountains, in the spirit of Google Earth. It will run in the browser first and later ship as an Electron desktop app.

## What it will do

- Explore 3D terrain and aerial imagery: orbit, fly to a place, or free-fly through canyons.
- Watch wildfires live, with fire perimeters, hotspots, and road closures. Layers update without any clicks.
- Show canyon roads, trails, and points of interest.
- Canyon Cutting: plan a multi-stop route across the mountains and play it as a camera fly-through.

## Status

Phase 1 MVP (app scaffold) is running on localhost: a CesiumJS globe in React, a blueprint basemap with a satellite toggle, orbit and free-fly camera controls, fly-to buttons, a layer panel, and a toolbar. Data feeds are not wired in yet. The plan is in [docs/plan.md](docs/plan.md).

## Run locally

Requires Node 20.19 or newer, or Node 22.12 or newer.

```sh
npm install
cp .env.example .env.local   # optional, see below
npm run dev                  # opens at http://localhost:5173
```

`npm install` copies the CesiumJS runtime files into `public/cesium/`. The `dev` and `build` scripts do the same copy first.

Other scripts: `npm run build` (typecheck and production build into `dist/`), `npm run typecheck`, `npm run preview`.

### Auto-update while developing

`npm run dev:sync` starts the dev server and checks `origin/main` every 30 seconds. Pull requests land on `main` when merged, so the checkout updates after each merge:

- If this checkout is on `main` with no uncommitted changes, it fast-forwards to the new commits, and Vite hot-reloads them.
- It runs `npm install` only when `package.json` or `package-lock.json` changed.
- If you are on another branch or have uncommitted changes, it logs that an update is waiting and leaves your work alone.

Set `DEV_SYNC_INTERVAL_SECONDS` to change the interval (minimum 5). Press Ctrl+C to stop both the sync and the dev server.

### Environment variables

| Variable | Needed? | What it does |
|----------|---------|--------------|
| `VITE_CESIUM_ION_TOKEN` | Optional | Cesium ion access token (Community tier, free for personal and non-commercial use). Turns on Cesium World Terrain. Without it, the terrain is flat. Create one at https://ion.cesium.com/tokens |
| `VITE_IMAGERY_URL` | Optional | Override the imagery service. Must be an ArcGIS MapServer tile endpoint. Default: USGS imagery. |

Never commit real tokens. `.env*` files are gitignored, except `.env.example`.

### Basemaps and terrain

- **Imagery:** the default is the USGS imagery service (`USGSImageryOnly`). It needs no token. It is not yet checked from the build environment, so if it does not load, the status panel says so and the globe still renders.
- **Blueprint** (default): dimmed, desaturated imagery over a dark navy globe, with a cyan grid and place names. **Satellite:** the imagery as-is.
- **Terrain:** Cesium World Terrain with an ion token, otherwise a flat ellipsoid. The plan's USGS 3DEP terrain comes later, in the data phase.

## Code layout

- `src/map/`: the CesiumJS viewer (`MapView.tsx`), free-fly controls, and saved places.
- `src/layers/`: map layers. Each layer is a `MapLayer` with a `mount(viewer)` that adds Cesium primitives. Add new layers to `src/layers/registry.ts`.
- `src/ui/`: toolbar, layer panel, and small design-system pieces (`primitives.tsx`).
- `src/styles/index.css`: Tailwind v4 theme tokens (navy, cyan grid, mono font).
- `scripts/copy-cesium.mjs`: copies Cesium's Workers, Assets, Widgets, and ThirdParty files into `public/cesium/`.

Place coordinates in `src/map/places.ts` are approximate and not yet checked against a survey map.

## Stack

- React, Vite, TypeScript, Tailwind CSS
- CesiumJS for the 3D globe
- Vercel for hosting and server functions (planned)
- Supabase (Postgres) for cached feeds and saved routes (planned)
- Valhalla on a small VM for routing (planned)
- Electron later, for the desktop build

## Docs

- [docs/plan.md](docs/plan.md): requirements, decisions, phases
- [docs/data-sources.md](docs/data-sources.md): feeds, endpoints, refresh rates, verification status
- [CLAUDE.md](CLAUDE.md): working notes for Claude and contributors

## Data and licensing

Only open data is used by default. Map data comes from USGS, USDA NAIP, OpenStreetMap, NIFC, NASA FIRMS, CAL FIRE, and Caltrans. Cesium ion Community is the license plan, which covers personal and non-commercial use only.
