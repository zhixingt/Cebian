/**
 * 预置工作流 — 首次安装时自动初始化，提供开箱即用的示例与模板。
 *
 * 原则：
 * - 使用通用选择器（input[type="text"], button 等），适配多数站点
 * - 标注「模板」的工作流需要用户根据目标站点编辑 selector
 * - 预置工作流 ID 以 preset- 前缀固定，避免重复创建
 */

import type { Workflow } from './types';

export const PRESET_WORKFLOW_IDS = new Set([
  'preset-scroll-bottom',
  'preset-refresh-page',
  'preset-search-template',
  'preset-click-and-wait',
  'preset-form-fill-template',
  'preset-extract-title',
  'preset-load-more-loop',
  'preset-accept-cookies',
  'preset-expand-all',
  'preset-screenshot-fullpage',
  'preset-price-monitor',
  'preset-conditional-login',
  'preset-batch-extract',
  'preset-form-submit-verify',
  'preset-page-change-monitor',
  'preset-auto-checkin',
  'preset-article-collect',
  'preset-table-to-csv',
  'preset-social-interact',
  'preset-auto-compare',
]);

/** 需要用户编辑的模板类预设 ID */
export const PRESET_TEMPLATE_IDS = new Set([
  'preset-search-template',
  'preset-form-fill-template',
  'preset-conditional-login',
  'preset-form-submit-verify',
]);

