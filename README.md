# Backbone

An open-data, non-commercial 3D map of Topanga and the Santa Monica Mountains, in the spirit of Google Earth. It will run in the browser first and later ship as an Electron desktop app.

## What it will do

- Explore 3D terrain and aerial imagery: orbit, fly to a place, or free-fly through canyons.
- Watch wildfires live, with fire perimeters, hotspots, and road closures. Layers update without any clicks.
- Show canyon roads, trails, and points of interest.
- Canyon Cutting: plan a multi-stop route across the mountains and play it as a camera fly-through.

## Status

Planning. No app code has been written yet. Phase 1 (data) starts once the decisions in [docs/plan.md](docs/plan.md) are confirmed.

## Stack

- React, Vite, TypeScript, Tailwind CSS
- CesiumJS for the 3D globe
- Vercel for hosting and server functions
- Supabase (Postgres) for cached feeds and saved routes
- Valhalla on a small VM for routing
- Electron later, for the desktop build

## Docs

- [docs/plan.md](docs/plan.md): requirements, decisions, phases
- [docs/data-sources.md](docs/data-sources.md): feeds, endpoints, refresh rates, verification status
- [CLAUDE.md](CLAUDE.md): working notes for Claude and contributors

## Data and licensing

Only open data is used by default. Map data comes from USGS, USDA NAIP, OpenStreetMap, NIFC, NASA FIRMS, CAL FIRE, and Caltrans. Cesium ion Community is the license plan, which covers personal and non-commercial use only.
