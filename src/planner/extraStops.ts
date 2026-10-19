// Stops the routing data does not carry yet. Each one was checked before it went in, and `source` says how.
// When the routing data gains the same place, the search drops the copy below by name (see engine.ts).
import type { Stop } from './types';

export interface ExtraStop extends Stop {
  source: string;
}

export const EXTRA_STOPS: readonly ExtraStop[] = [
  {
    id: 'extra:calabasas-high-school',
    name: 'Calabasas High School',
    kind: 'poi',
    lon: -118.62722,
    lat: 34.13855,
    source:
      'OpenStreetMap way 666547852 (Nominatim search, 2026-10-19: amenity=school, 22855 Mulholland Hwy); Wikidata Q5018284',
  },
];
