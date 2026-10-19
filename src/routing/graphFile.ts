import type { ControlKind, RoadClass } from './types';
import { ROAD_CLASS_ORDER } from './roadClasses';

/**
 * The routing graph file, written by scripts/build-routing-graph.ts into public/data/routing-graph.json. The app
 * fetches it once and builds the search arrays from it. Keep this format in step with buildGraph.ts and graph.ts.
 */
export const GRAPH_FILE_VERSION = 2;

/**
 * One undirected road piece between two graph nodes:
 * [fromNode, toNode, encodedPolyline, lengthM, classIndex, highwayIndex, nameIndex, crossingIndex, curvature,
 *  mountain, corridor, gradeTenths].
 * The polyline runs from fromNode to toNode. Indexes point into the `highways`, `names` and `crossings` tables;
 * index 0 is the empty string. Curvature is whole degrees per km. Mountain is the 0 to 100 score from mountain.ts.
 * Corridor is 1 for a valley road beside the 101, else 0. GradeTenths is the steepness in tenths of a percent,
 * or -1 when no elevation was sampled.
 */
export type EdgeRow = [number, number, string, number, number, number, number, number, number, number, number, number];

/** A control on a node: [node, kind, label]. */
export type ControlRow = [number, ControlKind, string];

/** A named junction: [node, label]. */
export type IntersectionRow = [number, string];

/** A stop that is not a road junction. Cities and points of interest from src/data/places.json. */
export interface PlaceRow {
  id: string;
  name: string;
  kind: 'city' | 'poi';
  lon: number;
  lat: number;
}

export interface GraphFile {
  version: typeof GRAPH_FILE_VERSION;
  /** Where the road pieces came from, for the data notes. */
  source: string;
  /** Node coordinates as one encoded polyline. Node i is the i-th point. */
  nodes: string;
  names: string[];
  highways: string[];
  crossings: string[];
  edges: EdgeRow[];
  intersections: IntersectionRow[];
  controls: ControlRow[];
  places: PlaceRow[];
}

export function classFromIndex(index: number): RoadClass {
  return ROAD_CLASS_ORDER[index];
}
