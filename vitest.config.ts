import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
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
