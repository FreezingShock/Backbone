// Open terrain for when no Cesium ion token is set: AWS Terrain Tiles (no key).
// Elevation is stored as PNG (Mapzen "terrarium" encoding): height = R*256 + G + B/256 - 32768 meters.
// The source is built from public-domain US and global DEMs, and needs attribution (shown as the globe credit).
import * as Cesium from 'cesium';

const TILE_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
/** Highest zoom the source has. Larger Cesium levels reuse it. */
export const MAX_TERRARIUM_ZOOM = 15;
const GRID = 65;
/** Decoded source tiles kept in memory. Each is 256 x 256 RGBA, 256 KB, so 96 is about 24 MB. A view needs far fewer. */
const CACHE_LIMIT = 96;
const CREDIT = 'Elevation: AWS Terrain Tiles (USGS and other public DEMs)';

interface DecodedTile {
  size: number;
  rgba: Uint8ClampedArray;
}

const decoded = new Map<string, Promise<DecodedTile>>();

function loadTile(z: number, x: number, y: number): Promise<DecodedTile> {
  const key = `${z}/${x}/${y}`;
  const cached = decoded.get(key);
  if (cached) return cached;

  const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const pending = (async (): Promise<DecodedTile> => {
    const image = await Cesium.Resource.fetchImage({ url });
    if (!image) throw new Error(`no image at ${url}`);
    const size = image.width;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas is unavailable');
    context.drawImage(image, 0, 0);
    return { size, rgba: context.getImageData(0, 0, size, size).data };
  })();

  decoded.set(key, pending);
  if (decoded.size > CACHE_LIMIT) {
    const oldest = decoded.keys().next().value;
    if (oldest !== undefined) decoded.delete(oldest);
  }
  // Failed tiles are retried on the next request.
  pending.catch(() => decoded.delete(key));
  return pending;
}

// Web Mercator stops at about 85.05 degrees. Cesium's top-level tiles reach the poles, so clamp.
const MERCATOR_LIMIT_DEG = 85.0511;

/** Web Mercator tile and pixel that hold a longitude and latitude at zoom z. */
function locate(lonDeg: number, latDeg: number, z: number) {
  const n = 2 ** z;
  const fx = ((lonDeg + 180) / 360) * n;
  const clampedLat = Math.min(Math.max(latDeg, -MERCATOR_LIMIT_DEG), MERCATOR_LIMIT_DEG);
  const lat = (clampedLat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  const x = Math.min(Math.max(Math.floor(fx), 0), n - 1);
  const y = Math.min(Math.max(Math.floor(fy), 0), n - 1);
  return { x, y, px: fx - x, py: fy - y };
}

/**
 * Elevations in meters on a grid of longitudes and latitudes (degrees).
 * Result is row-major: row r is lats[r], column c is lons[c]. Zoom z is the source zoom.
 */
export async function sampleHeightsAt(lons: number[], lats: number[], z: number): Promise<Float32Array> {
  const spots = lats.flatMap((lat) => lons.map((lon) => locate(lon, lat, z)));
  const needed = new Map<string, { x: number; y: number }>();
  for (const spot of spots) needed.set(`${spot.x}/${spot.y}`, { x: spot.x, y: spot.y });

  const tiles = new Map<string, DecodedTile>();
  await Promise.all(
    [...needed.entries()].map(async ([key, tile]) => {
      tiles.set(key, await loadTile(z, tile.x, tile.y));
    }),
  );

  const heights = new Float32Array(spots.length);
  spots.forEach((spot, index) => {
    const tile = tiles.get(`${spot.x}/${spot.y}`);
    if (!tile) return;
    const col = Math.min(Math.floor(spot.px * tile.size), tile.size - 1);
    const row = Math.min(Math.floor(spot.py * tile.size), tile.size - 1);
    const offset = (row * tile.size + col) * 4;
    const { rgba } = tile;
    const height = rgba[offset] * 256 + rgba[offset + 1] + rgba[offset + 2] / 256 - 32768;
    heights[index] = Number.isFinite(height) ? height : 0;
  });
  return heights;
}

/** Evenly spaced values from `first` to `last`, inclusive. */
function linspace(first: number, last: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => first + ((last - first) * i) / (count - 1));
}

const tilingScheme = new Cesium.GeographicTilingScheme();

export function createOpenTerrain(): Cesium.CustomHeightmapTerrainProvider {
  return new Cesium.CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme,
    credit: CREDIT,
    callback: async (x, y, level) => {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = Cesium.Math.toDegrees(rect.west);
      const east = Cesium.Math.toDegrees(rect.east);
      const south = Cesium.Math.toDegrees(rect.south);
      const north = Cesium.Math.toDegrees(rect.north);
      // Cesium levels run past the source's detail, so the lookup level is capped.
      const z = Math.min(MAX_TERRARIUM_ZOOM, level + 1);
      // Row 0 is the north edge, as in an image.
      return sampleHeightsAt(linspace(west, east, GRID), linspace(north, south, GRID), z);
    },
  });
}
