import type { LonLat } from './types';

// Google's encoded polyline format at precision 5 (about 1.1 m). Small, text-safe, and easy to decode in the browser.
const FACTOR = 1e5;

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** Encodes [lon, lat] points. Coordinates are rounded to 5 decimals first. */
export function encodePolyline(points: LonLat[]): string {
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  for (const [lon, lat] of points) {
    const latE5 = Math.round(lat * FACTOR);
    const lonE5 = Math.round(lon * FACTOR);
    out += encodeValue(latE5 - prevLat) + encodeValue(lonE5 - prevLon);
    prevLat = latE5;
    prevLon = lonE5;
  }
  return out;
}

/** Decodes a string made by encodePolyline. Returns [lon, lat] points. */
export function decodePolyline(encoded: string): LonLat[] {
  const points: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readValue();
    lon += readValue();
    points.push([lon / FACTOR, lat / FACTOR]);
  }
  return points;
}
