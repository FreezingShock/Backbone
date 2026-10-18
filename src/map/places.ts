export interface Place {
  id: string;
  name: string;
  /** Degrees. Approximate, not yet checked against a survey map. */
  lon: number;
  lat: number;
  /** Camera distance from the place, in meters. The camera looks down at it from 45 degrees. */
  range: number;
}

export const PLACES: Place[] = [
  { id: 'topanga', name: 'Topanga', lon: -118.6015, lat: 34.0975, range: 9000 },
  { id: 'encinal', name: 'Encinal Cyn', lon: -118.9, lat: 34.04, range: 9000 },
  { id: 'malibu', name: 'Malibu', lon: -118.72, lat: 34.03, range: 12000 },
  { id: 'sm-mtns', name: 'SM Mtns', lon: -118.7, lat: 34.07, range: 28000 },
];

export const HOME_PLACE = PLACES[0];
