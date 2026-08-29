import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative URLs allow the app to work both at / and at a project-scoped
  // Pages path. The deployment workflow supplies GitHub's current base path.
  base: './',
  plugins: [react()],
  test: {
    exclude: ['tests/visual/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/maplibre-gl/')) return 'maplibre';
          if (id.includes('/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
});
