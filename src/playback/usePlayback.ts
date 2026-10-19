import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type * as Cesium from 'cesium';
import type { MapLook } from '../map/look';
import { createPlaybackController, IDLE_SNAPSHOT, type PlaybackController, type PlaybackSnapshot } from './controller';

/** One controller per viewer. Created when the viewer exists, destroyed with it. Recolored when the look changes. */
export function usePlaybackController(viewer: Cesium.Viewer | null, look: MapLook): PlaybackController | null {
  const [controller, setController] = useState<PlaybackController | null>(null);
  const lookRef = useRef(look);
  lookRef.current = look;

  useEffect(() => {
    if (!viewer) return;
    const created = createPlaybackController(viewer, lookRef.current);
    setController(created);
    return () => {
      created.destroy();
      setController(null);
    };
  }, [viewer]);

  useEffect(() => {
    controller?.restyle(look);
  }, [controller, look]);

  return controller;
}

const subscribeNothing = () => () => undefined;
const emptySnapshot = (): PlaybackSnapshot => IDLE_SNAPSHOT;

/** The playback snapshot, re-rendering only when the controller publishes (about ten times a second). */
export function usePlaybackSnapshot(controller: PlaybackController | null): PlaybackSnapshot {
  return useSyncExternalStore(
    controller ? controller.subscribe : subscribeNothing,
    controller ? controller.getSnapshot : emptySnapshot,
  );
}
