// Server-side feed configuration. Read by api/ handlers only. Do not import from client code.
import type { Bbox } from './types';

// Santa Monica Mountains and Topanga, as a lon/lat box. Feeds are filtered to this box.
export const SMM_BBOX: Bbox = { west: -119.05, south: 33.95, east: -118.35, north: 34.2 };

// Server-side cache lifetime for live feeds. Matches the 5-minute poll.
export const CACHE_TTL_MS = 5 * 60_000;
// After a failed live fetch, wait this long before trying the source again.
export const RETRY_BACKOFF_MS = 60_000;
export const FETCH_TIMEOUT_MS = 10_000;

export const USER_AGENT =
  'Backbone/0.1 (open-data, non-commercial map; https://github.com/FreezingShock/Backbone)';

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

// NIFC WFIGS current wildland fire perimeters (ArcGIS Feature Service). UNVERIFIED from this
// sandbox: services3.arcgis.com returned a proxy 403. Confirm the layer name on first live fetch.
export const WFIGS_PERIMETERS_URL =
  readEnv('WFIGS_PERIMETERS_URL') ??
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0';

// CAL FIRE incident pages, comma-separated. Parsed from HTML. UNVERIFIED from this sandbox.
export const CALFIRE_INCIDENT_URLS: string[] = (
  readEnv('CALFIRE_INCIDENT_URLS') ?? 'https://www.fire.ca.gov/incidents/2026/10/15/bryson-fire'
)
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

// Optional state closures feed (GeoJSON). Off until a URL is confirmed. See src/lib/feeds/README.md.
export const CALTRANS_CLOSURES_URL: string | null = readEnv('CALTRANS_CLOSURES_URL') ?? null;

// Fixture fallback serves bundled sample data when no live result exists. Off by default so
// production never shows sample data as live. The local runner turns it on.
export function fixturesEnabled(): boolean {
  return process.env.BACKBONE_FEED_FIXTURES === '1';
}
