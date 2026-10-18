import type { MapLayer } from './types';
import { graticuleLayer } from './graticule';
import { placeLabelsLayer } from './placeLabels';
import { roadsLayer } from './roads';

/**
 * Every layer the map and layer panel know about.
 * To add a layer, write a MapLayer in its own file and append it here.
 * Feed layers (fire, closures) belong in this list too.
 */
export const mapLayers: MapLayer[] = [graticuleLayer, roadsLayer, placeLabelsLayer];
