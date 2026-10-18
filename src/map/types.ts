/** Map looks. Blueprint is the line-map look; Satellite is aerial imagery; Relief is shaded terrain on paper. */
export type MapStyle = 'blueprint' | 'satellite' | 'relief';

export type CameraMode = 'orbit' | 'freefly';

export interface RuntimeStatus {
  imagery: 'loading' | 'ok' | 'error';
  // ion: Cesium World Terrain. open: AWS Terrain Tiles fallback when no ion token is set.
  terrain: 'loading' | 'ion' | 'open' | 'error';
}
