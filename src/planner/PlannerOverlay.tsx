// Draws the planned route and its lettered stops on the 3D map, and turns map clicks into stops while pick mode is on.
import * as Cesium from 'cesium';
import { useEffect } from 'react';
import type { MapLook } from '../map/look';
import { stopLetter } from './format';
import type { Route, Stop } from './types';

const ROUTE_WIDTH = 6;
const MARKER_PX = 26;
/** Share of the chosen route's opacity that alternates keep. */
const ALTERNATE_ALPHA = 0.35;
const markerCache = new Map<string, HTMLCanvasElement>();

export interface PlannerOverlayProps {
  viewer: Cesium.Viewer | null;
  look: MapLook;
  stops: Stop[];
  /** The chosen route, drawn solid. */
  route: Route | null;
  /** Other routes between the same stops, drawn faint. */
  alternates: Route[];
  pickMode: boolean;
  onPickStop: (lon: number, lat: number) => void;
}

/** A lettered circle on the look's paper and ink. One canvas per letter and theme, reused across renders. */
function markerImage(letter: string, look: MapLook): HTMLCanvasElement {
  const key = `${letter}|${look.space}|${look.roads.route.color}|${look.ink}`;
  const cached = markerCache.get(key);
  if (cached) return cached;
  const size = MARKER_PX * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const radius = size / 2 - 4;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.fillStyle = look.space;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = look.roads.route.color;
    ctx.stroke();
    ctx.fillStyle = look.ink;
    ctx.font = `600 ${MARKER_PX}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2 + 1);
  }
  markerCache.set(key, canvas);
  return canvas;
}

/** Route line, stop markers and the pick-on-map click, as one Cesium overlay. Mounts only while the planner is open. */
export function PlannerOverlay({ viewer, look, stops, route, alternates, pickMode, onPickStop }: PlannerOverlayProps) {
  // Route lines: the chosen route in the look's route color, and the alternates faint. Rebuilt when they change.
  useEffect(() => {
    if (!viewer) return;
    const base = look.roads.route;
    const lines: { route: Route; alpha: number }[] = [
      ...alternates.map((alternate) => ({ route: alternate, alpha: base.alpha * ALTERNATE_ALPHA })),
      ...(route ? [{ route, alpha: base.alpha }] : []),
    ];
    const primitives = lines
      .filter((line) => line.route.geometry.length >= 2)
      .map((line) => {
        const color = Cesium.Color.fromCssColorString(base.color).withAlpha(line.alpha);
        return new Cesium.GroundPolylinePrimitive({
          geometryInstances: new Cesium.GeometryInstance({
            id: 'planner-route',
            geometry: new Cesium.GroundPolylineGeometry({
              positions: Cesium.Cartesian3.fromDegreesArray(line.route.geometry.flat()),
              width: ROUTE_WIDTH,
            }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
          }),
          appearance: new Cesium.PolylineColorAppearance(),
        });
      });
    for (const primitive of primitives) viewer.scene.primitives.add(primitive);
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) {
        for (const primitive of primitives) viewer.scene.primitives.remove(primitive);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, route, alternates, look]);

  // Stop markers. Rebuilt with the stops; the collection is small.
  useEffect(() => {
    if (!viewer || stops.length === 0) return;
    const collection = new Cesium.BillboardCollection({ scene: viewer.scene });
    stops.forEach((stop, index) => {
      collection.add({
        position: Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat, 0),
        image: markerImage(stopLetter(index), look),
        width: MARKER_PX,
        height: MARKER_PX,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: stop,
      });
    });
    viewer.scene.primitives.add(collection);
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(collection);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, stops, look]);

  // Pick mode: a left click (not a drag) on the globe or terrain drops a stop where the ground is.
  useEffect(() => {
    if (!viewer || !pickMode) return;
    const canvas = viewer.canvas;
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    const handler = new Cesium.ScreenSpaceEventHandler(canvas);
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const ray = viewer.camera.getPickRay(click.position);
      const ground = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
      if (!ground) return;
      const carto = Cesium.Cartographic.fromCartesian(ground);
      onPickStop(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));
      viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => {
      handler.destroy();
      if (!viewer.isDestroyed()) canvas.style.cursor = previousCursor;
    };
  }, [viewer, pickMode, onPickStop]);

  return null;
}
