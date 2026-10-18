import * as Cesium from 'cesium';
import type { MapLook, RoadTierLook } from '../map/look';
import { whenReady } from '../map/whenReady';
import type { LayerHandle, MapLayer } from './types';

// Built by scripts/build-roads.mjs from Census TIGER/Line (or OpenStreetMap, via Overpass). Served from public/.
const DATA_URL = '/data/roads.geojson';

// Tier geometry. Widths are screen pixels. Tier 1 is drawn last so arteries sit on top.
// Colors come from the map look, so the same roads read on paper and on navy.
const TIERS = {
  1: { width: 3.5, labelPx: 12, labelRange: 60000 },
  2: { width: 2, labelPx: 11, labelRange: 20000 },
  3: { width: 1 },
} as const;

type Tier = keyof typeof TIERS;

function tierLook(look: MapLook, tier: Tier): RoadTierLook {
  if (tier === 1) return look.roads.artery;
  if (tier === 2) return look.roads.arterial;
  return look.roads.local;
}

function tierColor(look: MapLook, tier: Tier): Cesium.Color {
  const { color, alpha } = tierLook(look, tier);
  return Cesium.Color.fromCssColorString(color).withAlpha(alpha);
}

interface RoadFeature {
  properties: { name?: string; tier?: number };
  geometry: { coordinates: [number, number][] };
}

interface RoadCollection {
  features: RoadFeature[];
}

interface LabelSpot {
  name: string;
  tier: 1 | 2;
  lon: number;
  lat: number;
}

// Label spacing keeps names readable. Arteries get more room than arterials.
const MIN_SPACING_M: Record<1 | 2, number> = { 1: 3000, 2: 1800 };
const MAX_LABELS = 350;

function metersBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const kx = 111320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (a.lon - b.lon) * kx;
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

function polylineMeters(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += metersBetween(
      { lon: coords[i - 1][0], lat: coords[i - 1][1] },
      { lon: coords[i][0], lat: coords[i][1] },
    );
  }
  return total;
}

/**
 * Picks one label per stretch of a named road. Longest stretches win first,
 * and a label is skipped if another label sits within the spacing for its tier.
 */
export function pickLabels(features: RoadFeature[]): LabelSpot[] {
  const candidates: (LabelSpot & { length: number })[] = [];
  for (const feature of features) {
    const { name, tier } = feature.properties;
    const coords = feature.geometry.coordinates;
    if (!name || coords.length < 2) continue;
    if (tier !== 1 && tier !== 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    candidates.push({
      name,
      tier,
      lon: mid[0],
      lat: mid[1],
      length: polylineMeters(coords),
    });
  }

  candidates.sort((a, b) => a.tier - b.tier || b.length - a.length);

  const accepted: LabelSpot[] = [];
  for (const candidate of candidates) {
    if (accepted.length >= MAX_LABELS) break;
    const spacing = MIN_SPACING_M[candidate.tier];
    const clear = accepted.every((spot) => metersBetween(spot, candidate) >= spacing);
    if (clear) accepted.push({ name: candidate.name, tier: candidate.tier, lon: candidate.lon, lat: candidate.lat });
  }
  return accepted;
}

function tierOf(feature: RoadFeature): Tier {
  const tier = feature.properties.tier;
  return tier === 1 || tier === 2 ? tier : 3;
}

export const roadsLayer: MapLayer = {
  id: 'roads',
  label: 'Roads and streets',
  group: 'Roads',
  defaultVisible: true,
  legend: (look) => [
    { label: 'Arteries', color: look.roads.artery.color, thickness: 3, opacity: look.roads.artery.alpha },
    { label: 'Arterials and collectors', color: look.roads.arterial.color, thickness: 2, opacity: look.roads.arterial.alpha },
    { label: 'Local roads and trails', color: look.roads.local.color, thickness: 1, opacity: look.roads.local.alpha },
  ],
  note: 'Roads: U.S. Census TIGER/Line 2024 (public domain). Trails are not in this source.',
  mount(viewer, initialLook): LayerHandle {
    // Road colors are per-instance attributes. Restyling rewrites them, so geometry is built once.
    const roadPrimitives: { tier: Tier; primitive: Cesium.GroundPolylinePrimitive; ids: string[] }[] = [];
    const labels = new Cesium.LabelCollection({ scene: viewer.scene });
    const labelTiers: (1 | 2)[] = [];
    viewer.scene.primitives.add(labels);
    let destroyed = false;
    let visible = true;
    let look = initialLook;

    const paintRoads = () => {
      for (const entry of roadPrimitives) {
        const attribute = Cesium.ColorGeometryInstanceAttribute.toValue(tierColor(look, entry.tier));
        whenReady(viewer, entry.primitive, () => {
          for (const id of entry.ids) {
            const attributes = entry.primitive.getGeometryInstanceAttributes(id);
            if (attributes) attributes.color = attribute;
          }
        });
      }
    };

    const paintLabels = () => {
      for (let i = 0; i < labels.length; i++) {
        const tier = labelTiers[i];
        const label = labels.get(i);
        label.fillColor = Cesium.Color.fromCssColorString(tier === 1 ? look.roads.arteryLabel : look.roads.arterialLabel);
        label.outlineColor = Cesium.Color.fromCssColorString(look.halo);
      }
    };

    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<RoadCollection>;
      })
      .then((data) => {
        if (destroyed || viewer.isDestroyed()) return;

        // One primitive per tier, since the width is set per geometry.
        for (const tier of [3, 2, 1] as const) {
          const style = TIERS[tier];
          const ids: string[] = [];
          const attributes = {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(tierColor(look, tier)),
          };
          const instances = data.features
            .filter((feature) => tierOf(feature) === tier && feature.geometry.coordinates.length >= 2)
            .map((feature, index) => {
              const id = `${tier}-${index}`;
              ids.push(id);
              return new Cesium.GeometryInstance({
                id,
                geometry: new Cesium.GroundPolylineGeometry({
                  positions: Cesium.Cartesian3.fromDegreesArray(feature.geometry.coordinates.flat()),
                  width: style.width,
                }),
                attributes,
              });
            });
          if (instances.length === 0) continue;

          const primitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: instances,
            appearance: new Cesium.PolylineColorAppearance(),
          });
          primitive.show = visible;
          viewer.scene.primitives.add(primitive);
          roadPrimitives.push({ tier, primitive, ids });
        }

        for (const spot of pickLabels(data.features)) {
          const style = TIERS[spot.tier];
          labelTiers.push(spot.tier);
          labels.add({
            position: Cesium.Cartesian3.fromDegrees(spot.lon, spot.lat),
            text: spot.name.toUpperCase(),
            font: `${style.labelPx}px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace`,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 3,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Only show names when the camera is close enough to read them.
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, style.labelRange),
          });
        }
        paintLabels();
        labels.show = visible;
      })
      .catch((error: unknown) => {
        console.warn('Roads layer: could not load', DATA_URL, error);
      });

    return {
      show(next) {
        visible = next;
        for (const entry of roadPrimitives) entry.primitive.show = next;
        labels.show = next;
      },
      restyle(next) {
        look = next;
        paintRoads();
        paintLabels();
      },
      destroy() {
        destroyed = true;
        if (viewer.isDestroyed()) return;
        for (const entry of roadPrimitives) viewer.scene.primitives.remove(entry.primitive);
        viewer.scene.primitives.remove(labels);
      },
    };
  },
};
