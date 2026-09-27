/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the export works from any static host, gateway subpath or
// ENS name without server rewrites. The export lands at the repository root
// `dist/`; `scripts/manifest.mjs` adds the ABI JSON and the deployment manifest.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    css: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
