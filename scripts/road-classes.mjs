// Name-based road hierarchy for the map. Used by scripts/build-roads.mjs and by `--reclassify`.
// Classes, highest first:
//   highway   US 101, Ventura and Moorpark freeways, Pacific Coast Hwy, and their ramps. Dimmed, and "avoid" for canyon routes.
//   crossing  Canyon roads that cross the Santa Monica Mountains and the Conejo Valley. Highlighted and labeled.
//   arterial  State routes and major county roads (TIGER S1200), plus named valley boulevards.
//   collector Named through roads (Rd, Blvd, Ave, Pkwy) that are not crossings or arterials.
//   local     Neighborhood streets (Dr, Ln, Ct, Cir, Pl, Way), service roads, fire roads, and trails.
// The crossing list is hand-written. Names come from Census TIGER/Line, where the direction prefix has already been dropped.

export const CLASSES = ['highway', 'crossing', 'arterial', 'collector', 'local'];

/** Canyon crossings. `short` is the label on the map. Order does not matter. */
export const CROSSINGS = [
  { short: 'Malibu Canyon', pattern: /^malibu canyon (rd|road|blvd)$/i },
  { short: 'Kanan Dume', pattern: /^kanan dume (rd|road)$/i },
  { short: 'Topanga Canyon', pattern: /^topanga canyon (blvd|boulevard|rd|road)$/i },
  { short: 'Old Topanga', pattern: /^old topanga canyon (rd|road)$/i },
  { short: 'Las Virgenes', pattern: /^las virgenes(( canyon)? (rd|road))$/i },
  { short: 'Decker', pattern: /^decker( (canyon|cyn))? (rd|road)$/i },
  { short: 'Encinal Canyon', pattern: /^encinal canyon (rd|road)$/i },
  { short: 'Westlake Blvd', pattern: /^westlake (blvd|boulevard)$/i },
  { short: 'Potrero', pattern: /^potrero (rd|road)$/i },
  { short: 'Lynn', pattern: /^lynn (rd|road)$/i },
  { short: 'Wendy', pattern: /^wendy (dr|drive)$/i },
  { short: 'Mulholland Hwy', pattern: /^mulholland (hwy|highway)$/i },
  { short: 'Mulholland Dr', pattern: /^mulholland (dr|drive)$/i },
  { short: 'Latigo Canyon', pattern: /^latigo canyon (rd|road)$/i },
  { short: 'Yerba Buena', pattern: /^yerba buena (rd|road)$/i },
  { short: 'Reyes Adobe', pattern: /^reyes adobe (rd|road)$/i },
  { short: 'Kanan', pattern: /^kanan (rd|road)$/i },
  { short: 'Lindero Canyon', pattern: /^lindero canyon (rd|road)$/i },
  { short: 'Triunfo Canyon', pattern: /^triunfo canyon (rd|road)$/i },
  { short: 'Liberty Canyon', pattern: /^liberty canyon (rd|road)$/i },
  { short: 'Corral Canyon', pattern: /^corral canyon (rd|road)$/i },
  { short: 'Little Sycamore', pattern: /^little sycamore canyon (rd|road)$/i },
  { short: 'Lobo Canyon', pattern: /^lobo canyon (rd|road)$/i },
  { short: 'Palo Comado', pattern: /^palo comado canyon (rd|road)$/i },
  // SR 27 is Topanga Canyon Blvd north of the coast highway, so it reads as the same crossing.
  { short: 'Topanga Canyon', pattern: /^state rte 27$/i },
];

/** Named valley boulevards that carry through traffic but are not state routes. */
const ARTERIAL_NAMES = /^(thousand oaks blvd|ventura blvd|victory blvd|calabasas rd|parkway calabasas|agoura rd|moorpark rd|rancho conejo blvd|sunset blvd|conejo blvd|lindero canyon rd)$/i;

const HIGHWAY_NAME = /\b(fwy|freeway)\b|^us hwy 101$|^pacific coast hwy$|^pch$|^state rte (1|23|101)$/i;
const HIGHWAY_REF = /^(US 101|CA 1|CA 23)$/;
const RAMP_NAME = /\b(rmp|ramp|exd|onr|offr)\b/i;
const COLLECTOR_SUFFIX = /\b(rd|road|blvd|boulevard|ave|avenue|pkwy|parkway|hwy|highway)$/i;
const TRAIL_HIGHWAY = /^(track|path|footway|bridleway|steps|cycleway|pedestrian)$/;

/** The crossing a road belongs to, or null. */
export function crossingOf(name) {
  if (!name) return null;
  const hit = CROSSINGS.find(({ pattern }) => pattern.test(name));
  return hit ? hit.short : null;
}

/**
 * Classifies one road. `highway` is the OSM-style tag (TIGER values are mapped in build-roads.mjs).
 * `ref` is the OSM route number, when there is one.
 * Returns { class, crossing } where crossing is the short name, or null.
 */
export function classifyRoad({ name = '', ref = '', highway = '' }) {
  // OSM ref tags (CA 1, US 101) carry the route number when the way has no name.
  const crossing = crossingOf(name) ?? (ref === 'CA 27' ? 'Topanga Canyon' : null);
  if (HIGHWAY_NAME.test(name) || HIGHWAY_REF.test(ref) || (RAMP_NAME.test(name) && /fwy|freeway/i.test(name))) {
    return { class: 'highway', crossing: null };
  }
  if (/\bbus\b/i.test(name)) return { class: 'arterial', crossing: null };
  if (crossing) return { class: 'crossing', crossing };
  if (/^(primary|motorway|trunk)(_link)?$/.test(highway)) return { class: 'highway', crossing: null };
  if (/^(secondary|tertiary)(_link)?$/.test(highway) || ARTERIAL_NAMES.test(name)) {
    return { class: 'arterial', crossing: null };
  }
  if (TRAIL_HIGHWAY.test(highway)) return { class: 'local', crossing: null };
  if (name && COLLECTOR_SUFFIX.test(name) && !/\b(fire rd|trl|trail)\b/i.test(name)) {
    return { class: 'collector', crossing: null };
  }
  return { class: 'local', crossing: null };
}
