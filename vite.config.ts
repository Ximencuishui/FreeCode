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
    port: 5180,
    strictPort: true,
    watch: {
      // 忽略编辑器的原子写临时目录/文件（避免 Windows 上 EBUSY 让 dev server 崩溃）
      ignored: [
        '**/*.tmpdir/**',
        '**/*.tmp',
      ],
    },
  },
  build: {
    // renderer 默认输出 dist/，main/preload 由 vite-plugin-electron 输出到 dist/main、dist/preload
    outDir: 'dist',
    emptyOutDir: true,
  },
});
