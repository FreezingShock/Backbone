// Runtime config from Vite env vars. See .env.example.

/** Public USGS imagery service (ArcGIS MapServer tile cache). Not verified live from the build sandbox. */
export const DEFAULT_IMAGERY_URL =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer';

/** Imagery detail cap from CLAUDE.md. Closer views should stay within this level. */
export const MAX_IMAGERY_LEVEL = 17;

export const config = {
  cesiumIonToken: (import.meta.env.VITE_CESIUM_ION_TOKEN ?? '').trim(),
  imageryUrl: (import.meta.env.VITE_IMAGERY_URL ?? '').trim() || DEFAULT_IMAGERY_URL,
};
