// Cities, towns and neighborhoods, drawn as names. The layer panel calls this "Towns and cities".
import { SETTLEMENT_KINDS, PLACES } from '../map/places';
import { mountPlaceMarkers } from './placeMarkers';
import type { MapLayer } from './types';

export const placeLabelsLayer: MapLayer = {
  id: 'place-labels',
  label: 'Towns and cities',
  group: 'Places',
  defaultVisible: true,
  mount(viewer, look) {
    return mountPlaceMarkers(
      viewer,
      look,
      PLACES.filter((place) => SETTLEMENT_KINDS.includes(place.kind)),
    );
  },
};
