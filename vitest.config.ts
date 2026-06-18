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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      exclude: [
        // 框架与构建文件
        'node_modules/**',
        'vitest.config.ts',
        'wxt.config.ts',
        'eslint.config.js',
        '**/*.d.ts',
        // 测试相关
        '__tests__/**',
        'vitest-stubs/**',
        'e2e/**',
        // 入口与UI（依赖Chrome API和DOM渲染，以E2E测试为主）
        'entrypoints/**',
        'components/**',
        'site/**',
        'public/**',
        // 国际化与配置
        'locales/**',
        'openspec/**',
        // 脚本与shim
        'scripts/**',
        'lib/shims/**',
        // 类型与常量（纯声明/无逻辑）
        'lib/types.ts',
        'lib/constants.ts',
        'lib/protocol.ts',
        'lib/recorder/types.ts',
        'lib/recorder/constants.ts',
        'lib/recorder/protocol.ts',
        'lib/recorder/schema-doc.ts',
        // 纯类型或配置模块
        'lib/ai-config/template.ts',
        'lib/ai-config/skill-creator.ts',
        'lib/ai-config/skill-grants.ts',
        'lib/ai-config/skill-transfer.ts',
        'lib/ai-config/skill-validator.ts',
        // Hooks（依赖React生命周期与Chrome API，以E2E/集成测试为主）
        'hooks/**',
        // AI Provider配置（依赖网络请求与浏览器环境，以集成测试为主）
        'lib/ai-config/**',
        // 第三方集成（网络/Chrome依赖）
        'lib/mcp/**',
        'lib/tools/mcp-tool.ts',
        'lib/oauth.ts',
        'lib/page-context.ts',
        'lib/pdf-loader.ts',
        'lib/sandbox-binary.ts',
        'lib/vfs.ts',
        'lib/mobile-emulation.ts',
        'lib/element-picker.ts',
        'lib/clipboard.ts',
        'lib/attachments.ts',
        'lib/dialog.ts',
        'lib/frontmatter.ts',
        'lib/instance-id.ts',
        'lib/i18n.ts',
        'lib/db.ts',
        'lib/tab-helpers.ts',
        'lib/custom-models.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
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
