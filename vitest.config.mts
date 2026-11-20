import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL('./test/stubs/obsidian.ts', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/stubs/setup.ts'],
    testTimeout: 10000,
    environmentOptions: { happyDOM: { settings: { disableIframePageLoading: false, enableIframePageLoading: true } } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'scripts/security-summary.mjs'],
      exclude: ['src/**/*.d.ts', 'scripts/**/*.d.mts'],
      thresholds: { statements: 90, lines: 90, functions: 90, branches: 80 },
    },
  },
});
