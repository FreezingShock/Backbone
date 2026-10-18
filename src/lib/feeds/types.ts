// Shared types for the feed layer. Client-safe: no Node imports here.
// GeoJSON types are declared locally so this code has no type dependency.

export type Position = number[];

export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface Feature<G extends Geometry, P> {
  type: 'Feature';
  // Stable key. The client updates features in place by this id.
  id: string;
  geometry: G;
  properties: P;
}

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type FeedName = 'wfigs' | 'calfire' | 'caltrans' | 'overrides';

// live: fetched now. static: a bundled file. stale: last good result, live fetch failed.
// fixture: bundled sample used because no live result exists (dev only). disabled: not configured.
// error: nothing to serve.
export type FeedMode = 'live' | 'static' | 'stale' | 'fixture' | 'disabled' | 'error';

export interface FeedStatus {
  feed: FeedName;
  mode: FeedMode;
  fetchedAt: string | null;
  ageSeconds: number | null;
  sourceUrl: string | null;
  error: string | null;
}

export interface ResponseMeta {
  generatedAt: string;
  // Cache lifetime the server asks for, in seconds.
  ttlSeconds: number;
  feeds: FeedStatus[];
}

export interface FeatureCollection<F> {
  type: 'FeatureCollection';
  features: F[];
  meta: ResponseMeta;
}

export interface FireProperties {
  fireId: string;
  name: string;
  acres: number | null;
  containmentPct: number | null;
  discovered: string | null;
  updated: string | null;
  state: string | null;
  perimeterSource: 'wfigs' | 'fixture';
  // Set when a CAL FIRE incident page matched this fire by name.
  incidentSource: 'calfire' | null;
  incidentUrl: string | null;
  // CAL FIRE shows a human-written time (Pacific), so it is kept as text.
  incidentUpdatedText: string | null;
}

export type PolygonGeometry = Extract<Geometry, { type: 'Polygon' | 'MultiPolygon' }>;
export type FireFeature = Feature<PolygonGeometry, FireProperties>;
export type FireCollection = FeatureCollection<FireFeature>;

export type ClosureStatus = 'closed' | 'open' | 'unknown';

export interface ClosureProperties {
  closureId: string;
  road: string;
  status: ClosureStatus;
  reason: string | null;
  source: string;
  recordedAt: string | null;
  // Set when a point or line was placed by hand and is not surveyed.
  geometryNote: string | null;
}

export type LineGeometry = Extract<Geometry, { type: 'Point' | 'LineString' }>;
export type ClosureFeature = Feature<LineGeometry, ClosureProperties>;
export type ClosureCollection = FeatureCollection<ClosureFeature>;
