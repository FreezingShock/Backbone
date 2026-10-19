// Maneuver glyphs for the HUD and for map markers. Pure strings, so the same art serves both.
import type { StepKind } from './routeTypes';

/** Arrow glyph points up (north). `rotation` turns it to the maneuver's direction, in degrees clockwise. */
export function stepRotation(kind: StepKind): number {
  switch (kind) {
    case 'turn-left':
      return -90;
    case 'turn-right':
      return 90;
    case 'slight-left':
      return -40;
    case 'slight-right':
      return 40;
    case 'sharp-left':
      return -135;
    case 'sharp-right':
      return 135;
    case 'u-turn':
      return 180;
    default:
      return 0;
  }
}

/** Left and right turns and the other arrow kinds. Stop signs, signals, depart and arrive use their own glyphs. */
export function isArrowKind(kind: StepKind): boolean {
  return !['stop-sign', 'traffic-signal', 'depart', 'arrive'].includes(kind);
}

/** SVG markup for a 24x24 glyph, without the outer <svg> element. Fills use `ink`, backgrounds use `plate`. */
export function glyphMarkup(kind: StepKind, ink: string, accent: string): string {
  if (kind === 'stop-sign') {
    return `<polygon points="8.5,2.5 15.5,2.5 21.5,8.5 21.5,15.5 15.5,21.5 8.5,21.5 2.5,15.5 2.5,8.5" fill="${accent}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/><text x="12" y="13.6" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="5.2" font-weight="700" fill="#ffffff">STOP</text>`;
  }
  if (kind === 'traffic-signal') {
    return `<rect x="7" y="2.5" width="10" height="19" rx="2.2" fill="${ink}"/><circle cx="12" cy="7" r="2" fill="#ff5555"/><circle cx="12" cy="12" r="2" fill="#ffaa00"/><circle cx="12" cy="17" r="2" fill="#55ff55"/>`;
  }
  if (kind === 'depart') {
    return `<circle cx="12" cy="12" r="6.5" fill="${accent}" stroke="${ink}" stroke-width="1.6"/><circle cx="12" cy="12" r="2" fill="${ink}"/>`;
  }
  if (kind === 'arrive') {
    return `<path d="M6 21.5 V3 M6 4 H19 L15.8 8.2 L19 12.4 H6" fill="${accent}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  // Arrow: a chevron pointing up, rotated by the caller through stepRotation().
  return `<path d="M12 2.5 L21 20.5 L12 16 L3 20.5 Z" fill="${accent}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>`;
}

/** A complete SVG document for one maneuver, usable as a billboard image or a data URL. */
export function glyphSvg(kind: StepKind, ink: string, accent: string, plate: string): string {
  const rotate = isArrowKind(kind) ? ` transform="rotate(${stepRotation(kind)} 12 12)"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><circle cx="12" cy="12" r="11.5" fill="${plate}"/><g${rotate}>${glyphMarkup(kind, ink, accent)}</g></svg>`;
}

/** Glyph as a data URL, for Cesium billboards. */
export function glyphDataUrl(kind: StepKind, ink: string, accent: string, plate: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyphSvg(kind, ink, accent, plate))}`;
}

/** Plain-language name for a maneuver, used for callouts and the HUD when a step has no instruction of its own. */
export function stepTitle(kind: StepKind): string {
  switch (kind) {
    case 'depart':
      return 'Depart';
    case 'turn-left':
      return 'Turn left';
    case 'turn-right':
      return 'Turn right';
    case 'slight-left':
      return 'Bear left';
    case 'slight-right':
      return 'Bear right';
    case 'sharp-left':
      return 'Sharp left';
    case 'sharp-right':
      return 'Sharp right';
    case 'straight':
      return 'Continue straight';
    case 'u-turn':
      return 'U-turn';
    case 'stop-sign':
      return 'Stop sign';
    case 'traffic-signal':
      return 'Traffic light';
    case 'arrive':
      return 'Arrive';
  }
}
