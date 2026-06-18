import fs from 'node:fs';
import path from 'node:path';
import { testCases, testConfig } from './config.js';
import type { TestResult } from './test-runner.js';

export function generateReport(results: TestResult[], outputDir?: string): string {
  const dir = outputDir ?? testConfig.reportDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const manual = results.filter((r) => r.status === 'manual').length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(2) : '0.00';
  const coverage = total > 0 ? (((passed + failed + skipped) / total) * 100).toFixed(2) : '0.00';

  const rows = results
    .map((r) => {
      const meta = testCases.find((tc) => tc.id === r.id);
      const statusColor =
        r.status === 'passed'
          ? 'green'
          : r.status === 'failed'
            ? 'red'
            : r.status === 'skipped'
              ? 'orange'
              : 'gray';
      const logLink = r.logPath
        ? `<a href="../${path.relative(dir, r.logPath).replace(/\\/g, '/')}" target="_blank">日志</a>`
        : '-';
      const screenshotLink = r.screenshotPath
        ? `<a href="../${path.relative(dir, r.screenshotPath).replace(/\\/g, '/')}" target="_blank">截图</a>`
        : '-';
      const errorCell = r.error ? `<pre class="error">${escapeHtml(r.error)}</pre>` : '-';
      return `
        <tr>
          <td>${r.id}</td>
          <td>${meta?.name ?? r.id}</td>
          <td>${meta?.suite ?? '-'}</td>
          <td style="color:${statusColor};font-weight:bold">${r.status.toUpperCase()}</td>
          <td>${r.duration}ms</td>
          <td>${logLink}</td>
          <td>${screenshotLink}</td>
          <td>${errorCell}</td>
        </tr>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>CebianX 自动化测试报告</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; background: #f8f9fa; color: #212529; }
    h1 { margin-bottom: 8px; }
    .meta { color: #6c757d; margin-bottom: 24px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #fff; border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; text-align: center; }
    .card .value { font-size: 28px; font-weight: 700; }
    .card .label { font-size: 12px; color: #6c757d; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e9ecef; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e9ecef; }
    th { background: #f1f3f5; font-weight: 600; font-size: 12px; color: #495057; }
    td { font-size: 14px; }
    a { color: #0d6efd; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre.error { background: #fff0f0; color: #c00; padding: 8px; border-radius: 6px; margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-width: 400px; }
    .footer { margin-top: 24px; color: #6c757d; font-size: 12px; }
  </style>
</head>
<body>
  <h1>CebianX 自动化测试报告</h1>
  <div class="meta">生成时间: ${new Date().toLocaleString('zh-CN')} | 版本: 1.3.1</div>

  <div class="cards">
    <div class="card">
      <div class="value">${total}</div>
      <div class="label">总用例</div>
    </div>
    <div class="card">
      <div class="value" style="color:green">${passed}</div>
      <div class="label">通过</div>
    </div>
    <div class="card">
      <div class="value" style="color:red">${failed}</div>
      <div class="label">失败</div>
    </div>
    <div class="card">
      <div class="value" style="color:orange">${skipped}</div>
      <div class="label">跳过</div>
    </div>
    <div class="card">
      <div class="value" style="color:gray">${manual}</div>
      <div class="label">人工</div>
    </div>
    <div class="card">
      <div class="value">${passRate}%</div>
      <div class="label">通过率</div>
    </div>
    <div class="card">
      <div class="value">${coverage}%</div>
      <div class="label">覆盖率</div>
    </div>
    <div class="card">
      <div class="value">${totalDuration}ms</div>
      <div class="label">总耗时</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>用例ID</th>
        <th>名称</th>
        <th>套件</th>
        <th>状态</th>
        <th>耗时</th>
        <th>日志</th>
        <th>截图</th>
        <th>错误</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="footer">由 CebianX 自动化测试框架生成</div>
</body>
</html>`;

  const reportPath = path.join(dir, 'index.html');
  fs.writeFileSync(reportPath, html, 'utf-8');
  return reportPath;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
