// Local runner for api/ handlers. Serves them on plain Node so the feed layer works without Vercel.
// Run from the repo root:  npx -y tsx src/lib/feeds/localApi.ts
// Port: BACKBONE_API_PORT, default 8787. Fixture fallback is on unless BACKBONE_FEED_FIXTURES is set.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type Handler = { GET: (request: Request) => Promise<Response> };

const ROUTES: Record<string, () => Promise<Handler>> = {
  '/api/fires': () => import('../../../api/fires'),
  '/api/closures': () => import('../../../api/closures'),
};

async function forward(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const load = ROUTES[url.pathname];
  if (!load) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', routes: Object.keys(ROUTES) }));
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    res.end();
    return;
  }
  const handler = await load();
  const response = await handler.GET(new Request(url, { method: 'GET' }));
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(await response.text());
}

export function startLocalApi(port = Number(process.env.BACKBONE_API_PORT ?? 8787)): void {
  // Local default: serve bundled sample data when live feeds are unreachable.
  // Production never sets this, so sample data is never served as live.
  process.env.BACKBONE_FEED_FIXTURES ??= '1';
  const server = createServer((req, res) => {
    forward(req, res, port).catch((error: unknown) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'internal error' }));
    });
  });
  server.listen(port, () => {
    console.log(`Backbone feeds API on http://localhost:${port}`);
    console.log('  GET /api/fires     GET /api/closures');
  });
}

if (process.argv[1] && /localApi\.(ts|js)$/.test(process.argv[1])) {
  startLocalApi();
}
