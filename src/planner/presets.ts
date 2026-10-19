// Starting routes that ship with the app. They are read-only: a preset is copied into saved routes to change it.
import { PLACE_STOPS } from './engine';
import type { Network, Stop } from './types';

export interface PresetRoute {
  id: string;
  name: string;
  blurb: string;
  network: Network;
  stops: Stop[];
}

function place(id: string): Stop {
  const stop = PLACE_STOPS.find((candidate) => candidate.id === `place:${id}`);
  if (!stop) throw new Error(`Preset refers to a place that is not in places.json: ${id}`);
  return stop;
}

export const PRESET_ROUTES: PresetRoute[] = [
  {
    id: 'preset-newbury-woodland',
    name: 'Newbury Park to Woodland Hills',
    blurb: 'Canyon crossings only, through the Santa Monica Mountains.',
    network: 'canyons',
    stops: [place('newbury-park'), place('woodland-hills')],
  },
  {
    id: 'preset-newbury-calabasas',
    name: 'Newbury Park to Calabasas',
    blurb: 'Four stops across the Conejo Valley, canyon crossings only.',
    network: 'canyons',
    stops: [place('newbury-park'), place('westlake-village'), place('thousand-oaks'), place('calabasas')],
  },
  {
    id: 'preset-woodland-topanga-malibu',
    name: 'Woodland Hills to Malibu over Topanga',
    blurb: 'Down Topanga Canyon to the coast, with a stop in Topanga.',
    network: 'canyons',
    stops: [place('woodland-hills'), place('topanga'), place('malibu')],
  },
];
