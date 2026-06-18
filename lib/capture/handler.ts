/**
 * API Discovery Background Handler — 处理来自 sidepanel 的控制消息，
 * 协调捕获会话、分析器和 Skill 注册表。
 */

import { captureSession } from './capture-session';
import { analyzeRequests } from './analyzer';
import { generateSkillsFromEndpoints } from './skill-generator';
import {
  initRegistry,
  addSkills,
  getAllSkills,
  getSkillsByHostname,
  enableSkill,
  disableSkill,
  deleteSkill,
} from './skill-registry';
import type { ApiDiscoveryControlMessage, ApiDiscoveryStatusMessage } from './types';
import { API_DISCOVERY_MSG } from './types';

/** 是否已初始化 */
let initialized = false;

/** 状态广播回调列表 */
type StatusListener = (msg: ApiDiscoveryStatusMessage) => void;
const statusListeners = new Set<StatusListener>();

/** 广播状态消息 */
function broadcast(msg: ApiDiscoveryStatusMessage): void {
  for (const listener of statusListeners) {
    try {
      listener(msg);
    } catch (err) {
      console.error('[api-discovery] broadcast error:', err);
    }
  }
}

/** 注册状态监听器 */
export function onStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** 初始化 API Discovery 模块 */
export async function initApiDiscovery(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await initRegistry();

  // 监听捕获会话状态变更
  captureSession.onStateChange((state) => {
    broadcast({ type: 'capture_status', state });
    broadcast({
      type: 'capture_progress',
      requestCount: state.requestCount,
      apiCandidateCount: state.apiCandidateCount,
    });
  });

  console.log('[api-discovery] initialized');
}

/**
 * 处理 API Discovery 控制消息。
 * 在 background 的 onMessage 监听器中调用。
 */
export async function handleApiDiscoveryMessage(
  msg: ApiDiscoveryControlMessage,
): Promise<unknown> {
  await initApiDiscovery();

  switch (msg.type) {
    case 'enable':
    case 'disable':
      // 全局开关（目前仅标记，实际控制通过 start/stop_capture）
      return { ok: true };

    case 'start_capture': {
      try {
        // 检查 debugger 权限（optional_permissions，需用户授权）
        if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) {
          const granted = await chrome.permissions.request({ permissions: ['debugger'] });
          if (!granted) {
            throw new Error('Debugger permission is required to capture network traffic');
          }
        }

        // 获取标签页信息
        const tab = await chrome.tabs.get(msg.tabId);
        let hostname: string;
        try {
          hostname = new URL(tab.url ?? '').hostname;
        } catch {
          throw new Error('Unable to resolve tab hostname');
        }

        await captureSession.start(msg.tabId, hostname);
        return { ok: true, state: captureSession.getState() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        broadcast({ type: 'error', message });
        return { ok: false, error: message };
      }
    }

    case 'stop_capture': {
      const requests = await captureSession.stop();
      return { ok: true, requestCount: requests.length };
    }

    case 'analyze_capture': {
      try {
        const requests = captureSession.getCapturedRequests();
        const endpoints = analyzeRequests(requests);
        const skills = generateSkillsFromEndpoints(endpoints);

        if (skills.length > 0) {
          await addSkills(skills);
        }

        broadcast({
          type: 'analysis_complete',
          endpointsFound: endpoints.length,
          skillsGenerated: skills.length,
        });

        return {
          ok: true,
          endpointsFound: endpoints.length,
          skillsGenerated: skills.length,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        broadcast({ type: 'error', message });
        return { ok: false, error: message };
      }
    }

    case 'list_auto_skills': {
      const skills = await getAllSkills();
      broadcast({ type: 'skills_list', skills });
      return { ok: true, skills };
    }

    case 'enable_skill': {
      await enableSkill(msg.skillName);
      return { ok: true };
    }

    case 'disable_skill': {
      await disableSkill(msg.skillName);
      return { ok: true };
    }

    case 'delete_skill': {
      await deleteSkill(msg.skillName);
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

/**
 * 注册 chrome.runtime.onMessage 监听器。
 * 应在 background index.ts 中调用。
 */
export function registerApiDiscoveryHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== API_DISCOVERY_MSG) return false;

    handleApiDiscoveryMessage(message.payload as ApiDiscoveryControlMessage)
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });

    return true; // 异步响应
  });
}
