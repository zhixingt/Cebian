import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = path.join(REPO_ROOT, '.output', 'chrome-mv3');
const USER_DATA_DIR = path.join(__dirname, '.userdata');

/**
 * Playwright config for Cebian Web Provider E2E.
 *
 * Each spec launches a fresh persistent context with the built extension
 * loaded via `--load-extension`. The extension ID is recovered from the
 * service worker URL, so specs can navigate to `chrome-extension://<id>/...`
 * to drive the sidepanel.
 *
 * IMPORTANT:
 *   - The harness expects `pnpm build` to have produced `.output/chrome-mv3/`
 *     before `pnpm test:e2e`. The first line of every spec calls
 *     `test.skip()` if the build is missing.
 *   - `workers: 1` is required — the extension writes to Dexie (IndexedDB)
 *     and `chrome.storage.local`, both shared by the user data dir.
 *   - Items 3 and 4 require the user to log in to chatglm.cn ONCE before
 *     the spec can proceed. See the README for details.
 */
export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e/report' }],
    ['json', { outputFile: 'e2e/report/report.json' }],
  ],
  outputDir: 'e2e/test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome-extension',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          channel: 'chrome',
          args: [
            // Load ONLY our built extension (no other extensions interfere)
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            // Avoid first-run chrome UI (sign-in, default browser prompts)
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
          ],
        },
      },
    },
  ],
});
