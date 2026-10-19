// Starting routes that ship with the app. They are read-only: a preset is copied into saved routes to change it.
import { PLACES } from '../map/places';
import type { Network, Stop, StopKind } from './types';

export interface PresetRoute {
  id: string;
  name: string;
  blurb: string;
  network: Network;
  stops: Stop[];
}

/** A place from src/data/places.json as a stop. Its id is the place id, as the routing contract expects. */
export function placeStop(id: string): Stop {
  const place = PLACES.find((candidate) => candidate.id === id);
  if (!place) throw new Error(`Preset refers to a place that is not in places.json: ${id}`);
  const kind: StopKind = place.kind === 'city' || place.kind === 'town' || place.kind === 'neighborhood' ? 'city' : 'poi';
  return { id: place.id, name: place.name, kind, lon: place.lon, lat: place.lat };
}

export const PRESET_ROUTES: PresetRoute[] = [
  {
    id: 'preset-newbury-woodland',
    name: 'Newbury Park to Woodland Hills',
    blurb: 'Canyon crossings only, through the Santa Monica Mountains.',
    network: 'canyons',
    stops: [placeStop('newbury-park'), placeStop('woodland-hills')],
  },
  {
    id: 'preset-newbury-calabasas',
    name: 'Newbury Park to Calabasas',
    blurb: 'Four stops across the Conejo Valley, canyon crossings only.',
    network: 'canyons',
    stops: [placeStop('newbury-park'), placeStop('westlake-village'), placeStop('thousand-oaks'), placeStop('calabasas')],
  },
  {
    id: 'preset-woodland-topanga-malibu',
    name: 'Woodland Hills to Malibu over Topanga',
    blurb: 'Down Topanga Canyon to the coast, with a stop in Topanga.',
    network: 'canyons',
    stops: [placeStop('woodland-hills'), placeStop('topanga'), placeStop('malibu')],
  },
];
