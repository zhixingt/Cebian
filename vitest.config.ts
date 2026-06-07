import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    // Playwright-based E2E specs in e2e/ are excluded — they use
    // @playwright/test's test.describe which is a different runner.
    // Run with `pnpm test:e2e`.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/e2e/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
      // WXT aliases — not available in vitest. Stub them so modules that
      // transitively import i18n (via lib/i18n → #i18n) can be loaded.
      '#i18n': resolve(__dirname, './vitest-stubs/i18n.ts'),
      '#imports': resolve(__dirname, './vitest-stubs/imports.ts'),
    },
  },
});
