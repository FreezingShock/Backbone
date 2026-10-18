import * as Cesium from 'cesium';

/** Free-fly tuning. Speeds are meters per second. */
export const FREEFLY = {
  /**
   * Base speed per meter of height above ground, so low flight is slow and high flight is fast.
   * At 1 km up this is 300 m/s, the old fixed speed.
   */
  speedPerMeterAboveGround: 0.3,
  minSpeed: 150,
  maxSpeed: 6000,
  /** Speed multiplier while Shift is held. */
  boost: 3,
  /** Seconds to reach about 63% of target speed after a key is pressed. */
  accelerationTime: 0.25,
  /** Seconds to lose about 63% of speed after keys are released. Gives a short glide. */
  dampingTime: 0.4,
  /** Radians of look per pixel dragged. */
  lookRadPerPx: 0.003,
  /** The camera is kept at least this many meters above the ground. */
  groundClearance: 10,
  /** Seconds between ground-height samples. Sampling every frame is wasted work. */
  groundSampleInterval: 0.1,
} as const;

/** Range of the UI speed multiplier. 1 is the default tuning above. */
export const FREEFLY_SPEED = { min: 0.25, max: 4, step: 0.25, default: 1 } as const;

const PITCH_LIMIT = Cesium.Math.PI_OVER_TWO - 0.01;
/** Longest step taken in one frame. Stops a stalled tab from jumping the camera. */
const MAX_FRAME_SECONDS = 0.1;
/** Velocities closer than this to their target snap to it, so motion ends cleanly. */
const SNAP_EPSILON = 1e-3;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Exponential approach to `target`. The result depends on elapsed time, not on frame count. */
function approach(value: number, target: number, timeConstant: number, dt: number): number {
  const next = value + (target - value) * (1 - Math.exp(-dt / timeConstant));
  return Math.abs(next - target) < SNAP_EPSILON ? target : next;
}

// Reused every frame so the frame loop does not allocate.
const scratchUp = new Cesium.Cartesian3();

/**
 * Free-fly: WASD to move, Q/E for down and up, Shift to boost, and drag to look.
 * Speed scales with height above ground. `getSpeedScale` supplies the UI multiplier.
 * Turns off Cesium's orbit controls while attached. The returned function restores them.
 */
export function attachFreeFly(viewer: Cesium.Viewer, getSpeedScale: () => number = () => 1): () => void {
  const { scene, camera } = viewer;
  const controller = scene.screenSpaceCameraController;
  const keys = new Set<string>();
  const orientation = { heading: 0, pitch: 0, roll: 0 };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  // Drag is collected as events arrive and applied once per frame.
  let pendingHeading = 0;
  let pendingPitch = 0;
  // Velocity in camera axes, meters per second.
  let velocityForward = 0;
  let velocityRight = 0;
  let velocityUp = 0;
  let groundHeight = 0;
  let groundTimer = 0;
  let lastTime = performance.now();

  controller.enableInputs = false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isTextEntry(event.target)) keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  const onBlur = () => {
    // A key released while the window is unfocused would otherwise stay stuck on.
    keys.clear();
    dragging = false;
  };
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
    pendingHeading += (event.clientX - lastX) * FREEFLY.lookRadPerPx;
    pendingPitch -= (event.clientY - lastY) * FREEFLY.lookRadPerPx;
    lastX = event.clientX;
    lastY = event.clientY;
  };

  // preUpdate runs every tick, including ticks where Cesium skips drawing (requestRenderMode).
  const onPreUpdate = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS);
    lastTime = now;

    if (pendingHeading !== 0 || pendingPitch !== 0) {
      orientation.heading = camera.heading + pendingHeading;
      orientation.pitch = Cesium.Math.clamp(camera.pitch + pendingPitch, -PITCH_LIMIT, PITCH_LIMIT);
      camera.setView({ orientation });
      pendingHeading = 0;
      pendingPitch = 0;
    }

    groundTimer -= dt;
    if (groundTimer <= 0) {
      groundTimer = FREEFLY.groundSampleInterval;
      groundHeight = scene.globe.getHeight(camera.positionCartographic) ?? groundHeight;
    }

    const altitude = Math.max(camera.positionCartographic.height - groundHeight, 0);
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? FREEFLY.boost : 1;
    const speed =
      Cesium.Math.clamp(altitude * FREEFLY.speedPerMeterAboveGround, FREEFLY.minSpeed, FREEFLY.maxSpeed) *
      getSpeedScale() *
      boost;

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const up = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    velocityForward = approach(
      velocityForward,
      forward * speed,
      forward !== 0 ? FREEFLY.accelerationTime : FREEFLY.dampingTime,
      dt,
    );
    velocityRight = approach(velocityRight, right * speed, right !== 0 ? FREEFLY.accelerationTime : FREEFLY.dampingTime, dt);
    velocityUp = approach(velocityUp, up * speed, up !== 0 ? FREEFLY.accelerationTime : FREEFLY.dampingTime, dt);

    if (velocityForward !== 0) camera.moveForward(velocityForward * dt);
    if (velocityRight !== 0) camera.moveRight(velocityRight * dt);
    if (velocityUp !== 0) camera.moveUp(velocityUp * dt);

    // Lift straight up from the ellipsoid, not along the camera's up, so a steep look does not dip underground.
    const floor = groundHeight + FREEFLY.groundClearance;
    const shortfall = floor - camera.positionCartographic.height;
    if (shortfall > 0) {
      Cesium.Cartesian3.normalize(camera.position, scratchUp);
      Cesium.Cartesian3.multiplyByScalar(scratchUp, shortfall, scratchUp);
      Cesium.Cartesian3.add(camera.position, scratchUp, camera.position);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointermove', onPointerMove);
  scene.canvas.addEventListener('pointerdown', onPointerDown);
  scene.preUpdate.addEventListener(onPreUpdate);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointermove', onPointerMove);
    if (!viewer.isDestroyed()) {
      scene.canvas.removeEventListener('pointerdown', onPointerDown);
      scene.preUpdate.removeEventListener(onPreUpdate);
      controller.enableInputs = true;
    }
    keys.clear();
  };
}
