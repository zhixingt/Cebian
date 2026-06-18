#!/usr/bin/env node
/**
 * CebianX E2E 全量自动化测试 Runner
 *
 * 功能:
 *   1. 自动构建扩展（如需要）
 *   2. 支持断点续跑（RESUME=true 或 --resume）
 *   3. 自动记录执行状态到 e2e/.run-state.json
 *   4. 失败自动截图（Playwright 内置）
 *   5. 生成 HTML + JSON 测试报告
 *   6. 支持按模块过滤执行
 *
 * 用法:
 *   node scripts/run-e2e-suite.mjs              # 全新执行
 *   node scripts/run-e2e-suite.mjs --resume     # 断点续跑
 *   node scripts/run-e2e-suite.mjs --module skill   # 仅执行 BrowserWing Skill 模块
 *   node scripts/run-e2e-suite.mjs --list       # 列出所有可执行的用例
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = path.join(REPO_ROOT, '.output', 'chrome-mv3');
const STATE_FILE = path.join(REPO_ROOT, 'e2e', '.run-state.json');

const args = process.argv.slice(2);
const isResume = args.includes('--resume') || process.env.RESUME === 'true';
const isList = args.includes('--list');
const moduleFilter = args.find((a) => a.startsWith('--module='))?.replace('--module=', '');

function log(...msgs) {
  console.log('[E2E Runner]', ...msgs);
}

async function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: REPO_ROOT,
      shell: process.platform === 'win32',
      ...options,
    });
    child.on('close', (code) => {
      if (code === 0) resolve(code);
      else reject(new Error(`Command failed with exit code ${code}`));
    });
    child.on('error', reject);
  });
}

async function buildExtension() {
  if (existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    log('Extension build found, skipping build...');
    return;
  }
  log('Extension build not found, running pnpm build...');
  await runCommand('pnpm', ['build']);
}

async function runTests() {
  const pwArgs = ['test', '--config', 'e2e/playwright.config.ts'];

  if (isList) {
    pwArgs.push('--list');
  } else {
    // Filter by module if specified
    if (moduleFilter) {
      const specPattern = `e2e/specs/*${moduleFilter}*.spec.ts`;
      pwArgs.push(specPattern);
    } else {
      // Only run auto-generated specs (10-18)
      pwArgs.push('e2e/specs/10-auto-*.spec.ts');
    }

    // Resume mode: state check is handled inside test files via checkSkip()
    if (isResume) {
      log('Resume mode enabled — skipping previously completed/failed tests');
    }
  }

  const env = { ...process.env };
  if (isResume) env.RESUME = 'true';

  try {
    await runCommand('npx', ['playwright', ...pwArgs], { env });
    log('All tests completed.');
  } catch (err) {
    log('Some tests failed. Check report for details.');
    // Don't throw — we want to generate report even on failure
  }
}

async function generateReport() {
  log('Generating summary report...');
  try {
    // Import the generateSummary function dynamically
    const { generateSummary } = await import(path.join(REPO_ROOT, 'e2e', 'helpers', 'state.ts'));
    generateSummary();
    log('Report generated at e2e/report/index.html');
  } catch (err) {
    log('Failed to generate report:', err.message);
  }
}

async function main() {
  log('CebianX E2E Full Automation Suite');
  log('==================================');
  log(`Mode: ${isResume ? 'RESUME' : 'FULL'} | Module: ${moduleFilter || 'ALL'}`);

  if (isList) {
    await runTests();
    return;
  }

  if (!isResume) {
    // Fresh run: reset state
    try {
      const { resetState } = await import(path.join(REPO_ROOT, 'e2e', 'helpers', 'state.ts'));
      resetState();
      log('State reset for fresh run.');
    } catch {
      /* ignore */
    }
  } else {
    log(`Resuming from state file: ${STATE_FILE}`);
  }

  await buildExtension();
  await runTests();
  await generateReport();

  log('Done. Open e2e/report/index.html to view results.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
