export type BasemapStyle = 'blueprint' | 'satellite';

export type CameraMode = 'orbit' | 'freefly';

export interface RuntimeStatus {
  imagery: 'loading' | 'ok' | 'error';
  terrain: 'loading' | 'ion' | 'flat' | 'error';
}