export function getPresetWorkflows(): Workflow[] {
  const now = Date.now();

  return [
    {
      id: 'preset-scroll-bottom',
      name: '示例：滚动页面到底部',
      description: '向下滚动页面 3 次，每次 800 像素。适用于加载更多内容的页面。',
      steps: [
        { type: 'scroll', deltaY: 800 },
        { type: 'wait', timeout: 500 },
        { type: 'scroll', deltaY: 800 },
        { type: 'wait', timeout: 500 },
        { type: 'scroll', deltaY: 800 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-refresh-page',
      name: '示例：刷新当前页面',
      description: '按 F5 刷新页面，然后等待 2 秒让内容加载完成。',
      steps: [
        { type: 'keypress', key: 'F5' },
        { type: 'wait', timeout: 2000 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-search-template',
      name: '模板：自动搜索（需编辑）',
      description: '聚焦搜索框 → 输入关键词 → 按 Enter 提交。请先将 selector 修改为目标站点的搜索框。',
      steps: [
        { type: 'focus', selector: 'input[type="search"], input[name="q"], #search' },
        { type: 'type', selector: 'input[type="search"], input[name="q"], #search', text: '{{keyword}}', clear: true },
        { type: 'keypress', selector: 'input[type="search"], input[name="q"], #search', key: 'Enter' },
      ],
      trigger: { type: 'manual' },
      variables: { keyword: 'CebianX' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-click-and-wait',
      name: '示例：点击链接并等待加载',
      description: '点击页面上第一个 a 标签，然后等待页面导航完成。',
      steps: [
        { type: 'click', selector: 'a[href]' },
        { type: 'wait_navigation', timeout: 5000 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-form-fill-template',
      name: '模板：自动填写表单（需编辑）',
      description: '在文本框输入内容后点击提交按钮。请根据目标表单修改 selector 和 text。',
      steps: [
        { type: 'focus', selector: 'input[type="text"]' },
        { type: 'type', selector: 'input[type="text"]', text: '{{username}}', clear: true },
        { type: 'click', selector: 'button[type="submit"], input[type="submit"], button:contains("提交")' },
      ],
      trigger: { type: 'manual' },
      variables: { username: 'admin' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-extract-title',
      name: '示例：提取页面标题和描述',
      description: '抓取当前页面的标题（title）和 meta description，演示数据提取能力。',
      steps: [
        { type: 'extract', selector: 'title', toVariable: 'pageTitle', attribute: 'textContent' },
        { type: 'extract', selector: 'meta[name="description"]', toVariable: 'pageDesc', attribute: 'content' },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-load-more-loop',
      name: '示例：循环点击“加载更多”',
      description: '连续点击 5 次“加载更多”按钮，每次等待 1 秒。请将 selector 修改为目标按钮。',
      steps: [
        { type: 'click', selector: 'button:contains("加载更多"), .load-more, [data-testid="load-more"]' },
        { type: 'wait', timeout: 1000 },
        { type: 'click', selector: 'button:contains("加载更多"), .load-more, [data-testid="load-more"]' },
        { type: 'wait', timeout: 1000 },
        { type: 'click', selector: 'button:contains("加载更多"), .load-more, [data-testid="load-more"]' },
        { type: 'wait', timeout: 1000 },
        { type: 'click', selector: 'button:contains("加载更多"), .load-more, [data-testid="load-more"]' },
        { type: 'wait', timeout: 1000 },
        { type: 'click', selector: 'button:contains("加载更多"), .load-more, [data-testid="load-more"]' },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-accept-cookies',
      name: '示例：自动同意 Cookie 横幅',
      description: '点击常见的“同意全部”、“接受”或“同意”Cookie 按钮。',
      steps: [
        { type: 'click', selector: 'button:contains("同意全部"), button:contains("接受"), button:contains("同意"), #onetrust-accept-btn-handler, .fc-cta-consent', timeout: 2000 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-expand-all',
      name: '示例：展开所有折叠内容',
      description: '点击页面上所有“展开”、“查看更多”或带 + 号的按钮。',
      steps: [
        { type: 'click', selector: 'button:contains("展开"), button:contains("查看更多"), button:contains("+"), [aria-expanded="false"]', timeout: 500 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-screenshot-fullpage',
      name: '示例：滚动并截图整页',
      description: '滚动到页面底部（分 3 次）以便加载全部内容，然后等待 1 秒。',
      steps: [
        { type: 'scroll', deltaY: 3000 },
        { type: 'wait', timeout: 800 },
        { type: 'scroll', deltaY: 3000 },
        { type: 'wait', timeout: 800 },
        { type: 'scroll', deltaY: 3000 },
        { type: 'wait', timeout: 1000 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-price-monitor',
      name: '示例：智能价格监控（含断言）',
      description: '提取商品价格并断言价格有效，演示 extract + assert 的组合使用。请将 selector 修改为目标站点的价格元素。',
      steps: [
        { type: 'extract', selector: '.price, [class*="price"], .amount, .ProductPrice', toVariable: 'priceText', attribute: 'textContent' },
        { type: 'assert', variable: 'priceText', operator: 'contains', value: '¥', timeout: 3000 },
        { type: 'extract', selector: 'h1, .product-title, [class*="title"]', toVariable: 'productName', attribute: 'textContent' },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-conditional-login',
      name: '模板：条件登录流程（含If分支）',
      description: '检测登录按钮是否存在，若未登录则自动填写账号密码并提交。请将 selector 修改为目标站点的登录表单。',
      steps: [
        { type: 'assert', selector: 'input[type="password"], #password, .login-form', operator: 'exists', timeout: 2000 },
        {
          type: 'if',
          condition: { variable: 'needLogin', operator: 'eq', value: 'true' },
          thenSteps: [
            { type: 'type', selector: 'input[name="username"], input[type="email"], #username', text: '{{username}}', clear: true },
            { type: 'type', selector: 'input[type="password"], #password', text: '{{password}}', clear: true },
            { type: 'click', selector: 'button[type="submit"], .login-btn, button:contains("登录")' },
            { type: 'wait_navigation', timeout: 5000 },
          ],
          elseSteps: [
            { type: 'wait', timeout: 500 },
          ],
        },
      ],
      trigger: { type: 'manual' },
      variables: { username: 'your-username', password: 'your-password', needLogin: 'true' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-batch-extract',
      name: '示例：批量数据抓取（多字段）',
      description: '同时提取页面中的标题、价格和评分信息。演示多字段 extract 的数据抓取能力。',
      steps: [
        { type: 'extract', selector: 'h1, .title, [class*="title"]', toVariable: 'title', attribute: 'textContent' },
        { type: 'extract', selector: '.price, [class*="price"]', toVariable: 'price', attribute: 'textContent' },
        { type: 'extract', selector: '.rating, [class*="rating"], .score, [class*="score"]', toVariable: 'rating', attribute: 'textContent' },
        { type: 'extract', selector: 'meta[name="keywords"]', toVariable: 'keywords', attribute: 'content' },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-form-submit-verify',
      name: '示例：智能表单提交与验证',
      description: '填写表单并提交，然后断言成功提示出现。演示 type + click + assert 的完整业务流程。',
      steps: [
        { type: 'focus', selector: 'input[type="text"], textarea, .form-input' },
        { type: 'type', selector: 'input[type="text"], textarea, .form-input', text: '{{feedback}}', clear: true },
        { type: 'click', selector: 'button[type="submit"], .submit-btn, button:contains("提交")' },
        { type: 'wait', timeout: 1500 },
        { type: 'assert', selector: '.success, .toast, .message-success, [class*="success"]', operator: 'exists', timeout: 5000 },
      ],
      trigger: { type: 'manual' },
      variables: { feedback: 'This is a test feedback' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-page-change-monitor',
      name: '示例：页面变化监控与通知',
      description: '等待目标元素出现，提取其内容并断言包含预期关键词。适合配合 DOM 触发器实现页面变化监控。',
      steps: [
        { type: 'wait', selector: '.notification, .alert, .update-badge, [class*="new"]', timeout: 10000 },
        { type: 'extract', selector: '.notification, .alert, .update-badge, [class*="new"]', toVariable: 'noticeText', attribute: 'textContent' },
        { type: 'assert', variable: 'noticeText', operator: 'contains', value: '{{keyword}}', timeout: 3000 },
      ],
      trigger: { type: 'manual' },
      variables: { keyword: '更新' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-auto-checkin',
      name: '示例：自动签到打卡',
      description: '点击页面上的签到/打卡按钮，然后等待并断言成功提示出现。适合每日自动签到场景。',
      steps: [
        { type: 'click', selector: 'button:contains("签到"), button:contains("打卡"), .checkin-btn, [data-testid="checkin"]', timeout: 2000 },
        { type: 'wait', timeout: 1500 },
        { type: 'assert', selector: '.success, .toast, .checkin-success, [class*="success"]', operator: 'exists', timeout: 5000 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-article-collect',
      name: '示例：文章采集并导出',
      description: '提取文章标题、正文和发布时间，并将结果导出到剪贴板。适合内容采集和知识库归档。',
      steps: [
        { type: 'extract', selector: 'h1, .article-title, [class*="title"]', toVariable: 'title', attribute: 'textContent' },
        { type: 'extract', selector: 'article, .article-content, .post-content, [class*="content"]', toVariable: 'content', attribute: 'textContent' },
        { type: 'extract', selector: 'time, .publish-time, [class*="date"]', toVariable: 'publishTime', attribute: 'textContent' },
        { type: 'export', destination: 'clipboard', variables: ['title', 'content', 'publishTime'] },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-table-to-csv',
      name: '示例：表格数据提取导出 CSV',
      description: '抓取页面上的表格数据并导出为 CSV 文件。适合商品列表、排行榜等表格型数据。',
      steps: [
        { type: 'extract', selector: 'table, .data-table, [class*="table"]', toVariable: 'tableHtml', attribute: 'outerHTML' },
        { type: 'export', destination: 'csv', variables: ['tableHtml'], filename: 'table-data-{{today}}.csv' },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-social-interact',
      name: '示例：社交互动（点赞/关注）',
      description: '点击点赞按钮和关注按钮。请将 selector 修改为目标社交平台。',
      steps: [
        { type: 'click', selector: 'button:contains("赞"), .like-btn, [aria-label*="赞"], [aria-label*="Like"]', timeout: 1000 },
        { type: 'wait', timeout: 800 },
        { type: 'click', selector: 'button:contains("关注"), .follow-btn, [aria-label*="关注"], [aria-label*="Follow"]', timeout: 1000 },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
    {
      id: 'preset-auto-compare',
      name: '示例：自动比价（多字段提取）',
      description: '同时提取商品名称、当前价格、原价和折扣信息，适合价格对比和竞品监控。',
      steps: [
        { type: 'extract', selector: 'h1, .product-name, [class*="name"]', toVariable: 'productName', attribute: 'textContent' },
        { type: 'extract', selector: '.current-price, .sale-price, [class*="sale"]', toVariable: 'currentPrice', attribute: 'textContent' },
        { type: 'extract', selector: '.original-price, [class*="original"]', toVariable: 'originalPrice', attribute: 'textContent' },
        { type: 'extract', selector: '.discount, [class*="discount"]', toVariable: 'discount', attribute: 'textContent' },
        { type: 'export', destination: 'json', variables: ['productName', 'currentPrice', 'originalPrice', 'discount'], filename: 'price-compare-{{today}}.json' },
      ],
      trigger: { type: 'manual' },
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    },
  ];
}

/**
 * 检查并插入缺失的预置工作流。
 * 幂等：已存在的预置工作流不会被覆盖（保留用户可能的修改）。
 */
export async function ensurePresetWorkflows(
  addWorkflow: (wf: Workflow) => Promise<void>,
  hasWorkflow: (id: string) => Promise<boolean>,
): Promise<void> {
  const presets = getPresetWorkflows();
  for (const wf of presets) {
    const exists = await hasWorkflow(wf.id);
    if (!exists) {
      await addWorkflow(wf);
    }
  }
}
