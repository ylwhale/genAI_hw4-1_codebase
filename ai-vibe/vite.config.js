import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js alone is ~500 kB minified; the whole game is a single page.
    chunkSizeWarningLimit: 800,
  },
});
