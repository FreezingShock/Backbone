// Draws named places as Cesium labels with an icon. Used by the towns layer and the points-of-interest layer.
//
// Three things keep the map readable:
// - Size and case follow the tier: cities are large capitals, towns are medium, POIs are small.
// - Zoom level: each kind has a maximum camera distance, so small names drop out when zoomed far out.
// - Declutter: labels are placed in screen space, most important first, and overlapping ones are hidden.
// Hover shows the place card, and click pins it (see src/map/placeSelection.ts).
import * as Cesium from 'cesium';
import type { MapLook } from '../map/look';
import { attachPlacePicking } from '../map/placeSelection';
import { type Place, type PlaceKind } from '../map/places';
import type { LayerHandle } from './types';
import { declutter, type LabelBox } from './declutter';
import { placeIcon } from './placeIcons';

interface KindStyle {
  font: string;
  upper: boolean;
  /** Camera distance, meters, beyond which names of this kind are hidden. */
  maxDistance: number;
  /** Declutter order: lower wins a contested spot. */
  priority: number;
  boxHeight: number;
}

const SERIF = '"Anthropic Serif", "IM Fell English", Georgia, serif';

const STYLE: Record<PlaceKind, KindStyle> = {
  city: { font: `22px ${SERIF}`, upper: true, maxDistance: 400_000, priority: 0, boxHeight: 26 },
  town: { font: `17px ${SERIF}`, upper: false, maxDistance: 150_000, priority: 1, boxHeight: 21 },
  neighborhood: { font: `14px ${SERIF}`, upper: false, maxDistance: 60_000, priority: 2, boxHeight: 18 },
  park: { font: `15px ${SERIF}`, upper: false, maxDistance: 60_000, priority: 3, boxHeight: 19 },
  peak: { font: `15px ${SERIF}`, upper: false, maxDistance: 60_000, priority: 3, boxHeight: 19 },
  landmark: { font: `15px ${SERIF}`, upper: false, maxDistance: 40_000, priority: 3, boxHeight: 19 },
  canyon: { font: `14px ${SERIF}`, upper: false, maxDistance: 60_000, priority: 4, boxHeight: 18 },
  beach: { font: `14px ${SERIF}`, upper: false, maxDistance: 40_000, priority: 4, boxHeight: 18 },
  lookout: { font: `14px ${SERIF}`, upper: false, maxDistance: 25_000, priority: 4, boxHeight: 18 },
  trailhead: { font: `13px ${SERIF}`, upper: false, maxDistance: 20_000, priority: 5, boxHeight: 17 },
};

const SAMPLE_LEVEL = 13;
const ICON_PX = 16;
/** Gap between the icon center and the start of the name, in pixels. */
const TEXT_OFFSET_PX = 12;

interface Marker {
  place: Place;
  position: Cesium.Cartesian3;
  style: KindStyle;
  label: Cesium.Label;
  icon: Cesium.Billboard;
  textWidth: number;
}

const widthCache = new Map<string, number>();

