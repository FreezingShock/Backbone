import * as Cesium from 'cesium';
import { CANYON_DEMO_STOPS } from '../lib/roads/demoRoute';
import { buildRoadGraph, planRoute, routeCoordinates, type RoadFeature } from '../lib/roads/route';
import type { MapLook } from '../map/look';
import { whenReady } from '../map/whenReady';
import { loadRoadCollection } from './roads';
import type { LayerHandle, MapLayer } from './types';

// Screen pixels. Wider than any road class, so the route reads over the canyon crossings.
const ROUTE_WIDTH = 7;
const ROUTE_ID = 'canyon-route';

const STOP_LIST = CANYON_DEMO_STOPS.map((stop, index) => `${index + 1} ${stop.name}`).join(', ');

/**
 * A demo route through canyon crossings only, from Newbury Park to Calabasas. It plans on the road graph when
 * first shown, so nothing is computed until the layer is turned on. It never uses a highway class road.
 */
export const canyonRouteLayer: MapLayer = {
  id: 'canyon-route',
  label: 'Canyon-only demo route',
  group: 'Roads',
  defaultVisible: false,
  legend: (look: MapLook) => [
    { label: 'Demo route, canyons only', color: look.roads.route.color, thickness: 4, opacity: look.roads.route.alpha },
  ],
  note: `Stops in order: ${STOP_LIST}. Each stop snaps to the nearest canyon crossing. The route never uses US 101 or PCH.`,
  mount(viewer, initialLook): LayerHandle {
    let primitive: Cesium.GroundPolylinePrimitive | null = null;
    let requested = false;
    let destroyed = false;
    let visible = false;
    let look = initialLook;

    const routeColor = () => Cesium.Color.fromCssColorString(look.roads.route.color).withAlpha(look.roads.route.alpha);

    const paint = () => {
      if (!primitive) return;
      const target = primitive;
      const attribute = Cesium.ColorGeometryInstanceAttribute.toValue(routeColor());
      whenReady(viewer, target, () => {
        const attributes = target.getGeometryInstanceAttributes(ROUTE_ID);
        if (attributes) attributes.color = attribute;
      });
    };

    const build = (features: RoadFeature[]) => {
      if (destroyed || viewer.isDestroyed()) return;
      const graph = buildRoadGraph(features, (cls) => cls === 'crossing');
      const route = planRoute(graph, CANYON_DEMO_STOPS);
      const positions = Cesium.Cartesian3.fromDegreesArray(routeCoordinates(graph, route).flat());
      primitive = new Cesium.GroundPolylinePrimitive({
        geometryInstances: new Cesium.GeometryInstance({
          id: ROUTE_ID,
          geometry: new Cesium.GroundPolylineGeometry({ positions, width: ROUTE_WIDTH }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(routeColor()) },
        }),
        appearance: new Cesium.PolylineColorAppearance(),
      });
      primitive.show = visible;
      viewer.scene.primitives.add(primitive);
    };

    return {
      show(next) {
        visible = next;
        if (primitive) primitive.show = next;
        if (next && !requested) {
          requested = true;
          loadRoadCollection()
            .then((data) => build(data.features))
            .catch((error: unknown) => {
              console.warn('Canyon route: could not plan the demo route', error);
            });
        }
      },
      restyle(next) {
        look = next;
        paint();
      },
      destroy() {
        destroyed = true;
        if (viewer.isDestroyed() || !primitive) return;
        viewer.scene.primitives.remove(primitive);
      },
    };
  },
};
