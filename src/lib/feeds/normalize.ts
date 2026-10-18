// Pure normalizers: raw feed records in, typed Backbone features out. No I/O, so they are unit tested.
import type { Bbox, ClosureFeature, FireFeature, Geometry, LineGeometry, PolygonGeometry } from './types';
import type { CalFireIncident } from './calfire';

export type RawProps = Record<string, unknown>;

export interface RawFeature {
  type?: string;
  id?: unknown;
  geometry: Geometry | null;
  properties: RawProps | null;
}

export interface RawCollection {
  type?: string;
  features?: RawFeature[];
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};

// ArcGIS returns dates as epoch milliseconds. Strings are parsed as ISO-like dates.
const isoTime = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim() !== '') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
};

// Returns the first alias whose value reads as a valid field. ArcGIS field names vary by layer.
function pick<T>(props: RawProps, keys: string[], read: (value: unknown) => T | null): T | null {
  for (const key of keys) {
    const value = read(props[key]);
    if (value !== null) return value;
  }
  return null;
}

// Name key used to match a perimeter to a CAL FIRE page: "Bryson Fire" and "BRYSON" both give "bryson".
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/\bfire\b/g, '').replace(/[^a-z0-9]/g, '');
}

export function normalizeWfigsFeature(
  raw: RawFeature,
  perimeterSource: 'wfigs' | 'fixture',
): FireFeature | null {
  if (!raw.geometry || (raw.geometry.type !== 'Polygon' && raw.geometry.type !== 'MultiPolygon')) return null;
  const props = raw.properties ?? {};

  const name = pick(props, ['poly_IncidentName', 'attr_IncidentName', 'irwin_IncidentName'], str) ?? 'Unnamed fire';
  const unique = pick(props, ['attr_UniqueFireIdentifier', 'irwin_UniqueFireIdentifier'], str);
  // Prefer the official fire ID. Fall back to the name so the id stays stable across polls.
  const fireId = unique ?? `name:${nameKey(name)}`;

  return {
    type: 'Feature',
    id: fireId,
    geometry: raw.geometry as PolygonGeometry,
    properties: {
      fireId,
      name,
      acres: pick(props, ['poly_GISAcres', 'attr_IncidentSize'], num),
      containmentPct: pick(props, ['attr_PercentContained'], num),
      discovered: pick(props, ['attr_FireDiscoveryDateTime'], isoTime),
      updated: pick(props, ['poly_DateCurrent', 'attr_ModifiedOnDateTime'], isoTime),
      state: pick(props, ['attr_POOState'], str),
      perimeterSource,
      incidentSource: null,
      incidentUrl: null,
      incidentUpdatedText: null,
    },
  };
}

// Lon/lat bounding-box overlap test. Features are kept or dropped whole. Geometry is not clipped.
export function intersectsBbox(geometry: Geometry, box: Bbox): boolean {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [x, y] = value as number[];
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  return east >= box.west && west <= box.east && north >= box.south && south <= box.north;
}

// Keeps one feature per fire id, preferring the most recently updated perimeter.
export function dedupeFires(features: FireFeature[]): FireFeature[] {
  const byId = new Map<string, FireFeature>();
  for (const feature of features) {
    const current = byId.get(feature.id);
    const currentTime = current?.properties.updated ? Date.parse(current.properties.updated) : -Infinity;
    const nextTime = feature.properties.updated ? Date.parse(feature.properties.updated) : -Infinity;
    if (!current || nextTime > currentTime) byId.set(feature.id, feature);
  }
  return [...byId.values()];
}

// CAL FIRE wins for acres and containment when the page has them. The perimeter's own numbers are the fallback.
export function mergeIncident(fire: FireFeature, incident: CalFireIncident | undefined): FireFeature {
  if (!incident || nameKey(incident.name) !== nameKey(fire.properties.name)) return fire;
  return {
    ...fire,
    properties: {
      ...fire.properties,
      // The CAL FIRE page has the display name ("Bryson Fire"). WFIGS uses upper case ("BRYSON").
      name: incident.name,
      acres: incident.acres ?? fire.properties.acres,
      containmentPct: incident.containmentPct ?? fire.properties.containmentPct,
      incidentSource: 'calfire',
      incidentUrl: incident.url,
      incidentUpdatedText: incident.updatedText,
    },
  };
}

const CLOSURE_STATUSES = new Set(['closed', 'open', 'unknown']);

function isLineGeometry(value: unknown): value is LineGeometry {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type === 'Point') {
    return Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2;
  }
  if (geometry.type === 'LineString') {
    return Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2;
  }
  return false;
}

// Hand-curated closures (src/lib/feeds/data/closure-overrides.json). Each entry needs a road, a status,
// and a Point or LineString. Entries past expiresAt are dropped.
export function normalizeOverrides(raw: unknown, now: number): ClosureFeature[] {
  const entries = (raw as { closures?: unknown })?.closures;
  if (!Array.isArray(entries)) return [];
  const features: ClosureFeature[] = [];
  for (const entry of entries as Array<Record<string, unknown>>) {
    const id = str(entry.id);
    const road = str(entry.road);
    const status = str(entry.status);
    if (!id || !road || !status || !CLOSURE_STATUSES.has(status) || !isLineGeometry(entry.geometry)) continue;
    const expires = str(entry.expiresAt);
    if (expires && Date.parse(expires) <= now) continue;
    features.push({
      type: 'Feature',
      id,
      geometry: entry.geometry,
      properties: {
        closureId: id,
        road,
        status: status as ClosureFeature['properties']['status'],
        reason: str(entry.reason),
        source: str(entry.source) ?? 'manual override',
        recordedAt: str(entry.recordedAt),
        geometryNote: str(entry.geometryNote),
      },
    });
  }
  return features;
}

// Optional Caltrans-style GeoJSON. UNVERIFIED schema: property names are guesses. Confirm against the
// real file before relying on it.
export function normalizeCaltransFeatures(raw: unknown): ClosureFeature[] {
  const features = (raw as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: ClosureFeature[] = [];
  features.forEach((item: unknown, index: number) => {
    const feature = item as { geometry?: unknown; properties?: RawProps | null };
    if (!isLineGeometry(feature.geometry)) return;
    const props = feature.properties ?? {};
    const road = pick(props, ['route', 'Route', 'road', 'Road', 'name'], str);
    if (!road) return;
    const rawStatus = (pick(props, ['status', 'Status', 'event_status'], str) ?? '').toLowerCase();
    const id = str(props.id) ?? `${index}`;
    out.push({
      type: 'Feature',
      id: `caltrans:${id}`,
      geometry: feature.geometry,
      properties: {
        closureId: `caltrans:${id}`,
        road,
        status: /closed|closure/.test(rawStatus) ? 'closed' : 'unknown',
        reason: pick(props, ['description', 'Description', 'reason'], str),
        source: 'Caltrans',
        recordedAt: pick(props, ['updated', 'last_updated', 'LastUpdated'], isoTime),
        geometryNote: null,
      },
    });
  });
  return out;
}


