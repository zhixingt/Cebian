/**
 * Trigger Manager — 工作流触发器的注册、匹配与执行。
 *
 * 当前支持：
 * - manual: 用户手动点击运行
 * - url: chrome.tabs.onUpdated URL 正则匹配
 * - cron: chrome.alarms 定时触发
 * - dom: Content Script MutationObserver 元素出现触发
 *
 * 注意：MV3 Service Worker 可能被终止，监听器在 SW 重启时自动重建。
 */

import type { Workflow } from './types';
import { listWorkflows } from './repository';
import { startWorkflowRun } from './engine';
import { getNextCronTime, isValidCron } from './cron-parser';

// ─── 状态 ───

let urlTriggerInstalled = false;
let cronTriggerInstalled = false;
let domTriggerInstalled = false;
let activeUrlPatterns = new Map<string, { pattern: RegExp; workflowId: string }>();
let activeDomSelectors = new Map<string, { selector: string; workflowId: string }>();
const ALARM_PREFIX = 'cebian-cron-';

// ─── URL 触发器 ───

/**
 * 安装 chrome.tabs.onUpdated 监听器。
 * 幂等：多次调用不会重复注册。
 */
export function installUrlTriggerListener(): void {
  if (urlTriggerInstalled) return;
  urlTriggerInstalled = true;

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    // 懒加载匹配表（避免启动时全量查询）
    if (activeUrlPatterns.size === 0) {
      await reloadUrlPatterns();
    }

    for (const { pattern, workflowId } of activeUrlPatterns.values()) {
      if (pattern.test(tab.url)) {
        console.log('[TriggerManager] URL match', tab.url, '→', workflowId);
        await runWorkflowById(workflowId, tabId);
        // 一个 URL 只匹配第一个工作流
        break;
      }
    }
  });
}

/**
 * 从数据库重新加载所有 URL 触发器模式。
 */
export async function reloadUrlPatterns(): Promise<void> {
  activeUrlPatterns.clear();
  try {
    const workflows = await listWorkflows();
    for (const wf of workflows) {
      if (wf.trigger?.type === 'url') {
        const config = wf.trigger.config as { pattern: string } | undefined;
        if (config?.pattern) {
          try {
            activeUrlPatterns.set(wf.id, {
              pattern: new RegExp(config.pattern),
              workflowId: wf.id,
            });
          } catch {
            console.warn('[TriggerManager] Invalid URL pattern for workflow', wf.id, config.pattern);
          }
        }
      }
    }
  } catch (err) {
    console.error('[TriggerManager] Failed to reload URL patterns', err);
  }
}

/**
 * 在保存/更新工作流后，刷新对应触发器。
 */
export async function refreshWorkflowTrigger(workflow: Workflow): Promise<void> {
  activeUrlPatterns.delete(workflow.id);
  activeDomSelectors.delete(workflow.id);
  await clearCronAlarm(workflow.id);
  if (workflow.trigger?.type === 'url') {
    const config = workflow.trigger.config as { pattern: string } | undefined;
    if (config?.pattern) {
      try {
        activeUrlPatterns.set(workflow.id, {
          pattern: new RegExp(config.pattern),
          workflowId: workflow.id,
        });
      } catch {
        console.warn('[TriggerManager] Invalid URL pattern', config.pattern);
      }
    }
  }
  if (workflow.trigger?.type === 'cron') {
    const config = workflow.trigger.config as { expression: string } | undefined;
    if (config?.expression && isValidCron(config.expression)) {
      await scheduleCronAlarm(workflow.id, config.expression);
    }
  }
  if (workflow.trigger?.type === 'dom') {
    const config = workflow.trigger.config as { selector: string } | undefined;
    if (config?.selector) {
      activeDomSelectors.set(workflow.id, {
        selector: config.selector,
        workflowId: workflow.id,
      });
    }
  }
  // Notify content scripts that DOM triggers may have changed
  if (workflow.trigger?.type === 'dom' || workflow.trigger === undefined) {
    void broadcastDomTriggersUpdated();
  }
}

// ─── Cron 触发器 ───

function alarmName(workflowId: string): string {
  return `${ALARM_PREFIX}${workflowId}`;
}

async function clearCronAlarm(workflowId: string): Promise<void> {
  try {
    await chrome.alarms.clear(alarmName(workflowId));
  } catch {
    /* ignore */
  }
}

