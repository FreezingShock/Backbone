import type { RouteStop } from './route';

/**
 * The canyon-only demo: Newbury Park to Westlake Village to Thousand Oaks to Calabasas, on canyon crossings only.
 * Coordinates are approximate town centers. Planning snaps each one to the nearest canyon crossing, and the test
 * checks how far each snap moved. Nothing here is surveyed.
 */
export const CANYON_DEMO_STOPS: RouteStop[] = [
  { name: 'Newbury Park', lon: -118.9226, lat: 34.1786 },
  { name: 'Westlake Village', lon: -118.8079, lat: 34.1458 },
  { name: 'Thousand Oaks', lon: -118.8376, lat: 34.1706 },
  { name: 'Calabasas', lon: -118.6615, lat: 34.1439 },
];
