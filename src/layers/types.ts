import type { Viewer } from 'cesium';

export interface LayerHandle {
  show(visible: boolean): void;
  destroy(): void;
}

/**
 * A map layer shown in the layer panel.
 *
 * `mount` runs once per viewer and adds Cesium primitives. Use primitives,
 * not Entities, for lines and other large sets. Return a handle that
 * shows, hides, and removes them.
 */
export interface MapLayer {
  id: string;
  label: string;
  /** Panel section, e.g. "Base", "Fire", "Roads". */
  group: string;
  defaultVisible: boolean;
  mount(viewer: Viewer): LayerHandle;
}
