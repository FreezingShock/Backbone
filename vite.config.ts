import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const CESIUM_DIR = resolve(__dirname, 'public/cesium');
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.glsl': 'text/plain',
  '.czml': 'application/json',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
};

/**
 * Dev only. Cesium's workers are module workers that import sibling chunks from /cesium/Workers/.
 * Vite's transform pipeline rejects those public files when they are imported, so /cesium/ is served
 * straight from disk before Vite's own middleware runs. The production build copies public/ as-is.
 */
function serveCesiumAssets(): Plugin {
  return {
    name: 'backbone-serve-cesium-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/cesium/')) return next();
        const relative = normalize(decodeURIComponent(url.slice('/cesium/'.length)));
        const file = join(CESIUM_DIR, relative);
        if (!file.startsWith(CESIUM_DIR) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Cesium assets live in public/cesium (see scripts/copy-cesium.mjs). index.html sets CESIUM_BASE_URL to /cesium/.
export default defineConfig({
  plugins: [react(), tailwindcss(), serveCesiumAssets()],
  build: {
    chunkSizeWarningLimit: 6000,
  },
});
