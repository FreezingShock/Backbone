// GET /api/fires: active wildfire perimeters in the Santa Monica Mountains box, as GeoJSON.
// Each feature's id is its fire ID, so the client updates each fire in place. See src/lib/feeds/README.md.
import { cacheControlFor, getFires } from '../src/lib/feeds/service';
import { jsonResponse } from '../src/lib/feeds/http';

export async function GET(): Promise<Response> {
  const { collection, available } = await getFires();
  const cacheControl = cacheControlFor(collection.meta.feeds);
  if (!available) {
    return jsonResponse({ error: 'fire perimeters unavailable', ...collection }, 503, 'no-store');
  }
  return jsonResponse(collection, 200, cacheControl);
}
