// Points of interest: canyons, peaks, parks, beaches, trailheads, lookouts and landmarks.
import { POI_KINDS, PLACES } from '../map/places';
import { mountPlaceMarkers } from './placeMarkers';
import type { MapLayer } from './types';

export const poiLayer: MapLayer = {
  id: 'poi',
  label: 'Points of interest',
  group: 'Places',
  defaultVisible: true,
  note: 'Places: OpenStreetMap contributors (ODbL) and Wikidata (CC0). Coordinates checked against both.',
  mount(viewer, look) {
    return mountPlaceMarkers(
      viewer,
      look,
      PLACES.filter((place) => POI_KINDS.includes(place.kind)),
    );
  },
};
