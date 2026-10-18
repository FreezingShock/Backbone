import * as Cesium from 'cesium';
import type { MapLook } from '../map/look';
import { whenReady } from '../map/whenReady';
import type { LayerHandle, MapLayer } from './types';

// Box around Topanga and the Santa Monica Mountains. Approximate.
const BOUNDS = { west: -118.95, east: -118.5, south: 33.98, north: 34.2 };
const STEP_DEGREES = 0.02;

function lineCoordinates(): number[][] {
  const lines: number[][] = [];
  for (let lat = BOUNDS.south; lat <= BOUNDS.north + 1e-9; lat += STEP_DEGREES) {
    lines.push([BOUNDS.west, lat, BOUNDS.east, lat]);
  }
  for (let lon = BOUNDS.west; lon <= BOUNDS.east + 1e-9; lon += STEP_DEGREES) {
    lines.push([lon, BOUNDS.south, lon, BOUNDS.north]);
  }
  return lines;
}

export const graticuleLayer: MapLayer = {
  id: 'grid',
  label: 'Grid',
  group: 'Base',
  defaultVisible: true,
  mount(viewer, look): LayerHandle {
    const ids: string[] = [];
    const instances = lineCoordinates().map((coords, index) => {
      const id = `grid-${index}`;
      ids.push(id);
      return new Cesium.GeometryInstance({
        id,
        geometry: new Cesium.GroundPolylineGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(coords),
          width: 1,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(look.grid)),
        },
      });
    });
    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineColorAppearance(),
    });
    viewer.scene.primitives.add(primitive);

    // Attributes can be written only after the primitive is ready.
    const paint = (next: MapLook) => {
      const color = Cesium.ColorGeometryInstanceAttribute.toValue(Cesium.Color.fromCssColorString(next.grid));
      whenReady(viewer, primitive, () => {
        for (const id of ids) {
          const attributes = primitive.getGeometryInstanceAttributes(id);
          if (attributes) attributes.color = color;
        }
      });
    };

    return {
      show(visible) {
        primitive.show = visible;
      },
      restyle: paint,
      destroy() {
        if (!viewer.isDestroyed()) viewer.scene.primitives.remove(primitive);
      },
    };
  },
};
