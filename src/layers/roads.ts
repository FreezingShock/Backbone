import * as Cesium from 'cesium';
import type { LayerHandle, MapLayer } from './types';

// Built by scripts/build-roads.mjs from OpenStreetMap. Served from public/.
const DATA_URL = '/data/roads.geojson';

// Tier styles. Widths are screen pixels. Tier 1 is drawn last so arteries sit on top.
const TIERS = {
  1: { color: '#f0fdff', alpha: 0.95, width: 3.5, labelColor: '#f0fdff', labelPx: 12, labelRange: 60000 },
  2: { color: '#fbbf24', alpha: 0.8, width: 2, labelColor: '#fde68a', labelPx: 11, labelRange: 20000 },
  3: { color: '#38bdf8', alpha: 0.35, width: 1 },
} as const;

type Tier = keyof typeof TIERS;

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
  legend: [
    { label: 'Arteries', color: TIERS[1].color, thickness: 3, opacity: 1 },
    { label: 'Arterials and collectors', color: TIERS[2].color, thickness: 2, opacity: 0.9 },
    { label: 'Local roads and trails', color: TIERS[3].color, thickness: 1, opacity: 0.5 },
  ],
  note: 'Data © OpenStreetMap contributors (ODbL).',
  mount(viewer): LayerHandle {
    const primitives: Cesium.GroundPolylinePrimitive[] = [];
    const labels = new Cesium.LabelCollection({ scene: viewer.scene });
    viewer.scene.primitives.add(labels);
    let destroyed = false;
    let visible = true;

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
          const color = Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha);
          const attributes = { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) };
          const instances = data.features
            .filter((feature) => tierOf(feature) === tier && feature.geometry.coordinates.length >= 2)
            .map(
              (feature) =>
                new Cesium.GeometryInstance({
                  geometry: new Cesium.GroundPolylineGeometry({
                    positions: Cesium.Cartesian3.fromDegreesArray(feature.geometry.coordinates.flat()),
                    width: style.width,
                  }),
                  attributes,
                }),
            );
          if (instances.length === 0) continue;

          const primitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: instances,
            appearance: new Cesium.PolylineColorAppearance(),
          });
          primitive.show = visible;
          viewer.scene.primitives.add(primitive);
          primitives.push(primitive);
        }

        for (const spot of pickLabels(data.features)) {
          const style = TIERS[spot.tier];
          labels.add({
            position: Cesium.Cartesian3.fromDegrees(spot.lon, spot.lat),
            text: spot.name.toUpperCase(),
            font: `${style.labelPx}px ui-monospace, Menlo, Consolas, monospace`,
            fillColor: Cesium.Color.fromCssColorString(style.labelColor),
            outlineColor: Cesium.Color.fromCssColorString('#050d18'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Only show names when the camera is close enough to read them.
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, style.labelRange),
          });
        }
        labels.show = visible;
      })
      .catch((error: unknown) => {
        console.warn('Roads layer: could not load', DATA_URL, error);
      });

    return {
      show(next) {
        visible = next;
        for (const primitive of primitives) primitive.show = next;
        labels.show = next;
      },
      destroy() {
        destroyed = true;
        if (viewer.isDestroyed()) return;
        for (const primitive of primitives) viewer.scene.primitives.remove(primitive);
        viewer.scene.primitives.remove(labels);
      },
    };
  },
};
