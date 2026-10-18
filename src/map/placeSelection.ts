// Which place the card shows. Hovering previews a place; clicking pins it until the user clears it.
// A plain store, not React state, so the Cesium layers can write to it without holding React refs.
import * as Cesium from 'cesium';
import type { Place } from './places';

export interface PlaceSelection {
  hovered: Place | null;
  pinned: Place | null;
}

let selection: PlaceSelection = { hovered: null, pinned: null };
const listeners = new Set<() => void>();

function update(next: Partial<PlaceSelection>) {
  const changed = (Object.keys(next) as (keyof PlaceSelection)[]).some((key) => selection[key] !== next[key]);
  if (!changed) return;
  selection = { ...selection, ...next };
  for (const listener of listeners) listener();
}

export function getPlaceSelection(): PlaceSelection {
  return selection;
}

export function subscribePlaceSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hoverPlace(place: Place | null) {
  update({ hovered: place });
}

export function pinPlace(place: Place | null) {
  update({ pinned: place, hovered: null });
}

// One pick handler per viewer, shared by every layer that has pickable places.
// Reference-counted, so the last layer to unmount removes it.
const pickers = new WeakMap<Cesium.Viewer, { handler: Cesium.ScreenSpaceEventHandler; count: number }>();

function isPlace(value: unknown): value is Place {
  return typeof value === 'object' && value !== null && 'kind' in value && 'lon' in value;
}

export function attachPlacePicking(viewer: Cesium.Viewer): () => void {
  let entry = pickers.get(viewer);
  if (!entry) {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    let last = 0;
    handler.setInputAction((move: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      // Throttle: a pick walks the scene, so skip moves that arrive faster than ~20 per second.
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      const picked = viewer.scene.pick(move.endPosition);
      const place = picked && isPlace(picked.id) ? picked.id : null;
      hoverPlace(place);
      viewer.scene.canvas.style.cursor = place ? 'pointer' : '';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(click.position);
      pinPlace(picked && isPlace(picked.id) ? picked.id : null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    entry = { handler, count: 0 };
    pickers.set(viewer, entry);
  }
  entry.count += 1;
  const owned = entry;

  return () => {
    owned.count -= 1;
    if (owned.count > 0) return;
    if (!viewer.isDestroyed()) viewer.scene.canvas.style.cursor = '';
    owned.handler.destroy();
    pickers.delete(viewer);
  };
}
