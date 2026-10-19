// Public surface of route playback. The planner imports from here.
//   const playback = usePlaybackController(viewer, look);   // one per viewer, null until the viewer exists
//   playback?.start(route, 'orbit' | 'freefly');             // plays a Route; always opens with the overview shot
//   <PlaybackControls controller={playback} />               // transport bar, renders nothing when idle
//   <NavigationHUD controller={playback} />                  // turn banner and remaining time, renders nothing when idle
export type { Route, Leg, Step, Stop, StepKind, Difficulty, LonLat } from './routeTypes';
export { createPlaybackController, IDLE_SNAPSHOT } from './controller';
export type { PlaybackController, PlaybackSnapshot, PlaybackPhase, PlaybackCamera, NextManeuver } from './controller';
export { usePlaybackController, usePlaybackSnapshot } from './usePlayback';
export { PlaybackControls } from './PlaybackControls';
export { NavigationHUD } from './NavigationHUD';
export { DIFFICULTY_STYLE } from './difficulty';
export { PLAYBACK_SPEEDS, type PlaybackSpeed } from './pacing';