function measure(text: string, font: string): number {
  const key = `${font}|${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const ctx = document.createElement('canvas').getContext('2d');
  let width = text.length * 8;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  }
  widthCache.set(key, width);
  return width;
}

function displayName(place: Place, style: KindStyle): string {
  return style.upper ? place.name.toUpperCase() : place.name;
}

/**
 * Mounts one label and icon per place of the given kinds. Returns a LayerHandle so the layer can be shown,
 * restyled for the theme, and torn down with the viewer.
 */
export function mountPlaceMarkers(
  viewer: Cesium.Viewer,
  initialLook: MapLook,
  places: readonly Place[],
): LayerHandle {
  const labels = new Cesium.LabelCollection({ scene: viewer.scene });
  const icons = new Cesium.BillboardCollection({ scene: viewer.scene });
  viewer.scene.primitives.add(icons);
  viewer.scene.primitives.add(labels);

  const markers: Marker[] = [];
  let look = initialLook;
  let visible = true;
  let destroyed = false;
  const scratch = new Cesium.Cartesian2();

  for (const place of places) {
    const style = STYLE[place.kind];
    const text = displayName(place, style);
    const position = Cesium.Cartesian3.fromDegrees(place.lon, place.lat);
    const label = labels.add({
      id: place,
      position,
      text,
      font: style.font,
      fillColor: Cesium.Color.fromCssColorString(look.placeInk),
      outlineColor: Cesium.Color.fromCssColorString(look.halo),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(TEXT_OFFSET_PX, 0),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    const icon = icons.add({
      id: place,
      position,
      image: placeIcon(place.kind, look.placeInk, look.halo),
      width: ICON_PX,
      height: ICON_PX,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    markers.push({ place, position, style, label, icon, textWidth: measure(text, style.font) });
  }

  // Terrain height: markers sit on the ground, and the declutter projects them. Without the real height, a peak
  // would be projected at sea level and its box would land far from its drawn label. Sample once per terrain
  // provider, since the provider is swapped after the layers mount (ellipsoid first, then open or ion terrain).
  // Level 13 is fine for this: it only places markers, the terrain itself is drawn at full detail.
  // sampleTerrain, not sampleTerrainMostDetailed: the open terrain provider has no tile availability.
  let sampledFor: Cesium.TerrainProvider | null = null;
  const syncHeights = () => {
    const provider = viewer.terrainProvider;
    if (provider === sampledFor) return;
    sampledFor = provider;
    const cartographics = markers.map((marker) => Cesium.Cartographic.fromDegrees(marker.place.lon, marker.place.lat));
    Cesium.sampleTerrain(provider, SAMPLE_LEVEL, cartographics)
      .then((sampled) => {
        if (destroyed || viewer.isDestroyed() || provider !== viewer.terrainProvider) return;
        markers.forEach((marker, index) => {
          marker.position = Cesium.Cartesian3.fromDegrees(
            marker.place.lon,
            marker.place.lat,
            sampled[index]?.height ?? 0,
          );
          marker.label.position = marker.position;
          marker.icon.position = marker.position;
        });
      })
      .catch(() => {
        // Keep the ground-level positions. Labels still clamp to the terrain when it renders.
      });
  };

  // Each frame: level of detail first, then declutter the labels that are left.
  const update = () => {
    if (destroyed || viewer.isDestroyed()) return;
    if (!visible) return;
    syncHeights();

    const { scene, camera } = viewer;
    const boxes: (LabelBox | null)[] = markers.map((marker) => {
      if (Cesium.Cartesian3.distance(camera.positionWC, marker.position) > marker.style.maxDistance) return null;
      const screen = scene.cartesianToCanvasCoordinates(marker.position, scratch);
      if (!screen) return null;
      const half = marker.style.boxHeight / 2;
      return {
        left: screen.x - ICON_PX / 2,
        right: screen.x + TEXT_OFFSET_PX + marker.textWidth,
        top: screen.y - half,
        bottom: screen.y + half,
        priority: marker.style.priority,
      };
    });

    const shown = declutter(boxes, 6);
    markers.forEach((marker, index) => {
      marker.label.show = shown[index];
      marker.icon.show = shown[index];
    });
  };

  const removeUpdate = viewer.scene.postRender.addEventListener(update);
  const detachPicking = attachPlacePicking(viewer);

  return {
    show(next) {
      visible = next;
      labels.show = next;
      icons.show = next;
    },
    restyle(next) {
      look = next;
      const ink = Cesium.Color.fromCssColorString(next.placeInk);
      const halo = Cesium.Color.fromCssColorString(next.halo);
      for (const marker of markers) {
        marker.label.fillColor = ink;
        marker.label.outlineColor = halo;
        marker.icon.image = placeIcon(marker.place.kind, next.placeInk, next.halo);
      }
    },
    destroy() {
      destroyed = true;
      detachPicking();
      if (viewer.isDestroyed()) return;
      removeUpdate();
      viewer.scene.primitives.remove(labels);
      viewer.scene.primitives.remove(icons);
    },
  };
}
