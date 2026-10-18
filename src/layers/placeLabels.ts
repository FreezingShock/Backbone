import * as Cesium from 'cesium';
import { PLACES } from '../map/places';
import type { LayerHandle, MapLayer } from './types';

// Place names use the serif face, the cartographic title type.
const PLACE_FONT = '17px "IM Fell English", Georgia, serif';

export const placeLabelsLayer: MapLayer = {
  id: 'place-labels',
  label: 'Place names',
  group: 'Base',
  defaultVisible: true,
  mount(viewer, look): LayerHandle {
    const labels = new Cesium.LabelCollection({ scene: viewer.scene });
    for (const place of PLACES) {
      labels.add({
        position: Cesium.Cartesian3.fromDegrees(place.lon, place.lat),
        text: place.name,
        font: PLACE_FONT,
        fillColor: Cesium.Color.fromCssColorString(look.placeInk),
        outlineColor: Cesium.Color.fromCssColorString(look.halo),
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
      restyle(next) {
        for (let i = 0; i < labels.length; i++) {
          const label = labels.get(i);
          label.fillColor = Cesium.Color.fromCssColorString(next.placeInk);
          label.outlineColor = Cesium.Color.fromCssColorString(next.halo);
        }
      },
      destroy() {
        if (!viewer.isDestroyed()) viewer.scene.primitives.remove(labels);
      },
    };
  },
};
