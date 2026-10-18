// Pure helpers for the scale bar. No Cesium import, so they can be unit tested in Node.

/** A round length (1, 2 or 5 times a power of ten) that fits within about `targetPx` on screen. */
export function niceLength(metersPerPixel: number, targetPx = 110): { meters: number; px: number } {
  const raw = metersPerPixel * targetPx;
  const power = 10 ** Math.floor(Math.log10(raw));
  let meters = power;
  for (const step of [2, 5, 10]) {
    if (step * power <= raw) meters = step * power;
  }
  return { meters, px: meters / metersPerPixel };
}

export function formatLength(meters: number): string {
  if (meters >= 1000) return `${Number((meters / 1000).toFixed(meters >= 10000 ? 0 : 1))} km`;
  return `${Math.round(meters)} m`;
}
