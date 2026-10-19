import { metersBetween } from './geo';
import { getRoutingGraph } from './planRoute';
import type { Stop, SuggestNear } from './types';

const KIND_RANK: Record<Stop['kind'], number> = { city: 0, poi: 1, intersection: 2, custom: 3 };

/** Stable id for an intersection: its coordinates, so it survives a rebuild that renumbers the nodes. */
export function intersectionId(lon: number, lat: number): string {
  return `ix:${lon.toFixed(5)},${lat.toFixed(5)}`;
}

/**
 * Stops that match a query: city centers, points of interest, and junctions between named canyon roads
 * (for example "Topanga Canyon Blvd & Mulholland Hwy"). Every word of the query must match part of the name.
 * Matches that start the name rank first, then word starts, then anywhere. Ties go to cities, then points of
 * interest, then junctions, then the nearest one to `near` when it is given. An empty query lists cities.
 */
export function suggestStops(query: string, near?: SuggestNear, limit = 12): Stop[] {
  const graph = getRoutingGraph();
  if (!graph) throw new Error('Routing graph is not loaded. Call loadRoutingGraph() first.');

  const candidates: Stop[] = [
    ...graph.places.map((place) => ({ id: place.id, name: place.name, kind: place.kind, lon: place.lon, lat: place.lat })),
    ...graph.intersections.map(({ node, label }) => ({
      id: intersectionId(graph.lon[node], graph.lat[node]),
      name: label,
      kind: 'intersection' as const,
      lon: graph.lon[node],
      lat: graph.lat[node],
    })),
  ];

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const distance = (stop: Stop): number => (near ? metersBetween([near.lon, near.lat], [stop.lon, stop.lat]) : 0);

  const scored: { stop: Stop; rank: number }[] = [];
  for (const stop of candidates) {
    const name = stop.name.toLowerCase();
    let rank: number;
    if (tokens.length === 0) {
      if (stop.kind !== 'city') continue;
      rank = 2;
    } else {
      if (!tokens.every((token) => name.includes(token))) continue;
      if (name.startsWith(tokens.join(' '))) rank = 0;
      else if (tokens.every((token) => name.split(/[\s&/()-]+/).some((word) => word.startsWith(token)))) rank = 1;
      else rank = 2;
    }
    scored.push({ stop, rank });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const kind = KIND_RANK[a.stop.kind] - KIND_RANK[b.stop.kind];
    if (kind !== 0) return kind;
    if (near) return distance(a.stop) - distance(b.stop);
    return a.stop.name.localeCompare(b.stop.name);
  });

  return scored.slice(0, limit).map((entry) => entry.stop);
}

/** A stop placed by hand, for example from a map click. Its name says where it is. */
export function customStop(lon: number, lat: number, name?: string): Stop {
  return {
    id: `custom:${lon.toFixed(5)},${lat.toFixed(5)}`,
    name: name ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    kind: 'custom',
    lon,
    lat,
  };
}
