// Route playback: an opening shot, then the camera follows the marker along the route.
// The controller owns one frame loop (scene.preUpdate), so the camera moves without React. React reads a snapshot
// that is published about ten times a second, which is the only UI update that comes from playback.
import * as Cesium from 'cesium';
import type { MapLook } from '../map/look';
import { glyphDataUrl, stepTitle } from './icons';
import { INTRO_TOTAL_S, routeSecondsPerSecond, type PlaybackSpeed } from './pacing';
import { openingPose } from './opening';
import { chasePose, extentMeters, FRAME, orbitPose, overviewPose, sweepPose, type Pose } from './poses';
import type { Difficulty, Route, Step } from './routeTypes';
import {
  buildTrack,
  currentStepIndex,
  distanceAtSeconds,
  placeSteps,
  sampleAtDistance,
  slice,
  lerpAngle,
  upcomingSteps,
  type PlacedStep,
  type Track,
  type TrackSample,
} from './track';

export type PlaybackPhase = 'idle' | 'intro' | 'playing' | 'paused' | 'ended';
export type PlaybackCamera = 'orbit' | 'freefly';

export interface NextManeuver {
  step: Step;
  /** Meters along the road from the marker to this maneuver. */
  meters: number;
}

export interface PlaybackSnapshot {
  phase: PlaybackPhase;
  camera: PlaybackCamera;
  speed: PlaybackSpeed;
  route: Route | null;
  /** Route time played so far, seconds. */
  elapsedS: number;
  /** Route time left, seconds. */
  remainingS: number;
  /** Total route time, seconds. */
  durationS: number;
  /** Meters traveled and left along the track. */
  traveledM: number;
  remainingM: number;
  /** 0 to 1, by route time. */
  progress: number;
  /** Name of the road under the marker. Empty before any road is known. */
  roadName: string;
  /** Difficulty of the leg under the marker. */
  difficulty: Difficulty | null;
  /** The next maneuver, stop sign or traffic signal. Same as the first entry of `upcoming`. */
  next: NextManeuver | null;
  /** The next few maneuvers, stop signs and signals included, in order of travel. */
  upcoming: NextManeuver[];
}

export interface PlaybackController {
  /** Plays a route from the beginning, opening with the overview shot. `camera` defaults to orbit follow. */
  start(route: Route, camera?: PlaybackCamera): void;
  pause(): void;
  /** Resumes a paused route. Plays from the start again when the route has ended. */
  resume(): void;
  togglePlay(): void;
  /** Moves to a fraction of the route, 0 to 1, by route time. Ends the opening shot. */
  seek(fraction: number): void;
  setSpeed(speed: PlaybackSpeed): void;
  setCamera(camera: PlaybackCamera): void;
  /** Ends the opening shot and starts the route. */
  skipIntro(): void;
  /** Starts again from the beginning, with the opening shot. */
  restart(): void;
  /** Ends playback and gives the camera back to the user. */
  stop(): void;
  getSnapshot(): PlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  /** Recolors markers and the highlight for a new theme or map style. */
  restyle(look: MapLook): void;
  destroy(): void;
}

/** Snapshot updates per real second while playing. Camera motion itself never waits on React. */
const PUBLISH_MS = 100;
/** Ground height is sampled at most this often, in seconds. */
const GROUND_SAMPLE_S = 0.1;
/** The chase camera turns to face the road at this rate, in seconds to reach about 63%. */
const HEADING_TIME_S = 0.35;
/** Longest real time one frame may advance. Keeps a stalled tab from jumping the route. */
const MAX_FRAME_S = 0.1;
/** Upcoming callouts shown on the map at once. */
const CALLOUTS_AHEAD = 3;
/** Upcoming maneuvers listed in the navigation panel at once. */
const UPCOMING_COUNT = 4;
/** Terrain level used to read the ground under the route start when the globe has not loaded it yet. */
const START_SAMPLE_LEVEL = 13;
const HIGHLIGHT_WIDTH = 9;
const MARKER_PIXELS = 12;

export const IDLE_SNAPSHOT: PlaybackSnapshot = {
  phase: 'idle',
  camera: 'orbit',
  speed: 'cinematic',
  route: null,
  elapsedS: 0,
  remainingS: 0,
  durationS: 0,
  traveledM: 0,
  remainingM: 0,
  progress: 0,
  roadName: '',
  difficulty: null,
  next: null,
  upcoming: [],
};

