import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
