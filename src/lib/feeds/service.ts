// Feed service: live fetch, last-good cache, and fallbacks. Server-side only.
import {
  CACHE_TTL_MS,
  CALFIRE_INCIDENT_URLS,
  CALTRANS_CLOSURES_URL,
  RETRY_BACKOFF_MS,
  SMM_BBOX,
  WFIGS_PERIMETERS_URL,
  fixturesEnabled,
} from './config';
import { parseCalFireIncident, type CalFireIncident } from './calfire';
import {
  dedupeFires,
  intersectsBbox,
  mergeIncident,
  nameKey,
  normalizeCaltransFeatures,
  normalizeOverrides,
  normalizeWfigsFeature,
  type RawCollection,
} from './normalize';
import { fetchCalFireIncidents, fetchCaltransClosures, fetchWfigsPerimeters } from './sources';
import { calFireBrysonSampleHtml } from './fixtures/calfire-bryson.sample';
import wfigsSample from './fixtures/wfigs-perimeters.sample.json';
import overridesFile from './data/closure-overrides.json';
import type { ClosureCollection, FeedMode, FeedName, FeedStatus, FireCollection, FireFeature } from './types';

const SAMPLE_INCIDENT_URL = 'fixture:calfire-bryson.sample';

interface Good<T> {
  value: T;
  fetchedAt: number;
  sourceUrl: string | null;
}

const lastGood = new Map<FeedName, Good<unknown>>();
const lastFailure = new Map<FeedName, { at: number; message: string }>();
const inflight = new Map<FeedName, Promise<unknown>>();

export interface Resolved<T> {
  value: T | null;
  status: FeedStatus;
}

interface ResolveOptions<T> {
  feed: FeedName;
  sourceUrl: string | null;
  // null means the feed is not configured.
  load: (() => Promise<T>) | null;
  fixture?: () => T | null;
  now?: number;
}

// Node's fetch reports network failures as "fetch failed" and puts the reason on error.cause.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : null;
  return detail ? `${error.message}: ${detail}` : error.message;
}

function makeStatus(
  feed: FeedName,
  mode: FeedMode,
  fetchedAt: number | null,
  sourceUrl: string | null,
  now: number,
  error: string | null,
): FeedStatus {
  return {
    feed,
    mode,
    fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString(),
    ageSeconds: fetchedAt === null ? null : Math.max(0, Math.round((now - fetchedAt) / 1000)),
    sourceUrl,
    error,
  };
}

// Shares one in-flight request per feed, so concurrent page loads do not stampede the source.
function fetchShared<T>(feed: FeedName, fetcher: () => Promise<T>): Promise<T> {
  const pending = inflight.get(feed);
  if (pending) return pending as Promise<T>;
  const request = fetcher().finally(() => inflight.delete(feed));
  inflight.set(feed, request);
  return request;
}

// Order: fresh cache, then live fetch, then last good result (stale), then fixture (dev only), then error.
export async function resolveFeed<T>(options: ResolveOptions<T>): Promise<Resolved<T>> {
  const { feed, sourceUrl, load, fixture } = options;
  const now = options.now ?? Date.now();

  if (!load) return { value: null, status: makeStatus(feed, 'disabled', null, null, now, null) };

  const good = lastGood.get(feed) as Good<T> | undefined;
  if (good && now - good.fetchedAt < CACHE_TTL_MS) {
    return { value: good.value, status: makeStatus(feed, 'live', good.fetchedAt, good.sourceUrl, now, null) };
  }

  let error: string | null = null;
  const failure = lastFailure.get(feed);
  if (failure && now - failure.at < RETRY_BACKOFF_MS) {
    error = failure.message;
  } else {
    try {
      const value = await fetchShared(feed, load);
      const fetchedAt = Date.now();
      lastGood.set(feed, { value, fetchedAt, sourceUrl });
      lastFailure.delete(feed);
      return { value, status: makeStatus(feed, 'live', fetchedAt, sourceUrl, fetchedAt, null) };
    } catch (caught) {
      error = describeError(caught);
      lastFailure.set(feed, { at: Date.now(), message: error });
    }
  }

  if (good) {
    return { value: good.value, status: makeStatus(feed, 'stale', good.fetchedAt, good.sourceUrl, now, error) };
  }
  if (fixture && fixturesEnabled()) {
    return { value: fixture(), status: makeStatus(feed, 'fixture', null, sourceUrl, now, error) };
  }
  return { value: null, status: makeStatus(feed, 'error', null, sourceUrl, now, error ?? 'no data') };
}

