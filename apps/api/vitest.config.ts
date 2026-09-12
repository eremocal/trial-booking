import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Vitest transforms with esbuild, which does NOT emit decorator metadata.
    // Nest resolves constructor dependencies from that metadata, so without
    // this every injected provider arrives as `undefined`.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // Tests share one database, so files must not run in parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
