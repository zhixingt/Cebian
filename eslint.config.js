import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // 全局忽略
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'dist/**',
      '*.cjs',
      'site/**',
      'scripts/**',
      'e2e/**',
      'vitest-stubs/**',
      'skills/**',
      'openspec/**',
      'public/**',
    ],
  },

  // 基础推荐规则
  js.configs.recommended,

  // TypeScript 推荐规则
  ...tseslint.configs.recommended,

  // React Hooks 规则（只启用核心规则，v7 新规则降级为 warn）
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/unsupported-syntax': 'warn',
      'react-hooks/config': 'off',
      'react-hooks/gating': 'off',
    },
  },

  // React Refresh 规则（仅组件文件）
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // Prettier 兼容（禁用与 Prettier 冲突的规则）
  prettierConfig,

  // Skill 脚本运行环境（assets/skills/**）
  // 这些脚本在沙箱中执行，bgFetch/args 等由运行时注入
  {
    files: ['assets/skills/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        bgFetch: 'readonly',
        args: 'readonly',
      },
    },
  },

  // 项目自定义规则
  {
    languageOptions: {
      globals: {
        // Chrome 扩展 API
        chrome: 'readonly',
        // Node.js 全局变量（wxt.config.ts 等构建脚本使用）
        process: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        // 浏览器全局变量
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        HTMLElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        Event: 'readonly',
        MessageEvent: 'readonly',
        ErrorEvent: 'readonly',
        CustomEvent: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        PerformanceObserver: 'readonly',
        ClipboardEvent: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        PointerEvent: 'readonly',
        WheelEvent: 'readonly',
        DragEvent: 'readonly',
        TouchEvent: 'readonly',
        AnimationEvent: 'readonly',
        TransitionEvent: 'readonly',
        FocusEvent: 'readonly',
        InputEvent: 'readonly',
        CompositionEvent: 'readonly',
        DOMParser: 'readonly',
        XMLSerializer: 'readonly',
        CSSStyleSheet: 'readonly',
        ShadowRoot: 'readonly',
        DOMRect: 'readonly',
        Range: 'readonly',
        Selection: 'readonly',
        Text: 'readonly',
        Comment: 'readonly',
        DocumentFragment: 'readonly',
        OffscreenCanvas: 'readonly',
        ImageBitmap: 'readonly',
        ImageData: 'readonly',
        Path2D: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        AudioContext: 'readonly',
        MediaStream: 'readonly',
        RTCPeerConnection: 'readonly',
        WebSocket: 'readonly',
        Worker: 'readonly',
        ServiceWorker: 'readonly',
        Notification: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        crypto: 'readonly',
        CryptoKey: 'readonly',
        SubtleCrypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
        TransformStream: 'readonly',
        BroadcastChannel: 'readonly',
        MessageChannel: 'readonly',
        MessagePort: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        self: 'readonly',
        importScripts: 'readonly',
        CrossOriginOpenerPolicy: 'readonly',
        CrossOriginEmbedderPolicy: 'readonly',
        CrossOriginResourcePolicy: 'readonly',
        // WXT 扩展框架全局变量
        browser: 'readonly',
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        defineSidepanel: 'readonly',
        defineSandbox: 'readonly',
        createShadowRootUi: 'readonly',
        // Vitest 全局变量
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      // TypeScript 规则调整
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'warn',

      // 通用规则调整
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
);
