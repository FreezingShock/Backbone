import * as Cesium from 'cesium';
import { QUALITY_LEVELS, initialGovernor, stepGovernor, type GovernorState } from './qualityGovernor';

/** While the camera moves, screen-space error doubles and resolution drops to 75%, on top of the current level. */
const MOVING_SCREEN_SPACE_ERROR_FACTOR = 2;
const MOVING_RESOLUTION_FACTOR = 0.75;
/** Camera must hold still this long before full detail comes back. Avoids flicker between moves. */
const SETTLE_MS = 350;
/** Cesium draws only when something changes. This redraw keeps updates from other code showing up. */
const HEARTBEAT_MS = 1000;
/** Globe tiles kept in memory. The Cesium default is 100. Each one holds GPU buffers and imagery. Lower saves RAM. */
const TILE_CACHE_SIZE = 120;
/** Add ?perf to the page URL to log frame cost and the quality level every few seconds. */
const PERF_LOG_MS = 5000;

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number };
}

/**
 * Keeps the globe's detail in step with what the machine can draw.
 * - Moving: lower detail, so flying does not stream every tile level on the way.
 * - Still: the detail for the current level, which a frame-time governor lowers when frames run slow (see qualityGovernor.ts).
 * Motion is detected from the camera itself, so orbit, fly-to and free-fly all count.
 * Also applies TILE_CACHE_SIZE. The viewer must already have requestRenderMode on.
 * Returns a function that detaches everything and restores full detail.
 */
export function attachRenderQuality(viewer: Cesium.Viewer): () => void {
  const { scene, camera } = viewer;
  const globe = scene.globe;
  const lastPosition = Cesium.Cartesian3.clone(camera.position);
  const lastDirection = Cesium.Cartesian3.clone(camera.direction);
  let moving = false;
  let lastMotionTime = performance.now();
  let governor: GovernorState = initialGovernor();
  let frameStart = 0;

  globe.tileCacheSize = TILE_CACHE_SIZE;

  const apply = () => {
    const level = QUALITY_LEVELS[governor.level];
    globe.maximumScreenSpaceError = moving
      ? level.screenSpaceError * MOVING_SCREEN_SPACE_ERROR_FACTOR
      : level.screenSpaceError;
    viewer.resolutionScale = moving ? level.resolutionScale * MOVING_RESOLUTION_FACTOR : level.resolutionScale;
    scene.requestRender();
  };

  // Perf logging, only when asked for in the URL. Frame counts reset each time they are logged.
  const perfLog = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
  let perfFrames = 0;
  let perfTotalMs = 0;
  let perfMaxMs = 0;
  const perfTimer = perfLog
    ? window.setInterval(() => {
        if (perfFrames === 0) return;
        const heapMb = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
        console.info(
          `[perf] frames ${perfFrames}, avg ${(perfTotalMs / perfFrames).toFixed(1)} ms, max ${perfMaxMs.toFixed(1)} ms, ` +
            `level ${governor.level}${moving ? ' (moving)' : ''}` +
            (heapMb ? `, JS heap ${(heapMb / 1048576).toFixed(0)} MB` : ''),
        );
        perfFrames = 0;
        perfTotalMs = 0;
        perfMaxMs = 0;
      }, PERF_LOG_MS)
    : 0;

  // Runs every tick, before Cesium decides whether to draw, so it sees camera changes from this tick.
  const onPreUpdate = () => {
    frameStart = performance.now();
    // A centimeter per frame counts as still. Smaller drift is not visible.
    const changed =
      !Cesium.Cartesian3.equalsEpsilon(camera.position, lastPosition, 0, 0.01) ||
      !Cesium.Cartesian3.equalsEpsilon(camera.direction, lastDirection, 0, 1e-7);

    if (changed) {
      Cesium.Cartesian3.clone(camera.position, lastPosition);
      Cesium.Cartesian3.clone(camera.direction, lastDirection);
      lastMotionTime = frameStart;
      if (!moving) {
        moving = true;
        apply();
      }
    } else if (moving && frameStart - lastMotionTime > SETTLE_MS) {
      moving = false;
      apply();
    }
  };

  // Frame cost is the time from preUpdate to postRender. Each rendered frame is one sample.
  const onPostRender = () => {
    const now = performance.now();
    const frameMs = now - frameStart;
    const next = stepGovernor(governor, frameMs, now);
    const changedLevel = next.level !== governor.level;
    governor = next;
    if (changedLevel) apply();
    if (perfLog) {
      perfFrames += 1;
      perfTotalMs += frameMs;
      perfMaxMs = Math.max(perfMaxMs, frameMs);
    }
  };

  const onTileProgress = () => scene.requestRender();
  const heartbeat = window.setInterval(() => {
    if (!document.hidden) scene.requestRender();
  }, HEARTBEAT_MS);

  apply();
  scene.preUpdate.addEventListener(onPreUpdate);
  scene.postRender.addEventListener(onPostRender);
  globe.tileLoadProgressEvent.addEventListener(onTileProgress);

  return () => {
    window.clearInterval(heartbeat);
    if (perfTimer) window.clearInterval(perfTimer);
    scene.preUpdate.removeEventListener(onPreUpdate);
    scene.postRender.removeEventListener(onPostRender);
    globe.tileLoadProgressEvent.removeEventListener(onTileProgress);
    if (viewer.isDestroyed()) return;
    moving = false;
    governor = initialGovernor();
    apply();
  };
}
