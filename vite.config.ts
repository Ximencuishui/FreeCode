import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: { outDir: 'dist/main' },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: { outDir: 'dist/preload' },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': sharedDir,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // renderer 默认输出 dist/，main/preload 由 vite-plugin-electron 输出到 dist/main、dist/preload
    outDir: 'dist',
    emptyOutDir: true,
  },
});
