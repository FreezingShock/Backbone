import * as Cesium from 'cesium';
import type { MapLook } from '../map/look';
import { whenReady } from '../map/whenReady';
import type { RoadClass, RoadFeature } from '../lib/roads/route';
import type { LayerHandle, LegendItem, MapLayer } from './types';

// Built by scripts/build-roads.mjs from Census TIGER/Line (or OpenStreetMap, via Overpass). Served from public/.
// Each feature has a `class` from the hierarchy in scripts/road-classes.mjs, and canyon crossings have a `crossing` name.
const DATA_URL = '/data/roads.geojson';

// Widths are screen pixels. Classes are added to the map in this order, so later ones draw on top.
const WIDTH: Record<RoadClass, number> = {
  local: 1,
  collector: 1.4,
  arterial: 2.2,
  highway: 2.5,
  crossing: 4,
};

// Highways fade to this alpha when their layer is switched off, so they stay as a faint reference.
const DIM_ALPHA = 0.12;

interface RoadCollection {
  features: RoadFeature[];
}

let collection: Promise<RoadCollection> | null = null;

/** Loads the road file once. The roads, highway and demo route layers all share it. A failed load can be retried. */
export function loadRoadCollection(): Promise<RoadCollection> {
  collection ??= fetch(DATA_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<RoadCollection>;
    })
    .catch((error: unknown) => {
      collection = null;
      throw error;
    });
  return collection;
}

function roadColor(look: MapLook, cls: RoadClass, dimmed = false): Cesium.Color {
  const { color, alpha } = look.roads[cls];
  return Cesium.Color.fromCssColorString(color).withAlpha(dimmed ? DIM_ALPHA : alpha);
}

/** Recolors a road set's instances. Cesium builds ground polylines asynchronously, so writes wait for `whenReady`. */
export function paintRoadSets(viewer: Cesium.Viewer, sets: RoadSet[], colorOf: (cls: RoadClass) => Cesium.Color): void {
  for (const set of sets) {
    const attribute = Cesium.ColorGeometryInstanceAttribute.toValue(colorOf(set.cls));
    whenReady(viewer, set.primitive, () => {
      for (const id of set.ids) {
        const attributes = set.primitive.getGeometryInstanceAttributes(id);
        if (attributes) attributes.color = attribute;
      }
    });
  }
}

export interface RoadSet {
  cls: RoadClass;
  primitive: Cesium.GroundPolylinePrimitive;
  ids: string[];
}

/** One primitive per class, since the width is set per geometry. Returns null when no road has that class. */
export function buildRoadSet(viewer: Cesium.Viewer, features: RoadFeature[], cls: RoadClass, look: MapLook): RoadSet | null {
  const ids: string[] = [];
  const attributes = { color: Cesium.ColorGeometryInstanceAttribute.fromColor(roadColor(look, cls)) };
  const instances = features
    .filter((feature) => feature.properties.class === cls && feature.geometry.coordinates.length >= 2)
    .map((feature, index) => {
      const id = `${cls}-${index}`;
      ids.push(id);
      return new Cesium.GeometryInstance({
        id,
        geometry: new Cesium.GroundPolylineGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(feature.geometry.coordinates.flat()),
          width: WIDTH[cls],
        }),
        attributes,
      });
    });
  if (instances.length === 0) return null;

  const primitive = new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance(),
  });
  viewer.scene.primitives.add(primitive);
  return { cls, primitive, ids };
}

interface LabelSpot {
  name: string;
  cls: 'crossing' | 'arterial';
  lon: number;
  lat: number;
}

// Labels keep this much room from each other, so names do not pile up where crossings meet.
const CROSSING_SPACING_M = 1500;
const ARTERIAL_SPACING_M = 1800;
const MAX_ARTERIAL_LABELS = 300;

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

function midpoint(coords: [number, number][]): { lon: number; lat: number } {
  const [lon, lat] = coords[Math.floor(coords.length / 2)];
  return { lon, lat };
}

/**
 * One label per canyon crossing, at the middle of its longest stretch, then one label per stretch of a named
 * arterial. Longest first in each group. A label is skipped if it would sit too close to one already placed.
 */
export function pickLabels(features: RoadFeature[]): LabelSpot[] {
  const longest = new Map<string, { length: number; coords: [number, number][] }>();
  const arterials: (LabelSpot & { length: number })[] = [];

  for (const feature of features) {
    const { name, class: cls, crossing } = feature.properties;
    const coords = feature.geometry.coordinates;
    if (coords.length < 2) continue;
    if (cls === 'crossing' && crossing) {
      const length = polylineMeters(coords);
      const best = longest.get(crossing);
      if (!best || length > best.length) longest.set(crossing, { length, coords });
    } else if (cls === 'arterial' && name) {
      const mid = midpoint(coords);
      arterials.push({ name, cls: 'arterial', ...mid, length: polylineMeters(coords) });
    }
  }

  const accepted: LabelSpot[] = [];
  const crossings = [...longest].map(([name, { length, coords }]) => ({ name, length, ...midpoint(coords) }));
  crossings.sort((a, b) => b.length - a.length);
  for (const candidate of crossings) {
    const clear = accepted.every((spot) => metersBetween(spot, candidate) >= CROSSING_SPACING_M);
    if (clear) accepted.push({ name: candidate.name, cls: 'crossing', lon: candidate.lon, lat: candidate.lat });
  }

  arterials.sort((a, b) => b.length - a.length);
  let arterialCount = 0;
  for (const candidate of arterials) {
    if (arterialCount >= MAX_ARTERIAL_LABELS) break;
    const clear = accepted.every((spot) => metersBetween(spot, candidate) >= ARTERIAL_SPACING_M);
    if (!clear) continue;
    accepted.push({ name: candidate.name, cls: 'arterial', lon: candidate.lon, lat: candidate.lat });
    arterialCount++;
  }
  return accepted;
}

