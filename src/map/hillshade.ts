// Hillshade imagery for the Relief style. Shading is computed on the CPU from the same open elevation
// tiles, so it works without an ion token. Cesium's globe lighting does not shade custom heightmap terrain
// (no vertex normals), so the relief shading is baked into an imagery layer instead.
import * as Cesium from 'cesium';
import { MAX_TERRARIUM_ZOOM, sampleHeightsAt } from './openTerrain';

export interface HillshadePalette {
  /** Color of the shadowed slopes. */
  shadow: string;
  /** Color of the sunlit slopes. */
  highlight: string;
}

const TILE_PX = 256;
// Sun from the northwest (compass 315 degrees) at 40 degrees above the horizon.
const SUN_AZIMUTH = (315 * Math.PI) / 180;
const SUN_ALTITUDE = (40 * Math.PI) / 180;
// Light vector in (east, north, up).
const SUN = {
  east: Math.cos(SUN_ALTITUDE) * Math.sin(SUN_AZIMUTH),
  north: Math.cos(SUN_ALTITUDE) * Math.cos(SUN_AZIMUTH),
  up: Math.sin(SUN_ALTITUDE),
};
// Slopes are exaggerated, the usual cartographic trick, so ridges read at this scale.
const SLOPE_EXAGGERATION = 2.5;
const SHADOW_FLOOR = 0.08;

function rgb(hex: string): [number, number, number] {
  const value = Cesium.Color.fromCssColorString(hex);
  return [value.red * 255, value.green * 255, value.blue * 255];
}

/**
 * Imagery provider for one hillshade palette. Built as a plain object: Cesium's ImageryProvider base
 * class cannot be subclassed, and ImageryLayer only reads the members below.
 */
export function createHillshade(palette: HillshadePalette): Cesium.ImageryProvider {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const shadow = rgb(palette.shadow);
  const highlight = rgb(palette.highlight);

  async function renderTile(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const rect = tilingScheme.tileXYToRectangle(x, y, level);
    const west = Cesium.Math.toDegrees(rect.west);
    const east = Cesium.Math.toDegrees(rect.east);
    const south = Cesium.Math.toDegrees(rect.south);
    const north = Cesium.Math.toDegrees(rect.north);

    // One extra sample on each side, for the 3x3 neighborhood at the tile edge.
    const stepLon = (east - west) / TILE_PX;
    const stepLat = (north - south) / TILE_PX;
    const cell = TILE_PX + 2;
    const lons = Array.from({ length: cell }, (_, k) => west + (k - 1) * stepLon);
    const lats = Array.from({ length: cell }, (_, k) => north - (k - 1) * stepLat);
    const heights = await sampleHeightsAt(lons, lats, Math.min(MAX_TERRARIUM_ZOOM, level + 1));

    const midLat = Cesium.Math.toRadians((north + south) / 2);
    const dx = stepLon * 111320 * Math.cos(midLat); // meters per sample, east-west
    const dy = stepLat * 110540; // meters per sample, north-south

    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable');
    const image = context.createImageData(TILE_PX, TILE_PX);

    for (let j = 0; j < TILE_PX; j++) {
      for (let i = 0; i < TILE_PX; i++) {
        const r = j + 1;
        const c = i + 1;
        const at = (row: number, col: number) => heights[row * cell + col];
        // Horn's method: slope from the 3x3 neighborhood.
        const gEast =
          (at(r - 1, c + 1) + 2 * at(r, c + 1) + at(r + 1, c + 1) - (at(r - 1, c - 1) + 2 * at(r, c - 1) + at(r + 1, c - 1))) /
          (8 * dx);
        const gNorth =
          (at(r - 1, c - 1) + 2 * at(r - 1, c) + at(r - 1, c + 1) - (at(r + 1, c - 1) + 2 * at(r + 1, c) + at(r + 1, c + 1))) /
          (8 * dy);
        const east = gEast * SLOPE_EXAGGERATION;
        const north = gNorth * SLOPE_EXAGGERATION;
        const length = Math.sqrt(east * east + north * north + 1);
        const lit = (-east * SUN.east - north * SUN.north + SUN.up) / length;
        // Flat ground gets full highlight. Only slopes turned away from the sun fall toward the shadow color.
        const v = Math.min(1, Math.max(SHADOW_FLOOR, lit / SUN.up));

        const offset = (j * TILE_PX + i) * 4;
        image.data[offset] = shadow[0] + (highlight[0] - shadow[0]) * v;
        image.data[offset + 1] = shadow[1] + (highlight[1] - shadow[1]) * v;
        image.data[offset + 2] = shadow[2] + (highlight[2] - shadow[2]) * v;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  const provider = {
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileWidth: TILE_PX,
    tileHeight: TILE_PX,
    // Terrain detail stops at MAX_TERRARIUM_ZOOM. Imagery level L uses zoom L + 1.
    maximumLevel: MAX_TERRARIUM_ZOOM - 1,
    minimumLevel: 0,
    ready: true,
    readyPromise: Promise.resolve(true),
    credit: new Cesium.Credit('Relief shading: AWS Terrain Tiles (USGS and other public DEMs)'),
    hasAlphaChannel: false,
    errorEvent: new Cesium.Event(),
    requestImage: (x: number, y: number, level: number) => renderTile(x, y, level),
    pickFeatures: () => undefined,
    getTileCredits: () => [],
  };
  return provider as unknown as Cesium.ImageryProvider;
}
