import * as Cesium from 'cesium';

const WALK_SPEED_M_PER_S = 300;
const FAST_MULTIPLIER = 4;
const LOOK_RAD_PER_PX = 0.003;
const PITCH_LIMIT = Cesium.Math.PI_OVER_TWO - 0.01;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Free-fly: WASD to move, Q/E for down and up, Shift to go faster, and drag to look.
 * Turns off Cesium's orbit controls while attached. The returned function restores them.
 */
export function attachFreeFly(viewer: Cesium.Viewer): () => void {
  const { scene, camera } = viewer;
  const controller = scene.screenSpaceCameraController;
  const keys = new Set<string>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastTime = performance.now();

  controller.enableInputs = false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isTextEntry(event.target)) keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    camera.setView({
      destination: Cesium.Cartesian3.clone(camera.position),
      orientation: {
        heading: camera.heading + dx * LOOK_RAD_PER_PX,
        pitch: Cesium.Math.clamp(camera.pitch - dy * LOOK_RAD_PER_PX, -PITCH_LIMIT, PITCH_LIMIT),
        roll: 0,
      },
    });
  };
  const onFrame = () => {
    const now = performance.now();
    const seconds = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const step = WALK_SPEED_M_PER_S * seconds * (fast ? FAST_MULTIPLIER : 1);

    if (keys.has('KeyW')) camera.moveForward(step);
    if (keys.has('KeyS')) camera.moveBackward(step);
    if (keys.has('KeyA')) camera.moveLeft(step);
    if (keys.has('KeyD')) camera.moveRight(step);
    if (keys.has('KeyE')) camera.moveUp(step);
    if (keys.has('KeyQ')) camera.moveDown(step);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointermove', onPointerMove);
  scene.canvas.addEventListener('pointerdown', onPointerDown);
  scene.preRender.addEventListener(onFrame);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointermove', onPointerMove);
    if (!viewer.isDestroyed()) {
      scene.canvas.removeEventListener('pointerdown', onPointerDown);
      scene.preRender.removeEventListener(onFrame);
      controller.enableInputs = true;
    }
    keys.clear();
  };
}
