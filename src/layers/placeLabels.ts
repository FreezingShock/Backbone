import * as Cesium from 'cesium';
import { PLACES } from '../map/places';
import type { LayerHandle, MapLayer } from './types';

export const placeLabelsLayer: MapLayer = {
  id: 'place-labels',
  label: 'Place names',
  group: 'Base',
  defaultVisible: true,
  mount(viewer): LayerHandle {
    const labels = new Cesium.LabelCollection({ scene: viewer.scene });
    for (const place of PLACES) {
      labels.add({
        position: Cesium.Cartesian3.fromDegrees(place.lon, place.lat),
        text: place.name.toUpperCase(),
        font: '13px ui-monospace, Menlo, Consolas, monospace',
        fillColor: Cesium.Color.fromCssColorString('#d6ecf7'),
        outlineColor: Cesium.Color.fromCssColorString('#050d18'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    viewer.scene.primitives.add(labels);

    return {
      show(visible) {
        labels.show = visible;
      },
      destroy() {
        if (!viewer.isDestroyed()) viewer.scene.primitives.remove(labels);
      },
    };
  },
};
