import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', '.run-state.json');
const REPORT_DIR = path.join(__dirname, '..', 'report');

export interface RunState {
  version: string;
  startedAt: string;
  completed: string[];
  failed: { id: string; error: string; screenshot?: string }[];
  skipped: string[];
  currentSuite: string | null;
}

function ensureReportDir(): void {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
}

export function loadState(): RunState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      /* corrupted, start fresh */
    }
  }
  return {
    version: '1.3.1',
    startedAt: new Date().toISOString(),
    completed: [],
    failed: [],
    skipped: [],
    currentSuite: null,
  };
}

export function saveState(state: RunState): void {
  ensureReportDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function shouldSkip(testId: string, resume: boolean): boolean {
  if (!resume) return false;
  const state = loadState();
  return state.completed.includes(testId) || state.failed.some(f => f.id === testId);
}

export function markCompleted(testId: string): void {
  const state = loadState();
  if (!state.completed.includes(testId)) {
    state.completed.push(testId);
  }
  // Remove from failed if it was previously failed and now passes (retry)
  state.failed = state.failed.filter(f => f.id !== testId);
  saveState(state);
}

export function markFailed(testId: string, error: string, screenshot?: string): void {
  const state = loadState();
  const existing = state.failed.find(f => f.id === testId);
  if (existing) {
    existing.error = error;
    existing.screenshot = screenshot;
  } else {
    state.failed.push({ id: testId, error, screenshot });
  }
  saveState(state);
}

export function markSkipped(testId: string): void {
  const state = loadState();
  if (!state.skipped.includes(testId)) state.skipped.push(testId);
  saveState(state);
}

export function resetState(): void {
  if (existsSync(STATE_FILE)) {
    const state: RunState = {
      version: '1.3.1',
      startedAt: new Date().toISOString(),
      completed: [],
      failed: [],
      skipped: [],
      currentSuite: null,
    };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  }
}

export function generateSummary(): void {
  const state = loadState();
  const total = 135;
  const passed = state.completed.length;
  const failed = state.failed.length;
  const skipped = state.skipped.length;
  const pending = total - passed - failed - skipped;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

  const summary = {
    total,
    passed,
    failed,
    skipped,
    pending,
    passRate: `${passRate}%`,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    failedDetails: state.failed,
  };

  ensureReportDir();
  writeFileSync(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  // Generate HTML report
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>CebianX E2E 测试报告</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;line-height:1.6}
h1{color:#1a1a1a;border-bottom:2px solid #2563eb;padding-bottom:10px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin:24px 0}
.stat-card{padding:16px;border-radius:8px;text-align:center}
.pass{background:#dcfce7;color:#166534}
.fail{background:#fee2e2;color:#991b1b}
.skip{background:#fef9c3;color:#854d0e}
.pending{background:#f3f4f6;color:#374151}
.total{background:#eff6ff;color:#1e40af}
table{width:100%;border-collapse:collapse;margin-top:20px;font-size:14px}
th,td{padding:10px 12px;border:1px solid #e5e7eb;text-align:left}
th{background:#f9fafb;font-weight:600}
.fail-row{background:#fee2e2}
.skip-row{background:#fef9c3}
.pass-row{background:#dcfce7}
.screenshot{max-width:200px;border:1px solid #ccc;border-radius:4px;margin-top:4px}
</style>
</head>
<body>
<h1>CebianX E2E 测试报告</h1>
<p>版本: 1.3.1 | 开始时间: ${state.startedAt} | 结束时间: ${summary.finishedAt}</p>
<div class="stats">
  <div class="stat-card total"><div style="font-size:28px;font-weight:700">${total}</div><div>总用例</div></div>
  <div class="stat-card pass"><div style="font-size:28px;font-weight:700">${passed}</div><div>通过</div></div>
  <div class="stat-card fail"><div style="font-size:28px;font-weight:700">${failed}</div><div>失败</div></div>
  <div class="stat-card skip"><div style="font-size:28px;font-weight:700">${skipped}</div><div>跳过</div></div>
  <div class="stat-card pending"><div style="font-size:28px;font-weight:700">${pending}</div><div>待执行</div></div>
</div>
<p><strong>通过率: ${passRate}%</strong></p>

<h2>失败用例详情</h2>
<table>
<tr><th>用例ID</th><th>错误信息</th><th>截图</th></tr>
${state.failed.map(f => `<tr class="fail-row"><td>${f.id}</td><td>${f.error}</td><td>${f.screenshot ? `<img class="screenshot" src="${f.screenshot}" alt="screenshot">` : '无'}</td></tr>`).join('')}
${state.failed.length === 0 ? '<tr><td colspan="3" style="text-align:center">无失败用例</td></tr>' : ''}
</table>

<h2>跳过用例</h2>
<table>
<tr><th>用例ID</th><th>原因</th></tr>
${state.skipped.map(id => `<tr class="skip-row"><td>${id}</td><td>需人工验证或条件不满足</td></tr>`).join('')}
${state.skipped.length === 0 ? '<tr><td colspan="2" style="text-align:center">无跳过用例</td></tr>' : ''}
</table>
</body>
</html>`;

  writeFileSync(path.join(REPORT_DIR, 'index.html'), html, 'utf8');
}
