import type { MapLayer } from './types';
import { canyonRouteLayer } from './canyonRoute';
import { graticuleLayer } from './graticule';
import { placeLabelsLayer } from './placeLabels';
import { poiLayer } from './poi';
import { highwaysLayer, roadsLayer } from './roads';

/**
 * Every layer the map and layer panel know about.
 * To add a layer, write a MapLayer in its own file and append it here.
 * Feed layers (fire, closures) belong in this list too.
 * Order is draw order within a group: highways sit under the other roads, and the demo route sits on top.
 */
export const mapLayers: MapLayer[] = [graticuleLayer, highwaysLayer, roadsLayer, canyonRouteLayer, placeLabelsLayer, poiLayer];