// Reused across frames so the loop does not allocate for positions or the camera view.
const scratchCarto = new Cesium.Cartographic();
const scratchPos = new Cesium.Cartesian3();
const scratchView = {
  destination: scratchPos,
  orientation: { heading: 0, pitch: 0, roll: 0 },
};
const scratchSample: TrackSample = { lon: 0, lat: 0, heading: 0, seconds: 0 };

export function createPlaybackController(viewer: Cesium.Viewer, initialLook: MapLook): PlaybackController {
  const { scene, camera } = viewer;
  const controls = scene.screenSpaceCameraController;

  let look = initialLook;
  let route: Route | null = null;
  let track: Track | null = null;
  let placed: PlacedStep[] = [];
  let legEnds: number[] = [];

  let phase: PlaybackPhase = 'idle';
  let cameraMode: PlaybackCamera = 'orbit';
  let speed: PlaybackSpeed = 'cinematic';
  /** Route time, seconds. The master clock: distance and camera position follow from it. */
  let seconds = 0;
  let introElapsed = 0;
  let introDone = false;
  let orbitAngle = 0;
  let chaseHeading = 0;
  let cameraDirty = false;
  let stepIndex = -2;

  let groundHeight = 0;
  let groundTimer = 0;
  let cameraGround = 0;
  let introFrom: Pose | null = null;
  let overview: Pose | null = null;
  /** Camera input state before playback took it over. Put back when playback stops. */
  let savedInputs = true;
  let holdingControls = false;
  let lastNow = performance.now();
  let lastPublish = 0;
  let destroyed = false;

  let markers: Cesium.PointPrimitiveCollection | null = null;
  let marker: Cesium.PointPrimitive | null = null;
  let glyphs: Cesium.BillboardCollection | null = null;
  let callouts: Cesium.LabelCollection | null = null;
  let calloutLabels: Cesium.Label[] = [];
  let glyphBillboards: Cesium.Billboard[] = [];
  let highlight: Cesium.GroundPolylinePrimitive | null = null;
  let highlightKey = '';

  let snapshot: PlaybackSnapshot = IDLE_SNAPSHOT;
  const listeners = new Set<() => void>();

  /** Ground height from the loaded globe, or undefined when the tiles under that point are not loaded yet. */
  const loadedGround = (lon: number, lat: number): number | undefined => {
    Cesium.Cartographic.fromDegrees(lon, lat, 0, scratchCarto);
    return scene.globe.getHeight(scratchCarto);
  };

  const sampleGround = (lon: number, lat: number, fallback: number): number => loadedGround(lon, lat) ?? fallback;

  // Play can start where the terrain is not loaded yet. The globe has no height there, so the camera would start at
  // sea level, inside a mountain, and only rise once the tiles arrive. Ask the terrain provider for the start point
  // instead, and keep its answer as the ground until the globe has its own. Each start gets its own token, so a
  // late answer from an earlier route is ignored.
  let startSampleToken = 0;
  const settleStartGround = (lon: number, lat: number) => {
    if (loadedGround(lon, lat) !== undefined) return;
    const token = ++startSampleToken;
    Cesium.sampleTerrain(viewer.terrainProvider, START_SAMPLE_LEVEL, [Cesium.Cartographic.fromDegrees(lon, lat)])
      .then(([sampled]) => {
        if (destroyed || viewer.isDestroyed() || token !== startSampleToken || !route) return;
        if (sampled && Number.isFinite(sampled.height)) {
          groundHeight = sampled.height;
          cameraGround = sampled.height;
        }
      })
      .catch(() => {
        // Keep the sea-level fallback. The clamp still lifts the camera once the globe reports the ground.
      });
  };

  const trackAt = (meters: number): TrackSample => sampleAtDistance(track!, meters, scratchSample);

  const currentMeters = (): number => (track ? distanceAtSeconds(track, seconds) : 0);

  /** Writes a pose to the camera. Raises it above the ground under the camera if it would dip in. */
  const applyPose = (pose: Pose) => {
    cameraGround = sampleGround(pose.lon, pose.lat, cameraGround);
    const height = Math.max(pose.height, cameraGround + FRAME.clearance);
    Cesium.Cartesian3.fromDegrees(pose.lon, pose.lat, height, Cesium.Ellipsoid.WGS84, scratchPos);
    scratchView.orientation.heading = pose.heading;
    scratchView.orientation.pitch = pose.pitch;
    camera.setView(scratchView);
  };

  /** Follow pose for a route distance: orbit or chase, depending on the camera setting. */
  const followPose = (meters: number): Pose => {
    const sample = trackAt(meters);
    const ground = sampleGround(sample.lon, sample.lat, groundHeight);
    return cameraMode === 'orbit'
      ? orbitPose(sample.lon, sample.lat, ground, orbitAngle)
      : chasePose(sample.lon, sample.lat, ground, chaseHeading);
  };

  /** The opening shot: overview, an approach behind the start, then a settle into the follow camera at the start. */
  const introPose = (elapsed: number): Pose => {
    // The track sample is a shared scratch object, so read the start before followPose() overwrites it.
    const start = trackAt(0);
    const approach = sweepPose(start.lon, start.lat, sampleGround(start.lon, start.lat, groundHeight), start.heading);
    return openingPose(elapsed, { from: introFrom!, overview: overview!, approach, follow: followPose(0) });
  };

  // Markers ------------------------------------------------------------------

  const clearMarkers = () => {
    if (!scene.isDestroyed()) {
      if (markers) scene.primitives.remove(markers);
      if (glyphs) scene.primitives.remove(glyphs);
      if (callouts) scene.primitives.remove(callouts);
      if (highlight) scene.primitives.remove(highlight);
    }
    markers = null;
    marker = null;
    glyphs = null;
    callouts = null;
    calloutLabels = [];
    glyphBillboards = [];
    highlight = null;
    highlightKey = '';
    stepIndex = -2;
  };

  const buildMarkers = () => {
    if (!track) return;
    const accent = look.roads.route.color;
    const ink = look.ink;
    const plate = look.space;

    markers = new Cesium.PointPrimitiveCollection();
    marker = markers.add({
      position: Cesium.Cartesian3.fromDegrees(track.points[0][0], track.points[0][1], groundHeight),
      pixelSize: MARKER_PIXELS,
      color: Cesium.Color.fromCssColorString(accent),
      outlineColor: Cesium.Color.fromCssColorString(look.halo),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    scene.primitives.add(markers);

    glyphs = new Cesium.BillboardCollection();
    callouts = new Cesium.LabelCollection();
    glyphBillboards = [];
    calloutLabels = [];
    const halo = Cesium.Color.fromCssColorString(look.halo);
    const inkColor = Cesium.Color.fromCssColorString(ink);
    for (const { step } of placed) {
      const position = Cesium.Cartesian3.fromDegrees(step.lon, step.lat);
      glyphBillboards.push(
        glyphs.add({
          position,
          image: glyphDataUrl(step.kind, ink, accent, plate),
          width: 30,
          height: 30,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }),
      );
      const text =
        step.kind === 'stop-sign' || step.kind === 'traffic-signal'
          ? `${stepTitle(step.kind)}\n${step.roadName}`
          : step.roadName || stepTitle(step.kind);
      calloutLabels.push(
        callouts.add({
          position,
          text,
          font: '12px "IBM Plex Mono"',
          fillColor: inkColor,
          outlineColor: halo,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: false,
        }),
      );
    }
    scene.primitives.add(glyphs);
    scene.primitives.add(callouts);
  };

  /** Dims maneuvers already passed, and shows callouts only for the next few. */
  const updateMarkerStates = (index: number) => {
    for (let i = 0; i < glyphBillboards.length; i++) {
      const passed = i <= index;
      glyphBillboards[i].color = Cesium.Color.WHITE.withAlpha(passed ? 0.35 : 1);
      calloutLabels[i].show = i > index && i <= index + CALLOUTS_AHEAD;
    }
  };

  const buildHighlight = (index: number) => {
    if (!track) return;
    const from = index >= 0 ? placed[index].meters : 0;
    const next = placed[index + 1];
    const to = next ? next.meters : track.totalM;
    const key = `${from}:${to}`;
    if (key === highlightKey) return;
    highlightKey = key;
    if (highlight) scene.primitives.remove(highlight);
    highlight = null;

    const points = slice(track, from, to);
    if (points.length < 2) return;
    highlight = new Cesium.GroundPolylinePrimitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({
          positions: Cesium.Cartesian3.fromDegreesArray(points.flat()),
          width: HIGHLIGHT_WIDTH,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString(look.roads.route.color).withAlpha(0.95),
          ),
        },
      }),
      appearance: new Cesium.PolylineColorAppearance(),
    });
    scene.primitives.add(highlight);
  };

  // Snapshot -----------------------------------------------------------------

  const legAt = (elapsed: number): number => {
    const index = legEnds.findIndex((end) => elapsed <= end);
    return index < 0 ? legEnds.length - 1 : index;
  };

  const buildSnapshot = (): PlaybackSnapshot => {
    if (!route || !track) return IDLE_SNAPSHOT;
    const meters = currentMeters();
    const index = currentStepIndex(placed, meters);
    const leg = route.legs.length > 0 ? route.legs[Math.max(0, legAt(seconds))] : undefined;
    const roadName = index >= 0 ? placed[index].step.roadName : (placed[0]?.step.roadName ?? '');
    const upcoming = upcomingSteps(placed, index, meters, UPCOMING_COUNT);
    return {
      phase,
      camera: cameraMode,
      speed,
      route,
      elapsedS: seconds,
      remainingS: Math.max(track.totalS - seconds, 0),
      durationS: track.totalS,
      traveledM: meters,
      remainingM: Math.max(track.totalM - meters, 0),
      progress: track.totalS > 0 ? Math.min(seconds / track.totalS, 1) : 0,
      roadName,
      difficulty: leg?.difficulty ?? route.difficulty,
      next: upcoming[0] ?? null,
      upcoming,
    };
  };

  const publish = (now: number) => {
    lastPublish = now;
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  };

  // Phase helpers --------------------------------------------------------------

  const captureIntroStart = () => {
    const carto = camera.positionCartographic;
    introFrom = {
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height,
      heading: camera.heading,
      pitch: camera.pitch,
    };
  };

  const beginIntro = () => {
    captureIntroStart();
    introElapsed = 0;
    introDone = false;
    seconds = 0;
    phase = 'intro';
    cameraDirty = true;
  };

  const endIntro = () => {
    introDone = true;
    introElapsed = INTRO_TOTAL_S;
    seconds = 0;
    phase = 'playing';
    cameraDirty = true;
  };

  const releaseControls = () => {
    if (!holdingControls) return;
    holdingControls = false;
    if (!viewer.isDestroyed()) controls.enableInputs = savedInputs;
  };

  // Frame loop ------------------------------------------------------------------

  const onPreUpdate = () => {
    if (destroyed || viewer.isDestroyed()) return;
    const now = performance.now();
    const dt = Math.min((now - lastNow) / 1000, MAX_FRAME_S);
    lastNow = now;
    if (!route || !track || phase === 'idle') return;

    // Ground under the marker, sampled at a fixed rate.
    groundTimer -= dt;
    if (groundTimer <= 0) {
      groundTimer = GROUND_SAMPLE_S;
      const sample = trackAt(currentMeters());
      groundHeight = sampleGround(sample.lon, sample.lat, groundHeight);
    }

    let moved = false;

    if (phase === 'intro') {
      introElapsed += dt;
      if (introElapsed >= INTRO_TOTAL_S) {
        endIntro();
      } else {
        applyPose(introPose(introElapsed));
        moved = true;
      }
    }

    if (phase === 'playing') {
      seconds += dt * routeSecondsPerSecond(speed, track.totalS);
      orbitAngle += dt * FRAME.orbitRate;
      if (seconds >= track.totalS) {
        seconds = track.totalS;
        phase = 'ended';
        publish(now);
      }
      const sample = trackAt(currentMeters());
      chaseHeading = lerpAngle(chaseHeading, sample.heading, 1 - Math.exp(-dt / HEADING_TIME_S));
      applyPose(followPose(currentMeters()));
      moved = true;
    } else if (cameraDirty && (phase === 'paused' || phase === 'ended')) {
      applyPose(followPose(currentMeters()));
      moved = true;
    }
    cameraDirty = false;

    const index = currentStepIndex(placed, currentMeters());
    if (index !== stepIndex) {
      stepIndex = index;
      updateMarkerStates(index);
      buildHighlight(index);
    }
    if (marker && track) {
      const sample = trackAt(currentMeters());
      marker.position = Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, groundHeight + 3);
    }

    if (moved) scene.requestRender();
    if (now - lastPublish >= PUBLISH_MS && (phase === 'playing' || phase === 'intro')) publish(now);
  };

  scene.preUpdate.addEventListener(onPreUpdate);

  // Public API ------------------------------------------------------------------

  const stopInternal = () => {
    clearMarkers();
    route = null;
    track = null;
    placed = [];
    legEnds = [];
    phase = 'idle';
    releaseControls();
    snapshot = IDLE_SNAPSHOT;
  };

  const start = (next: Route, cameraArg: PlaybackCamera = 'orbit') => {
    if (destroyed) return;
    stopInternal();
    const built = buildTrack(next);
    if (built.points.length < 2 || built.totalM <= 0) {
      console.warn('Playback: the route has no line to play');
      return;
    }
    route = next;
    track = built;
    placed = placeSteps(built, next.legs.flatMap((leg) => leg.steps));
    let end = 0;
    legEnds = next.legs.map((leg) => (end += leg.durationS));

    const first = trackAt(0);
    groundHeight = sampleGround(first.lon, first.lat, 0);
    cameraGround = groundHeight;
    settleStartGround(first.lon, first.lat);
    orbitAngle = first.heading;
    chaseHeading = first.heading;
    cameraMode = cameraArg;
    savedInputs = controls.enableInputs;
    controls.enableInputs = false;
    holdingControls = true;

    // Overview: centered on the route's bounding box, framed to fit its longest side.
    const centerLon = (built.minLon + built.maxLon) / 2;
    const centerLat = (built.minLat + built.maxLat) / 2;
    const extent = extentMeters(built.minLon, built.maxLon, built.minLat, built.maxLat);
    overview = overviewPose(centerLon, centerLat, sampleGround(centerLon, centerLat, 0), extent, first.heading);

    buildMarkers();
    beginIntro();
    publish(performance.now());
    scene.requestRender();
  };

  const pause = () => {
    if (phase !== 'intro' && phase !== 'playing') return;
    phase = 'paused';
    publish(performance.now());
  };

  const resume = () => {
    if (!route || !track) return;
    if (phase === 'ended') {
      seconds = 0;
      introDone = true;
      phase = 'playing';
      publish(performance.now());
      return;
    }
    if (phase !== 'paused') return;
    phase = introDone ? 'playing' : 'intro';
    cameraDirty = true;
    publish(performance.now());
  };

  const seek = (fraction: number) => {
    if (!route || !track || phase === 'idle') return;
    seconds = Math.min(Math.max(fraction, 0), 1) * track.totalS;
    if (phase === 'intro') endIntro();
    if (phase === 'ended' && seconds < track.totalS) phase = 'paused';
    cameraDirty = true;
    publish(performance.now());
  };

  const setCamera = (next: PlaybackCamera) => {
    if (next === cameraMode) return;
    cameraMode = next;
    cameraDirty = true;
    publish(performance.now());
  };

  const skipIntro = () => {
    if (phase !== 'intro') return;
    endIntro();
    publish(performance.now());
  };

  const restart = () => {
    if (!route || !track) return;
    beginIntro();
    publish(performance.now());
  };

  const restyle = (next: MapLook) => {
    look = next;
    if (!route || !track) return;
    // Icons and the highlight carry color, so rebuild them. Keep the step index so callouts stay put.
    const index = stepIndex;
    clearMarkers();
    buildMarkers();
    buildHighlight(index);
    updateMarkerStates(index);
    stepIndex = index;
    scene.requestRender();
  };

  const destroy = () => {
    if (destroyed) return;
    stopInternal();
    scene.preUpdate.removeEventListener(onPreUpdate);
    destroyed = true;
    listeners.clear();
  };

  return {
    start,
    pause,
    resume,
    togglePlay() {
      if (phase === 'intro' || phase === 'playing') pause();
      else resume();
    },
    seek,
    setSpeed(next: PlaybackSpeed) {
      speed = next;
      publish(performance.now());
    },
    setCamera,
    skipIntro,
    restart,
    stop() {
      stopInternal();
      publish(performance.now());
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restyle,
    destroy,
  };
}
