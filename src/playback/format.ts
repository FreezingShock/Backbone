// Display formatting for the HUD. Pure, so it is tested under node. US units, since the roads are in California.

const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

/** Short distance: feet under about a sixth of a mile, then miles. */
export function formatDistance(meters: number): string {
  const feet = meters * FEET_PER_METER;
  if (feet < 800) return `${Math.max(0, Math.round(feet / 10) * 10)} ft`;
  const miles = meters / METERS_PER_MILE;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/** Duration as "38 min", "1 h 4 min" or "2 h". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(Math.max(seconds, 0) / 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Clock time of an ISO string in the viewer's locale, such as "6:42 PM". */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Playback time as "m:ss", or "h:mm:ss" past an hour. */
export function formatClockTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
