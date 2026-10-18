import type { Viewer } from 'cesium';

/** One row in a layer's legend. `thickness` is the swatch height in px. */
export interface LegendItem {
  label: string;
  color: string;
  thickness: number;
  opacity?: number;
}

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
  /** Shown under the layer's checkbox while the layer is on. */
  legend?: LegendItem[];
  /** Small print under the legend, such as data attribution. */
  note?: string;
  mount(viewer: Viewer): LayerHandle;
}
