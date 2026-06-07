import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
export const EXTENSION_PATH = path.join(REPO_ROOT, '.output', 'chrome-mv3');
const USER_DATA_DIR = path.join(REPO_ROOT, 'e2e', '.userdata');

export interface ExtensionContext {
  context: BrowserContext;
  extensionId: string;
  sidepanelUrl: string;
  serviceWorker: Worker;
  /** Optional: open the chatglm.cn tab where login / chat happens. */
  openChatglmTab: () => Promise<Page>;
}

/**
 * Skip the test if the extension build is missing. Specs should call this
 * in their first line.
 */
export function requireBuild(): void {
  if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(
      `Extension build not found at ${EXTENSION_PATH}.\n` +
      `Run \`pnpm build\` first, then re-run \`pnpm test:e2e\`.`,
    );
  }
}

/**
 * Wipe the user data dir to ensure a clean start. Tests that need to
 * preserve Dexie / chrome.storage between specs should NOT call this.
 */
export function wipeUserDataDir(): void {
  if (existsSync(USER_DATA_DIR)) {
    rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
}

/**
 * Launch a Chrome instance with the built extension loaded, and return
 * the extension's ID plus convenient helpers.
 */
export async function launchWithExtension(): Promise<ExtensionContext> {
  requireBuild();

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chrome',
    headless: false, // extensions require a headed Chrome
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Wait for the extension service worker to come up. WXT generates a SW
  // named `background.js`; Playwright exposes it via `context.serviceWorkers()`.
  const sw = await waitForServiceWorker(context);
  const extensionId = extractExtensionId(sw.url());

  if (!extensionId) {
    await context.close();
    throw new Error(`Could not determine extension ID from SW URL: ${sw.url()}`);
  }

  return {
    context,
    extensionId,
    sidepanelUrl: `chrome-extension://${extensionId}/sidepanel.html`,
    serviceWorker: sw,
    openChatglmTab: async () => {
      const page = await context.newPage();
      await page.goto('https://chatglm.cn', { waitUntil: 'domcontentloaded' });
      return page;
    },
  };
}

/**
 * Wait for at least one service worker to register. WXT extensions typically
 * have one SW at `chrome-extension://<id>/background.js`.
 *
 * The wait uses BOTH the service-workers() snapshot AND the
 * `serviceworker` event — the first worker might already be registered
 * before Playwright starts listening, or it might register after.
 */
async function waitForServiceWorker(ctx: BrowserContext): Promise<Worker> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const workers = ctx.serviceWorkers();
    if (workers.length > 0) {
      return workers[0];
    }
    // Race: either a new worker appears, or 1s elapses (then re-check snapshot)
    const newWorker = await Promise.race([
      ctx.waitForEvent('serviceworker', { timeout: 1_000 }).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 1_000)),
    ]);
    if (newWorker) return newWorker;
  }
  // One last snapshot check before throwing
  const final = ctx.serviceWorkers();
  if (final.length > 0) return final[0];
  throw new Error('Timed out waiting for extension service worker to register');
}

function extractExtensionId(swUrl: string): string | null {
  // swUrl looks like: chrome-extension://abcdefghijklmnop/background.js
  const match = swUrl.match(/^chrome-extension:\/\/([a-z]+)\//);
  return match ? match[1] : null;
}