async function scheduleCronAlarm(workflowId: string, expression: string): Promise<void> {
  const next = getNextCronTime(expression);
  if (!next) {
    console.warn('[TriggerManager] Invalid cron expression', expression);
    return;
  }
  const delayMinutes = Math.max(1, Math.ceil((next.getTime() - Date.now()) / 60000));
  await chrome.alarms.create(alarmName(workflowId), { delayInMinutes: delayMinutes });
  console.log('[TriggerManager] Scheduled cron', workflowId, 'at', next.toISOString(), '(in', delayMinutes, 'min)');
}

/**
 * 安装 chrome.alarms.onAlarm 监听器。
 */
export function installCronTriggerListener(): void {
  if (cronTriggerInstalled) return;
  cronTriggerInstalled = true;

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    const workflowId = alarm.name.slice(ALARM_PREFIX.length);
    console.log('[TriggerManager] Cron alarm fired', workflowId);
    await runWorkflowById(workflowId);

    // 重新调度下一次触发
    try {
      const { getWorkflow } = await import('./repository');
      const wf = await getWorkflow(workflowId);
      if (wf?.trigger?.type === 'cron') {
        const config = wf.trigger.config as { expression: string } | undefined;
        if (config?.expression) {
          await scheduleCronAlarm(workflowId, config.expression);
        }
      }
    } catch (err) {
      console.error('[TriggerManager] Failed to reschedule cron', workflowId, err);
    }
  });
}

/**
 * 从数据库重新加载所有 Cron 触发器。
 */
export async function reloadCronAlarms(): Promise<void> {
  // 清除所有已有的 cron alarm
  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(ALARM_PREFIX)) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  try {
    const workflows = await listWorkflows();
    for (const wf of workflows) {
      if (wf.trigger?.type === 'cron') {
        const config = wf.trigger.config as { expression: string } | undefined;
        if (config?.expression && isValidCron(config.expression)) {
          await scheduleCronAlarm(wf.id, config.expression);
        }
      }
    }
  } catch (err) {
    console.error('[TriggerManager] Failed to reload cron alarms', err);
  }
}

// ─── DOM 触发器 ───

/**
 * 安装 chrome.runtime.onMessage 监听器以处理 DOM 触发器相关消息。
 * 幂等：多次调用不会重复注册。
 */
export function installDomTriggerListener(): void {
  if (domTriggerInstalled) return;
  domTriggerInstalled = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (typeof msg !== 'object' || msg === null) return false;

    // get_dom_triggers — content script queries active selectors
    if ((msg as { type?: string }).type === 'get_dom_triggers') {
      void (async () => {
        // Lazy-load if empty (SW restart)
        if (activeDomSelectors.size === 0) {
          await reloadDomTriggers();
        }
        const triggers = Array.from(activeDomSelectors.values());
        sendResponse({ triggers });
      })();
      return true; // async response
    }

    // dom_trigger_fired — content script reports element appearance
    if ((msg as { type?: string }).type === 'dom_trigger_fired') {
      const { workflowId, selector, url } = msg as {
        workflowId: string;
        selector: string;
        url?: string;
      };
      console.log('[TriggerManager] DOM trigger fired', selector, url ?? '', '->', workflowId);
      void runWorkflowById(workflowId);
      return false;
    }

    return false;
  });
}

/**
 * 从数据库重新加载所有 DOM 触发器。
 */
export async function reloadDomTriggers(): Promise<void> {
  activeDomSelectors.clear();
  try {
    const workflows = await listWorkflows();
    for (const wf of workflows) {
      if (wf.trigger?.type === 'dom') {
        const config = wf.trigger.config as { selector: string } | undefined;
        if (config?.selector) {
          activeDomSelectors.set(wf.id, {
            selector: config.selector,
            workflowId: wf.id,
          });
        }
      }
    }
  } catch (err) {
    console.error('[TriggerManager] Failed to reload DOM triggers', err);
  }
}

/**
 * 向所有内容脚本广播 DOM 触发器已更新。
 */
async function broadcastDomTriggersUpdated(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    const msg = { type: 'dom_triggers_updated' };
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

// ─── 执行 ───

async function runWorkflowById(workflowId: string, tabId?: number): Promise<void> {
  try {
    const { getWorkflow } = await import('./repository');
    const wf = await getWorkflow(workflowId);
    if (!wf) return;
    await startWorkflowRun(wf, tabId ? { tabId } : undefined);
  } catch (err) {
    console.error('[TriggerManager] Workflow execution failed', workflowId, err);
  }
}
