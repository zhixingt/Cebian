/**
 * 视觉+DOM 双模定位 —— 技术验证原型
 *
 * 职责：当传统 DOM 选择器（CSS/text/role/coords）全部失效时，
 * 通过截图 + 云端 VLM API 识别目标元素坐标，回退到坐标点击。
 *
 * 设计约束：
 * - 仅在用户启用时生效（默认关闭，避免意外 API 调用）
 * - 优先复用用户已有的 OpenAI 兼容模型配置（custom model 中标记 image 输入的模型）
 * - 不阻塞主链路：DOM 定位失败后才尝试视觉回退
 * - 结果缓存：同页面同描述 30s 内不重复调用
 */

import { screenshotTool } from './screenshot';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

// ─── 类型 ───

export interface VisualLocateOptions {
  /** 目标元素的自然语言描述，如"右上角登录按钮" */
  description: string;
  /** 目标标签页 ID */
  tabId: number;
  /** 用户当前配置的 VLM 模型（OpenAI 兼容格式） */
  model: VlmModelConfig;
  /** 截图质量（1-100），默认 70（平衡清晰度与传输体积） */
  quality?: number;
}

export interface VlmModelConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** 最大 Token，默认 512 */
  maxTokens?: number;
}

export interface VisualLocateResult {
  /** 是否成功识别 */
  success: boolean;
  /** CSS viewport 坐标（已除 DPR） */
  x?: number;
  y?: number;
  /** 识别的置信度 0-1（部分模型支持） */
  confidence?: number;
  /** 失败原因 */
  error?: string;
  /** 原始模型输出（调试用途） */
  raw?: string;
}

// ─── 配置 ───

/** 视觉定位全局开关（chrome.storage.local 持久化） */
export const VISUAL_LOCATE_ENABLED_KEY = 'visual_locate_enabled';

/** 同页面同描述缓存时长（毫秒） */
const CACHE_TTL_MS = 30_000;

/** 单次 VLM 调用超时 */
const VLM_TIMEOUT_MS = 15_000;

/** 默认 Prompt 模板 */
const DEFAULT_PROMPT = `You are a UI element locator. Given a screenshot and a user description, return the center coordinates of the described element.

Rules:
- Output ONLY a JSON object: {"x": number, "y": number, "confidence": number}
- Coordinates are in CSS viewport pixels (NOT screenshot pixels). If the screenshot is at DPR>1, divide by DPR.
- If the element is not found, output: {"error": "not_found"}
- Be precise: aim for the visual center of the interactive element (button, link, input).
- If multiple elements match, pick the most prominent one.`;

// ─── 缓存 ───

