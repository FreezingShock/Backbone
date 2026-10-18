// Named places and points of interest. The data lives in src/data/places.json; see docs/data-sources.md for sources.
import data from '../data/places.json';

export type PlaceKind =
  | 'city'
  | 'town'
  | 'neighborhood'
  | 'peak'
  | 'canyon'
  | 'park'
  | 'beach'
  | 'trailhead'
  | 'lookout'
  | 'landmark';

/** One row of src/data/places.json. */
export interface PlaceData {
  id: string;
  name: string;
  kind: PlaceKind;
  /** Degrees, WGS84. Checked against Wikidata and OpenStreetMap; see `source`. */
  lon: number;
  lat: number;
  /** One or two plain sentences. Written for this app, not copied from a source. */
  blurb: string;
  /** Where the coordinates came from and how they were checked, e.g. "Wikidata Q6743398; OpenStreetMap 3.7 km away". */
  source: string;
}

export interface Place extends PlaceData {
  /** Camera distance for a fly-to, in meters. The camera looks down at the place from 45 degrees. */
  range: number;
}

export const KIND_LABEL: Record<PlaceKind, string> = {
  city: 'City',
  town: 'Town',
  neighborhood: 'Neighborhood',
  peak: 'Peak',
  canyon: 'Canyon',
  park: 'Park',
  beach: 'Beach',
  trailhead: 'Trailhead',
  lookout: 'Lookout',
  landmark: 'Landmark',
};

/** Cities, towns and neighborhoods. Drawn as names. */
export const SETTLEMENT_KINDS: readonly PlaceKind[] = ['city', 'town', 'neighborhood'];

/** Everything else. Drawn as icons with names, and hidden sooner when zoomed out. */
export const POI_KINDS: readonly PlaceKind[] = ['peak', 'canyon', 'park', 'beach', 'trailhead', 'lookout', 'landmark'];

/** Fly-to distance by kind: a town fills more of the screen than a beach, so it is framed farther out. */
const RANGE_BY_KIND: Record<PlaceKind, number> = {
  city: 30000,
  town: 14000,
  neighborhood: 9000,
  park: 14000,
  canyon: 11000,
  peak: 8000,
  beach: 7000,
  trailhead: 4000,
  lookout: 4000,
  landmark: 6000,
};

export const PLACES: Place[] = (data as PlaceData[]).map((place) => ({
  ...place,
  range: RANGE_BY_KIND[place.kind],
}));

export const HOME_PLACE: Place = PLACES.find((place) => place.id === 'topanga') ?? PLACES[0];

/** A wide view of the whole area. Used by the Region button; not a dataset entry. */
export const REGION_VIEW: Place = {
  id: 'region',
  name: 'Santa Monica Mountains',
  kind: 'park',
  lon: -118.74,
  lat: 34.1,
  blurb: 'The whole Santa Monica Mountains, from Malibu to the Conejo Valley.',
  source: '',
  range: 60000,
};

/**
 * Matches by name, case-insensitively. Names that start with the query come first, then names with the query
 * inside them. Kind names also match, so "peak" lists the peaks.
 */
export function searchPlaces(query: string, places: readonly Place[] = PLACES, limit = 12): Place[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { place: Place; score: number }[] = [];
  for (const place of places) {
    const name = place.name.toLowerCase();
    const kind = KIND_LABEL[place.kind].toLowerCase();
    let score = -1;
    if (name.startsWith(needle)) score = 0;
    else if (name.split(/[\s-]+/).some((word) => word.startsWith(needle))) score = 1;
    else if (name.includes(needle)) score = 2;
    else if (kind === needle) score = 3;
    if (score >= 0) scored.push({ place, score });
  }
  scored.sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name));
  return scored.slice(0, limit).map((entry) => entry.place);
}
