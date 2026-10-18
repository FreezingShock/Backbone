// Live fetchers. Server-side only. Each one throws on failure. Callers decide the fallback.
import { FETCH_TIMEOUT_MS, SMM_BBOX, USER_AGENT } from './config';
import { parseCalFireIncident, type CalFireIncident } from './calfire';
import type { RawCollection } from './normalize';

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // Report the host only. Query strings and full URLs stay out of error text.
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response;
}

// Builds a fixed WFIGS query. The where clause is always 1=1 and the area is a fixed envelope.
// Relative-date filters are not used, because WFIGS asks callers to avoid them.
export function buildWfigsQueryUrl(serviceUrl: string): string {
  const { west, south, east, north } = SMM_BBOX;
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  return `${serviceUrl}/query?${params.toString()}`;
}

export async function fetchWfigsPerimeters(serviceUrl: string): Promise<RawCollection> {
  const response = await fetchOk(buildWfigsQueryUrl(serviceUrl));
  const body = (await response.json()) as { error?: { message?: string }; features?: unknown };
  // ArcGIS returns HTTP 200 with an error body on bad queries, so check the body too.
  if (body.error) throw new Error(`WFIGS error: ${body.error.message ?? 'unknown'}`);
  if (!Array.isArray(body.features)) throw new Error('WFIGS response had no features array');
  return body as RawCollection;
}

// Fetches each CAL FIRE page. A page that fails is skipped. Only if every page fails does this throw.
export async function fetchCalFireIncidents(urls: string[]): Promise<CalFireIncident[]> {
  const results = await Promise.allSettled(
    urls.map(async (url) => parseCalFireIncident(await (await fetchOk(url)).text(), url)),
  );
  const incidents: CalFireIncident[] = [];
  let firstError: unknown = null;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value) incidents.push(result.value);
    } else {
      firstError ??= result.reason;
    }
  }
  if (incidents.length === 0 && firstError) throw firstError;
  return incidents;
}

export async function fetchCaltransClosures(url: string): Promise<unknown> {
  return (await fetchOk(url)).json();
}
