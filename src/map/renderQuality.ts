import * as Cesium from 'cesium';

/** Render settings while the camera moves, and once it settles. Tune here. */
const MOVING = { maximumScreenSpaceError: 4, resolutionScale: 0.75 };
const SETTLED = { maximumScreenSpaceError: 2, resolutionScale: 1 };
/** Camera must hold still this long before full detail comes back. Avoids flicker between moves. */
const SETTLE_MS = 350;
/** Cesium draws only when something changes. This redraw keeps updates from other code showing up. */
const HEARTBEAT_MS = 1000;
/** Globe tiles kept in memory. The Cesium default is 100. More tiles means less reloading when panning back. */
const TILE_CACHE_SIZE = 200;

/**
 * Lowers globe detail and canvas resolution while the camera moves, and restores full detail once it settles.
 * Motion is detected from the camera itself, so orbit, fly-to and free-fly all count.
 * Also applies TILE_CACHE_SIZE. The viewer must already have requestRenderMode on.
 */
export function attachRenderQuality(viewer: Cesium.Viewer): () => void {
  const { scene, camera } = viewer;
  const globe = scene.globe;
  const lastPosition = Cesium.Cartesian3.clone(camera.position);
  const lastDirection = Cesium.Cartesian3.clone(camera.direction);
  let moving = false;
  let lastMotionTime = performance.now();

  globe.tileCacheSize = TILE_CACHE_SIZE;

  const apply = (quality: typeof MOVING) => {
    globe.maximumScreenSpaceError = quality.maximumScreenSpaceError;
    viewer.resolutionScale = quality.resolutionScale;
    scene.requestRender();
  };

  // Runs every tick, before Cesium decides whether to draw, so it sees camera changes from this tick.
  const onPreUpdate = () => {
    // A centimeter per frame counts as still. Smaller drift is not visible.
    const changed =
      !Cesium.Cartesian3.equalsEpsilon(camera.position, lastPosition, 0, 0.01) ||
      !Cesium.Cartesian3.equalsEpsilon(camera.direction, lastDirection, 0, 1e-7);

    if (changed) {
      Cesium.Cartesian3.clone(camera.position, lastPosition);
      Cesium.Cartesian3.clone(camera.direction, lastDirection);
      lastMotionTime = performance.now();
      if (!moving) {
        moving = true;
        apply(MOVING);
      }
    } else if (moving && performance.now() - lastMotionTime > SETTLE_MS) {
      moving = false;
      apply(SETTLED);
    }
  };

  const onTileProgress = () => scene.requestRender();
  const heartbeat = window.setInterval(() => scene.requestRender(), HEARTBEAT_MS);

  scene.preUpdate.addEventListener(onPreUpdate);
  globe.tileLoadProgressEvent.addEventListener(onTileProgress);
  scene.requestRender();

  return () => {
    window.clearInterval(heartbeat);
    if (viewer.isDestroyed()) return;
    scene.preUpdate.removeEventListener(onPreUpdate);
    globe.tileLoadProgressEvent.removeEventListener(onTileProgress);
    if (moving) apply(SETTLED);
  };
}
