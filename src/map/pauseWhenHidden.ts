import type * as Cesium from 'cesium';

/**
 * Stops drawing while the page is hidden (another tab, a minimized window) and starts again when it is shown.
 * Drawing stops by turning off Cesium's render loop, so no frames, tile updates or camera ticks run in the background.
 * Returns a function that detaches the listener and turns the loop back on.
 */
export function attachPauseWhenHidden(viewer: Cesium.Viewer): () => void {
  const sync = () => {
    if (viewer.isDestroyed()) return;
    viewer.useDefaultRenderLoop = !document.hidden;
    if (!document.hidden) viewer.scene.requestRender();
  };

  document.addEventListener('visibilitychange', sync);
  sync();

  return () => {
    document.removeEventListener('visibilitychange', sync);
    if (!viewer.isDestroyed()) viewer.useDefaultRenderLoop = true;
  };
}
