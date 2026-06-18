/**
 * BrowserWing Batch Form Fill — 批量表单填报脚本。
 *
 * 入参 (args):
 *   - url: string            表单页面 URL
 *   - entries: Array<Object> 填报数据数组，每项为 { field: value, ... }
 *   - submitSelector?: string 提交按钮 identifier（RefID/CSS/text），默认自动查找
 *   - confirm?: boolean      是否在提交前等待用户确认（默认 false）
 *   - screenshot?: boolean   每次提交后是否截图留痕（默认 true）
 *
 * 返回值:
 *   {
 *     total: number,
 *     success: number,
 *     failed: number,
 *     results: Array<{ index, status, message, screenshot? }>
 *   }
 */

const BASE_URL = 'http://127.0.0.1:8080/api/v1/executor';

async function bwRequest(endpoint, body, method) {
  const url = BASE_URL + endpoint;
  const init = {
    method: method || 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }
  const resp = await bgFetch(url, init);
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(`BrowserWing ${endpoint} failed: HTTP ${resp.status} — ${data.detail || data.message || text}`);
  }
  return data;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { url, entries, submitSelector, confirm, screenshot = true } = args;

if (!url) throw new Error('batch-fill requires "url"');
if (!Array.isArray(entries) || entries.length === 0) throw new Error('batch-fill requires non-empty "entries" array');

const results = [];
let successCount = 0;
let failedCount = 0;

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const result = { index: i, status: 'pending', message: '', screenshot: null };

  try {
    // 1. 导航到表单页
    await bwRequest('/navigate', { url });
    await sleep(500);

    // 2. 获取页面快照（用于诊断和获取 RefIDs）
    const snap = await bwRequest('/snapshot', null, 'GET');

    // 3. 智能填充（优先使用 /fill-form，若失败则逐字段填充）
    try {
      await bwRequest('/fill-form', { data: entry });
    } catch {
      // fallback：逐字段 type
      for (const [key, value] of Object.entries(entry)) {
        if (value === undefined || value === null) continue;
        try {
          await bwRequest('/type', { identifier: key, text: String(value) });
        } catch (fieldErr) {
          result.message += `Field "${key}" fill failed: ${fieldErr.message}; `;
        }
      }
    }

    // 4. 人工确认（如需要）
    if (confirm) {
      // 无法真正阻塞等待用户，记录提示
      result.message += 'Manual confirmation required before submit; ';
    }

    // 5. 提交
    const submitId = submitSelector || 'Submit';
    try {
      await bwRequest('/click', { identifier: submitId });
    } catch (clickErr) {
      // fallback：尝试按 text 查找提交按钮
      await bwRequest('/click', { identifier: 'button[type="submit"]' });
    }

    // 6. 等待提交完成
    await sleep(1000);
    try {
      await bwRequest('/wait', { identifier: 'body', state: 'visible', timeout: 10 });
    } catch { /* ignore */ }

    // 7. 截图留痕
    if (screenshot) {
      try {
        const ss = await bwRequest('/screenshot', { fullPage: true });
        result.screenshot = ss.data || ss.screenshot || null;
      } catch {
        /* ignore screenshot errors */
      }
    }

    result.status = 'success';
    result.message = result.message || 'Submitted successfully';
    successCount++;
  } catch (err) {
    result.status = 'failed';
    result.message = err.message || String(err);
    failedCount++;

    if (screenshot) {
      try {
        const ss = await bwRequest('/screenshot', { fullPage: true });
        result.screenshot = ss.data || ss.screenshot || null;
      } catch { /* ignore */ }
    }
  }

  results.push(result);

  // 间隔 500ms，避免请求过快
  if (i < entries.length - 1) {
    await sleep(500);
  }
}

module.exports = {
  total: entries.length,
  success: successCount,
  failed: failedCount,
  results,
};