export function cacheControlFor(statuses: FeedStatus[]): string {
  if (statuses.some((s) => s.mode === 'fixture' || s.mode === 'error')) return 'no-store';
  if (statuses.some((s) => s.mode === 'stale')) return 'public, max-age=0, s-maxage=60';
  return 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';
}

export interface FireResult {
  collection: FireCollection;
  // False when perimeters have no live, stale, or fixture data.
  available: boolean;
}

export async function getFires(): Promise<FireResult> {
  const now = Date.now();
  const [perimeters, incidents] = await Promise.all([
    resolveFeed<RawCollection>({
      feed: 'wfigs',
      sourceUrl: WFIGS_PERIMETERS_URL,
      load: () => fetchWfigsPerimeters(WFIGS_PERIMETERS_URL),
      fixture: () => wfigsSample as RawCollection,
      now,
    }),
    resolveFeed<CalFireIncident[]>({
      feed: 'calfire',
      sourceUrl: CALFIRE_INCIDENT_URLS.join(', ') || null,
      load: CALFIRE_INCIDENT_URLS.length
        ? () => fetchCalFireIncidents(CALFIRE_INCIDENT_URLS)
        : null,
      fixture: () => {
        const sample = parseCalFireIncident(calFireBrysonSampleHtml, SAMPLE_INCIDENT_URL);
        return sample ? [sample] : [];
      },
      now,
    }),
  ]);

  const perimeterSource = perimeters.status.mode === 'fixture' ? 'fixture' : 'wfigs';
  const incidentList = incidents.value ?? [];
  const fires: FireFeature[] = [];
  for (const raw of perimeters.value?.features ?? []) {
    const fire = normalizeWfigsFeature(raw, perimeterSource);
    if (!fire || !intersectsBbox(fire.geometry, SMM_BBOX)) continue;
    const match = incidentList.find((incident) => nameKey(incident.name) === nameKey(fire.properties.name));
    fires.push(mergeIncident(fire, match));
  }

  const statuses = [perimeters.status, incidents.status];
  return {
    available: perimeters.value !== null,
    collection: {
      type: 'FeatureCollection',
      features: dedupeFires(fires),
      meta: { generatedAt: new Date(now).toISOString(), ttlSeconds: 300, feeds: statuses },
    },
  };
}

export interface ClosureResult {
  collection: ClosureCollection;
}

export async function getClosures(): Promise<ClosureResult> {
  const now = Date.now();
  const overrides = normalizeOverrides(overridesFile, now);
  const caltransUrl = CALTRANS_CLOSURES_URL;
  const caltrans = await resolveFeed<unknown>({
    feed: 'caltrans',
    sourceUrl: caltransUrl,
    load: caltransUrl ? () => fetchCaltransClosures(caltransUrl) : null,
    now,
  });
  const features = [...overrides, ...normalizeCaltransFeatures(caltrans.value)];
  const overridesStatus = makeStatus(
    'overrides',
    'static',
    null,
    'src/lib/feeds/data/closure-overrides.json',
    now,
    null,
  );
  return {
    collection: {
      type: 'FeatureCollection',
      features,
      meta: { generatedAt: new Date(now).toISOString(), ttlSeconds: 300, feeds: [overridesStatus, caltrans.status] },
    },
  };
}

// Used only by tests to reset in-memory state between cases.
export function resetFeedState(): void {
  lastGood.clear();
  lastFailure.clear();
  inflight.clear();
}
