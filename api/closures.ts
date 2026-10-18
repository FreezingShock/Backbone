// GET /api/closures: road closures as GeoJSON. Hand-curated overrides always apply. The state feed is added when configured.
// See src/lib/feeds/README.md.
import { cacheControlFor, getClosures } from '../src/lib/feeds/service';
import { jsonResponse } from '../src/lib/feeds/http';

export async function GET(): Promise<Response> {
  const { collection } = await getClosures();
  return jsonResponse(collection, 200, cacheControlFor(collection.meta.feeds));
}
