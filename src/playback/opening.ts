// The opening shot as plain pose math: overview, then an approach behind the start, then a settle into the follow
// camera. Pure, no Cesium import, so the path is testable in node. Every pose it returns ends at the route start.
import { INTRO, smoothstep } from './pacing';
import { blendPose, type Pose } from './poses';

export interface OpeningPoses {
  /** Where the camera was when playback started. */
  from: Pose;
  /** Framed on the whole route. */
  overview: Pose;
  /** A high chase shot behind the first meters of the route. */
  approach: Pose;
  /** The follow camera at the start of the route. The opening ends here. */
  follow: Pose;
}

/** The pose at `elapsed` real seconds into the opening. Clamped: past the end it returns `follow`. */
export function openingPose(elapsed: number, poses: OpeningPoses): Pose {
  const { overviewS, approachS, settleS } = INTRO;
  if (elapsed < overviewS) {
    return blendPose(poses.from, poses.overview, smoothstep(elapsed / overviewS));
  }
  const approachAt = elapsed - overviewS;
  if (approachAt < approachS) {
    return blendPose(poses.overview, poses.approach, smoothstep(approachAt / approachS));
  }
  return blendPose(poses.approach, poses.follow, smoothstep((approachAt - approachS) / settleS));
}
