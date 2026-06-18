import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { testCases, testConfig } from './config.js';
import type { TestCaseMeta, TestContext, TestCaseFn } from './config.js';

export interface TestResult {
  id: string;
  status: 'passed' | 'failed' | 'skipped' | 'manual';
  duration: number;
  error?: string;
  screenshotPath?: string | null;
  logPath: string;
}

export interface RunState {
  version: number;
  lastRunAt: string;
  results: Record<string, TestResult>;
}

export interface RunnerOptions {
  resume?: boolean;
  onlySuite?: string;
  onlyAuto?: boolean;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadState(): RunState {
  if (fs.existsSync(testConfig.stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(testConfig.stateFile, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  return { version: 1, lastRunAt: '', results: {} };
}

function saveState(state: RunState) {
  ensureDir(path.dirname(testConfig.stateFile));
  fs.writeFileSync(testConfig.stateFile, JSON.stringify(state, null, 2));
}

function createLogger(logPath: string) {
  ensureDir(path.dirname(logPath));
  const lines: string[] = [];
  return {
    log: (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      lines.push(line);
      // eslint-disable-next-line no-console
      console.log(line);
    },
    write: () => {
      fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');
    },
  };
}

export async function runTests(
  registry: Record<string, TestCaseFn>,
  options: RunnerOptions = {}
): Promise<TestResult[]> {
  const state = loadState();
  const results: TestResult[] = [];

  ensureDir(testConfig.screenshotDir);
  ensureDir(testConfig.logDir);
  ensureDir(testConfig.reportDir);

  // Launch browser once for all tests
  const extensionPath = path.resolve(testConfig.extensionPath);
  if (!fs.existsSync(extensionPath)) {
    throw new Error(
      `Extension build not found at ${extensionPath}. Run \`pnpm build\` first.`
    );
  }

  const context = await chromium.launchPersistentContext(testConfig.userDataDir, {
    channel: 'chrome',
    headless: false,
    viewport: testConfig.viewport,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
    ],
  });

  // Recover extension ID from service worker
  const extensionId = await waitForExtensionId(context);
  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;

  // Open sidepanel page once and reuse for tests that need it
  const sidepanelPage = await context.newPage();
  await sidepanelPage.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });

  const orderedCases = testCases.filter((tc) => {
    if (options.onlySuite && tc.suite !== options.onlySuite) return false;
    if (options.onlyAuto && tc.auto === 'manual') return false;
    return true;
  });

  for (const tc of orderedCases) {
    const runKey = tc.id;

    // Resume mode: skip passed tests from previous run
    if (options.resume && state.results[runKey]?.status === 'passed') {
      results.push(state.results[runKey]);
      continue;
    }

    // Manual tests are always skipped in automation runner
    if (tc.auto === 'manual') {
      const result: TestResult = {
        id: tc.id,
        status: 'manual',
        duration: 0,
        logPath: '',
      };
      results.push(result);
      state.results[runKey] = result;
      continue;
    }

    const logPath = path.join(testConfig.logDir, `${tc.id}.log`);
    const logger = createLogger(logPath);
    logger.log(`=== 开始执行: ${tc.id} - ${tc.name} ===`);

    const screenshotName = `${tc.id}-${Date.now()}.png`;
    const screenshotPath = path.join(testConfig.screenshotDir, screenshotName);

    const start = Date.now();
    let status: TestResult['status'] = 'failed';
    let error: string | undefined;

    const fn = registry[tc.id];
    if (!fn) {
      error = `未找到测试函数: ${tc.id}`;
      logger.log(`SKIP: ${error}`);
      status = 'skipped';
    } else {
      try {
        const ctx: TestContext = {
          page: sidepanelPage,
          context,
          extensionId,
          sidepanelUrl,
          log: logger.log,
          screenshot: async (name) => {
            const sp = path.join(testConfig.screenshotDir, `${tc.id}-${name}-${Date.now()}.png`);
            try {
              await sidepanelPage.screenshot({ path: sp, fullPage: false });
              return sp;
            } catch {
              return null;
            }
          },
        };

        await runWithTimeout(fn, ctx, testConfig.timeout);
        status = 'passed';
        logger.log('=== 通过 ===');
      } catch (e) {
        status = 'failed';
        error = e instanceof Error ? e.message : String(e);
        logger.log(`=== 失败: ${error} ===`);

        // Auto screenshot on failure
        try {
          await sidepanelPage.screenshot({ path: screenshotPath, fullPage: false });
          logger.log(`已保存失败截图: ${screenshotPath}`);
        } catch (screenshotErr) {
          logger.log(`截图失败: ${screenshotErr}`);
        }
      }
    }

    logger.write();

    const result: TestResult = {
      id: tc.id,
      status,
      duration: Date.now() - start,
      error,
      screenshotPath: status === 'failed' ? screenshotPath : null,
      logPath,
    };

    results.push(result);
    state.results[runKey] = result;
    saveState(state);

    // Retry once on failure if configured
    if (status === 'failed' && testConfig.retries > 0) {
      logger.log('--- 开始重试 ---');
      const retryStart = Date.now();
      try {
        const ctx: TestContext = {
          page: sidepanelPage,
          context,
          extensionId,
          sidepanelUrl,
          log: logger.log,
          screenshot: async (name) => {
            const sp = path.join(testConfig.screenshotDir, `${tc.id}-retry-${name}-${Date.now()}.png`);
            try {
              await sidepanelPage.screenshot({ path: sp, fullPage: false });
              return sp;
            } catch {
              return null;
            }
          },
        };
        await runWithTimeout(fn, ctx, testConfig.timeout);
        result.status = 'passed';
        result.duration = Date.now() - retryStart;
        result.error = undefined;
        result.screenshotPath = null;
        logger.log('=== 重试通过 ===');
      } catch (e) {
        result.error = `重试失败: ${e instanceof Error ? e.message : String(e)}`;
        logger.log(`=== 重试失败: ${result.error} ===`);
      }
      logger.write();
      saveState(state);
    }
  }

  await sidepanelPage.close();
  await context.close();
  state.lastRunAt = new Date().toISOString();
  saveState(state);

  return results;
}

async function runWithTimeout(
  fn: TestCaseFn,
  ctx: TestContext,
  timeout: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`测试超时 (${timeout}ms)`));
    }, timeout);

    fn(ctx)
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function waitForExtensionId(context: BrowserContext): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      const url = workers[0].url();
      const match = url.match(/^chrome-extension:\/\/([a-z]+)\//);
      if (match) return match[1];
    }
    const newWorker = await Promise.race([
      context.waitForEvent('serviceworker', { timeout: 1_000 }).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 1_000)),
    ]);
    if (newWorker) {
      const url = newWorker.url();
      const match = url.match(/^chrome-extension:\/\/([a-z]+)\//);
      if (match) return match[1];
    }
  }
  const final = context.serviceWorkers();
  if (final.length > 0) {
    const url = final[0].url();
    const match = url.match(/^chrome-extension:\/\/([a-z]+)\//);
    if (match) return match[1];
  }
  throw new Error('无法从 Service Worker URL 获取扩展 ID');
}
