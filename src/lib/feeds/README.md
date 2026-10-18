# Feed layer

Server code in `api/` returns GeoJSON for the map. Shared logic lives here in `src/lib/feeds/`.

## Endpoints

| Route | What it returns | Sources |
|-------|-----------------|---------|
| `GET /api/fires` | Fire perimeters in the Santa Monica Mountains box. Feature `id` is the fire ID. Acres and containment come from CAL FIRE when the names match. | NIFC WFIGS perimeters, CAL FIRE incident pages |
| `GET /api/closures` | Road closures as points or lines. | Hand-curated `data/closure-overrides.json`, plus an optional Caltrans GeoJSON |

Each response has a top-level `meta` with per-feed status: `mode`, `fetchedAt`, `ageSeconds`, `sourceUrl`, and `error`. Show the age on each layer.

Modes: `live` (fetched now), `stale` (live fetch failed, serving the last good result), `fixture` (sample data, dev only), `static` (bundled file), `disabled` (not configured), `error` (no data; `/api/fires` returns 503).

Caching: live responses send `s-maxage=300`. Stale responses are short-cached. Fixture and error responses are `no-store`.

## Run locally

From the repo root:

```sh
npx -y tsx src/lib/feeds/localApi.ts        # http://localhost:8787 (set BACKBONE_API_PORT to change)
curl -s localhost:8787/api/fires | head
npx -y tsx --test src/lib/feeds/feeds.test.ts
```

The local runner turns on fixture fallback, so the endpoints work without internet. Production does not, unless `BACKBONE_FEED_FIXTURES=1` is set.

Needs Node 22 or later and `@types/node` for type checking. Once the app scaffold lands, `package.json` scripts can wrap these commands. Client code can call `/api/...` through the Vite dev proxy, or through `localApi.ts` mounted in Vite's `configureServer`.

Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set. Set that if you run behind a proxy.

## Client helpers

- `useFeed(url, intervalMs)`: polls every 5 minutes by default. Keeps the last good data when a poll fails.
- `diffById(previous, next)`: returns `added`, `updated`, and `removed` ids. Update a fire in place. Remove it only after a poll stops listing it.

## Environment variables (server)

| Name | Default | Purpose |
|------|---------|---------|
| `WFIGS_PERIMETERS_URL` | WFIGS current perimeters, FeatureServer layer 0 | ArcGIS layer to query |
| `CALFIRE_INCIDENT_URLS` | Bryson Fire page | Comma-separated CAL FIRE incident pages |
| `CALTRANS_CLOSURES_URL` | unset (disabled) | Optional GeoJSON closures feed |
| `BACKBONE_FEED_FIXTURES` | unset (off) | `1` serves bundled sample data when live feeds fail |
| `BACKBONE_API_PORT` | `8787` | Local runner port |

## Verification status

Checked from the build sandbox on 2026-10-18. Its egress policy returned 403 for every government host, including `services3.arcgis.com`, `fire.ca.gov`, `cwwp2.dot.ca.gov`, `api.dot.ca.gov`, `catalog.data.gov`, and `nationalmap.gov`. None of these were reached.

- **WFIGS**: the query is built and tested offline. The layer URL and field names are unverified. The normalizer tries several field aliases (`poly_*`, `attr_*`, `irwin_*`). Confirm on the first live fetch.
- **CAL FIRE**: the parser is tested against a hand-written sample (`fixtures/calfire-bryson.sample.ts`), not a saved page. Confirm the real markup first.
- **Caltrans**: the adapter is written against a guessed GeoJSON schema and is off until `CALTRANS_CLOSURES_URL` is set. Confirm the file and fields first.
- **Encinal Canyon Road and Decker Road**: closed per the CAL FIRE Bryson page, as recorded in `docs/plan.md`. Entries are hand-placed approximate points.
- **Fixtures**: `fixtures/wfigs-perimeters.sample.json` has a rough hand-drawn Bryson polygon and one out-of-area fire. Neither is live data. Responses served from fixtures say so in `meta.feeds[].mode`.

## Not done yet

- Geometric clipping. Fires are kept or dropped by bounding-box overlap, not clipped to the box.
- Fire discovery from the CAL FIRE index. Only the listed pages are read.
- FIRMS hotspots. These need a `MAP_KEY` and are a separate step.
- A Supabase snapshot. The cache is per server instance for now.
- Scheduled polling. The current design fetches on request with a 5-minute cache. Vercel cron or an external scheduler can warm the cache later.
