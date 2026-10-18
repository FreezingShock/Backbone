import * as Cesium from 'cesium';
import type { LayerHandle, MapLayer } from './types';

// Box around Topanga and the Santa Monica Mountains. Approximate.
const BOUNDS = { west: -118.95, east: -118.5, south: 33.98, north: 34.2 };
const STEP_DEGREES = 0.02;
const LINE_COLOR = Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.35);

function lineInstances(): Cesium.GeometryInstance[] {
  const instances: Cesium.GeometryInstance[] = [];
  const color = Cesium.ColorGeometryInstanceAttribute.fromColor(LINE_COLOR);

  const addLine = (coords: number[]) => {
    instances.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(coords),
          width: 1,
        }),
        attributes: { color },
      }),
    );
  };

  for (let lat = BOUNDS.south; lat <= BOUNDS.north + 1e-9; lat += STEP_DEGREES) {
    addLine([BOUNDS.west, lat, BOUNDS.east, lat]);
  }
  for (let lon = BOUNDS.west; lon <= BOUNDS.east + 1e-9; lon += STEP_DEGREES) {
    addLine([lon, BOUNDS.south, lon, BOUNDS.north]);
  }
  return instances;
}

export const graticuleLayer: MapLayer = {
  id: 'grid',
  label: 'Grid',
  group: 'Base',
  defaultVisible: true,
  mount(viewer): LayerHandle {
    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: lineInstances(),
      appearance: new Cesium.PolylineColorAppearance(),
    });
    viewer.scene.primitives.add(primitive);

    return {
      show(visible) {
        primitive.show = visible;
      },
      destroy() {
        if (!viewer.isDestroyed()) viewer.scene.primitives.remove(primitive);
      },
    };
  },
};