interface CacheEntry {
  result: VisualLocateResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(tabId: number, url: string, description: string): string {
  return `${tabId}::${url}::${description}`;
}

function getCached(key: string): VisualLocateResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function setCached(key: string, result: VisualLocateResult): void {
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── 核心：视觉定位 ───

/**
 * 视觉定位主入口。
 * 流程：截图 → 调用 VLM → 解析 JSON 坐标 → 返回结果
 */
export async function visualLocate(options: VisualLocateOptions): Promise<VisualLocateResult> {
  const { description, tabId, model, quality = 70 } = options;

  // 1. 检查缓存
  const url = await getTabUrl(tabId);
  const key = cacheKey(tabId, url, description);
  const cached = getCached(key);
  if (cached) return { ...cached, raw: '(cached)' };

  // 2. 截图（复用现有 screenshotTool）
  let screenshotResult: AgentToolResult<{}>;
  try {
    screenshotResult = await screenshotTool.execute('vlm-screenshot', {
      tabId,
      quality,
    }, undefined);
  } catch (e) {
    return { success: false, error: `Screenshot failed: ${(e as Error).message}` };
  }

  const imagePart = screenshotResult.content.find(c => c.type === 'image');
  if (!imagePart || !imagePart.data) {
    return { success: false, error: 'Screenshot produced no image data' };
  }

  const metaPart = screenshotResult.content.find(c => c.type === 'text');
  const dpr = parseDprFromMeta(metaPart?.text ?? '');

  // 3. 调用 VLM API
  let rawOutput: string;
  try {
    rawOutput = await callVlmApi(model, description, imagePart.data, dpr);
  } catch (e) {
    return { success: false, error: `VLM API error: ${(e as Error).message}` };
  }

  // 4. 解析坐标
  const result = parseVlmOutput(rawOutput);
  result.raw = rawOutput;

  // 5. 写入缓存
  if (result.success) {
    setCached(key, result);
  }

  return result;
}

// ─── VLM API 调用 ───

async function callVlmApi(
  model: VlmModelConfig,
  description: string,
  imageBase64: string,
  dpr: number,
): Promise<string> {
  const url = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model: model.modelId,
    max_tokens: model.maxTokens ?? 512,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: DEFAULT_PROMPT + `\n\nImportant: The screenshot has DPR=${dpr}. If you estimate coordinates from the raw image pixels, divide by ${dpr} to get CSS viewport coordinates.`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Find the element: "${description}"` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return String(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── 输出解析 ───

function parseVlmOutput(output: string): VisualLocateResult {
  // 尝试提取 JSON 代码块或裸 JSON
  const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/) ?? output.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    if (parsed.error || parsed.x == null || parsed.y == null) {
      return {
        success: false,
        error: parsed.error ?? 'Model returned incomplete coordinates',
      };
    }

    // 安全校验：坐标必须在合理范围内
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      return { success: false, error: `Invalid coordinates: (${x}, ${y})` };
    }

    return {
      success: true,
      x,
      y,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : undefined,
    };
  } catch {
    // 回退：正则提取 "x":123, "y":456
    const xMatch = output.match(/["']?x["']?\s*[:=]\s*(\d+(?:\.\d+)?)/);
    const yMatch = output.match(/["']?y["']?\s*[:=]\s*(\d+(?:\.\d+)?)/);
    if (xMatch && yMatch) {
      const x = Number(xMatch[1]);
      const y = Number(yMatch[1]);
      return { success: true, x, y };
    }
    return { success: false, error: `Failed to parse model output: ${output.slice(0, 200)}` };
  }
}

// ─── 辅助 ───

async function getTabUrl(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? '';
  } catch {
    return '';
  }
}

/** 从 screenshotTool 返回的 meta 文本中提取 DPR */
export function parseDprFromMeta(meta: string): number {
  const m = meta.match(/DPR:\s*([0-9.]+)/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

// ─── 与 interact.ts 集成：页面内坐标→元素映射 ───

/**
 * 在页面上下文中执行：根据坐标找到最匹配的可交互元素。
 * 自包含函数，可被 chrome.scripting.executeScript 注入。
 */
export function resolveElementAtCoords(params: { x: number; y: number }): {
  tagName: string;
  text: string;
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
} | null {
  const { x, y } = params;
  const stack = document.elementsFromPoint(x, y) as HTMLElement[];
  if (!stack.length) return null;

  // 优先选择可交互元素
  const interactive = stack.find(el => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    return ['a', 'button', 'input', 'select', 'textarea'].includes(tag)
      || ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'textbox', 'searchbox', 'slider'].includes(role ?? '')
      || el.hasAttribute('tabindex')
      || el.getAttribute('contenteditable') === 'true';
  });

  const el = interactive ?? stack.find(e => getComputedStyle(e).pointerEvents !== 'none') ?? stack[0];
  if (!el) return null;

  const rect = el.getBoundingClientRect();

  // 生成稳定选择器（优先 id，其次 aria-label，最后 tag+nth）
  let selector: string;
  if (el.id) {
    selector = `#${CSS.escape(el.id)}`;
  } else {
    const label = el.getAttribute('aria-label');
    if (label) {
      selector = `[aria-label="${CSS.escape(label)}"]`;
    } else {
      const text = el.textContent?.trim().slice(0, 20);
      if (text) {
        selector = `${el.tagName.toLowerCase()}:contains("${text}")`;
      } else {
        selector = el.tagName.toLowerCase();
      }
    }
  }

  return {
    tagName: el.tagName.toLowerCase(),
    text: (el.textContent ?? '').trim().slice(0, 100),
    selector,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}
