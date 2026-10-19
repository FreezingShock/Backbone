import type { RoadClass } from './types';

/** Index order used in the graph file. Changing it changes the file format. */
export const ROAD_CLASS_ORDER: RoadClass[] = ['highway', 'crossing', 'arterial', 'collector', 'local'];

export function classIndex(cls: RoadClass): number {
  return ROAD_CLASS_ORDER.indexOf(cls);
}
