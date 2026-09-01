import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { LibraryFormats } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';

// rollup 4 警告对象最小结构；只取用到的字段，避免依赖未直接安装的 rollup 类型包。
type RollupLog = { code?: string; message?: string };

const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url));

/**
 * 静默 vite-plugin-electron@1.1.1 内部 `compatRollupOptions` 透传的
 * `rollupOptions.platform = 'node'` 与 `rollupOptions.output.codeSplitting = false`
 * 在 rollup 4 下产生的 UNKNOWN_OPTION 警告（rollup 4 已不接受这两个键）。
 * 其它真实的 UNKNOWN_OPTION 警告仍会走 defaultHandler，便于发现真正不兼容的配置。
 */
const rollupOnWarn = (
  warning: RollupLog,
  defaultHandler?: (warning: unknown) => void,
) => {
  if (warning.code === 'UNKNOWN_OPTION') return;
  defaultHandler?.(warning);
};

/**
 * 构造 main / preload 共用的 vite 子配置：
 * 用 `build.lib.entry` + `build.minify` 等标准 rollup 字段直接描述产出，
 * 不依赖 simple API 内部默认注入的 `platform` / `codeSplitting` 字段语义。
 */
const electronBuild = (entry: string, outDir: string) => ({
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry,
      formats: ['cjs'] satisfies LibraryFormats[],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        inlineDynamicImports: true,
      },
      // vite 6 的 build.rollupOptions 类型刻意 Omit 了 onwarn（@deprecated），
      // 但运行时仍会透传给 rollup；用 `as never` 规避类型校验，保留运行时过滤行为。
      onwarn: rollupOnWarn,
    } as never,
  },
});

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: electronBuild('src/main/index.ts', 'dist/main'),
      },
      {
        entry: 'src/preload/index.ts',
        vite: electronBuild('src/preload/index.ts', 'dist/preload'),
      },
    ]),
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
      ignored: ['**/*.tmpdir/**', '**/*.tmp'],
    },
  },
  build: {
    // renderer 默认输出 dist/，main/preload 由 vite-plugin-electron 输出到 dist/main、dist/preload
    outDir: 'dist',
    emptyOutDir: true,
  },
});
