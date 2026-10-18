import type * as Cesium from 'cesium';

/**
 * Runs `action` once the primitive has finished building. Cesium builds
 * GroundPolylinePrimitive asynchronously, and its per-instance attributes can
 * be written only after that. Returns a cancel function.
 */
export function whenReady(viewer: Cesium.Viewer, primitive: { ready: boolean; isDestroyed(): boolean }, action: () => void): () => void {
  let removeListener: (() => void) | undefined;
  let done = false;
  const finish = () => {
    done = true;
    removeListener?.();
  };
  const check = () => {
    if (done) return;
    if (viewer.isDestroyed() || primitive.isDestroyed()) return finish();
    if (primitive.ready) {
      finish();
      action();
    }
  };
  removeListener = viewer.scene.postRender.addEventListener(check);
  check();
  return finish;
}
