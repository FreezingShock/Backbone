import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Cesium assets live in public/cesium (see scripts/copy-cesium.mjs). index.html sets CESIUM_BASE_URL to /cesium/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 6000,
  },
});