const LABEL_STYLE = {
  crossing: { px: 13, range: 90000 },
  arterial: { px: 11, range: 20000 },
} as const;

const ROAD_LEGEND = (look: MapLook): LegendItem[] => [
  { label: 'Canyon crossings', color: look.roads.crossing.color, thickness: 4, opacity: look.roads.crossing.alpha },
  { label: 'Arterials', color: look.roads.arterial.color, thickness: 2.5, opacity: look.roads.arterial.alpha },
  { label: 'Collectors', color: look.roads.collector.color, thickness: 1.5, opacity: look.roads.collector.alpha },
  { label: 'Local roads and trails', color: look.roads.local.color, thickness: 1, opacity: look.roads.local.alpha },
];

export const roadsLayer: MapLayer = {
  id: 'roads',
  label: 'Roads and streets',
  group: 'Roads',
  defaultVisible: true,
  legend: ROAD_LEGEND,
  note: 'Roads: U.S. Census TIGER/Line 2024 (public domain). Stop signs and traffic signals: OpenStreetMap contributors (ODbL). Trails are not in this source. Canyon crossings are named by hand.',
  mount(viewer, initialLook): LayerHandle {
    const sets: RoadSet[] = [];
    const labels = new Cesium.LabelCollection({ scene: viewer.scene });
    const labelClasses: LabelSpot['cls'][] = [];
    viewer.scene.primitives.add(labels);
    let destroyed = false;
    let visible = true;
    let look = initialLook;

    const paintLabels = () => {
      for (let i = 0; i < labels.length; i++) {
        const label = labels.get(i);
        const cls = labelClasses[i];
        label.fillColor = Cesium.Color.fromCssColorString(cls === 'crossing' ? look.roads.crossingLabel : look.roads.arterialLabel);
        label.outlineColor = Cesium.Color.fromCssColorString(look.halo);
      }
    };

    loadRoadCollection()
      .then((data) => {
        if (destroyed || viewer.isDestroyed()) return;

        for (const cls of ['local', 'collector', 'arterial', 'crossing'] as const) {
          const set = buildRoadSet(viewer, data.features, cls, look);
          if (!set) continue;
          set.primitive.show = visible;
          sets.push(set);
        }

        for (const spot of pickLabels(data.features)) {
          const style = LABEL_STYLE[spot.cls];
          labelClasses.push(spot.cls);
          labels.add({
            position: Cesium.Cartesian3.fromDegrees(spot.lon, spot.lat),
            text: spot.name.toUpperCase(),
            font: `${style.px}px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace`,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 3,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Only show names when the camera is close enough to read them.
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, style.range),
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
        for (const set of sets) set.primitive.show = next;
        labels.show = next;
      },
      restyle(next) {
        look = next;
        paintRoadSets(viewer, sets, (cls) => roadColor(look, cls));
        paintLabels();
      },
      destroy() {
        destroyed = true;
        if (viewer.isDestroyed()) return;
        for (const set of sets) viewer.scene.primitives.remove(set.primitive);
        viewer.scene.primitives.remove(labels);
      },
    };
  },
};

/**
 * US 101, the Ventura and Moorpark freeways, and PCH. Drawn under the other roads. Unchecking the layer dims
 * them to a faint trace, so the canyon roads read first. They are never removed.
 */
export const highwaysLayer: MapLayer = {
  id: 'highways',
  label: 'Show 101 and PCH',
  group: 'Roads',
  defaultVisible: true,
  legend: (look) => [
    { label: 'Highways: avoid for canyon routes', color: look.roads.highway.color, thickness: 2.5, opacity: look.roads.highway.alpha },
  ],
  note: 'Uncheck to dim them to a faint trace.',
  mount(viewer, initialLook): LayerHandle {
    const sets: RoadSet[] = [];
    let destroyed = false;
    let dimmed = false;
    let look = initialLook;

    loadRoadCollection()
      .then((data) => {
        if (destroyed || viewer.isDestroyed()) return;
        const set = buildRoadSet(viewer, data.features, 'highway', look);
        if (!set) return;
        sets.push(set);
        paintRoadSets(viewer, sets, (cls) => roadColor(look, cls, dimmed));
      })
      .catch((error: unknown) => {
        console.warn('Highway layer: could not load', DATA_URL, error);
      });

    return {
      show(next) {
        dimmed = !next;
        paintRoadSets(viewer, sets, (cls) => roadColor(look, cls, dimmed));
      },
      restyle(next) {
        look = next;
        paintRoadSets(viewer, sets, (cls) => roadColor(look, cls, dimmed));
      },
      destroy() {
        destroyed = true;
        if (viewer.isDestroyed()) return;
        for (const set of sets) viewer.scene.primitives.remove(set.primitive);
      },
    };
  },
};

