# CLAUDE.md

Working notes for Claude in this repo. Read this first, then `docs/plan.md` and `docs/data-sources.md`.

## What Backbone is

An open-data, non-commercial web app, later wrapped in Electron, that shows an explorable 3D map of Topanga and the Santa Monica Mountains, in the spirit of Google Earth.

Core features:

1. 3D terrain and aerial imagery you can orbit, fly to, and free-fly through.
2. Live wildfire watch: fire perimeters, hotspots, and road closures (test case: the Bryson Fire near Encinal Canyon Road). Layers update with no clicks.
3. Canyon roads, trails, and points of interest.
4. Canyon Cutting: plan a route through stops A, B, C, D and so on, with drive, hike, or mixed legs, then play it as a camera fly-through.

## Hard rules

- **Open data only.** Do not add a paid or commercial data source as a default. Google Photorealistic 3D Tiles are an optional add-on, and only after checking Google's caching policy.
- **Non-commercial.** The Cesium ion Community tier is the license plan. Distributing the app to other people needs a Cesium ion Commercial plan first.
- **Verify before you build on it.** Check that a data source is real and reachable before recommending or coding against it. Mark anything unverified as unverified.
- **Pick defaults and say which.** Don't stall on questions when a reasonable default exists. Name the default in your reply.
- **Keep replies short and plain.**

## Stack

Chosen by nate on 2026-10-18:

- **Frontend:** React, Vite, TypeScript, Tailwind CSS. CesiumJS renders the 3D globe inside a React component.
- **Hosting:** Vercel. The web app is static, and server code runs as Vercel Functions in `api/`.
- **Data store:** Supabase (Postgres). Planned uses: cached feed snapshots and saved routes. Confirm the need before wiring it in.
- **Routing:** Valhalla on a separate small VM, not on Vercel. It is a long-running process with large routing tiles. Vercel Functions call it over HTTP.
- **Polling:** feeds are polled by backend jobs about every 5 minutes. Vercel cron is the first option, but check the current cron limits for each Vercel plan before relying on it. Hobby plans have historically limited cron to daily runs. An external scheduler is the fallback.
- **Desktop (later):** Electron wraps the same web build. It is not a rewrite.

CesiumJS 1.146.0 is the latest npm release as of 2026-10-18. Cesium needs its static assets served (Workers, Assets, Widgets). Use a Vite plugin or a copy step to handle that.

## Repo layout

Phase 1 scaffold is in place: `src/` (React app), `scripts/`, and `public/` (Cesium assets, generated). `api/`, `supabase/`, and `routing/` come later.

- `README.md`, `CLAUDE.md`: entry points.
- `docs/plan.md`: requirements, decisions, phases.
- `docs/data-sources.md`: every feed, its endpoint, refresh rate, and verification status.
- Later: `src/` for the React app, `api/` for Vercel Functions, `supabase/` for migrations, `routing/` for the Valhalla config.

## Phase rule

Nate approved Phase 1 in the project thread on 2026-10-18, so app code is now in scope. Later phases still need his go-ahead. The phases are in `docs/plan.md`.

## Engineering notes

- Use Cesium primitives, not Entities, for roads and trails. Entities slow down with thousands of lines.
- Update each fire in place by its fire ID. Remove a fire only after the next poll no longer lists it.
- Keep the last good result when a feed fails, especially the CAL FIRE incident pages, which are parsed from HTML.
- Use fixed filters for WFIGS queries. Don't use relative-date queries, because the service asks callers not to.
- Build hotspot logic on NOAA-20 and NOAA-21. Suomi NPP data stops in November 2026.
- Cap imagery detail at zoom 17 unless the camera is close.
- Secrets (FIRMS `MAP_KEY`, Cesium ion token, Supabase keys) go in environment variables. Never commit them.

## Git

- Default branch is `main`. Do work on a feature branch and open a PR, unless nate says otherwise.
- Commit messages: a short imperative subject line, with a body when the why isn't obvious.
