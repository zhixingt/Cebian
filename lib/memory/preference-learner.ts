// ─── 用户偏好学习 ───
//
// 从用户消息中检测语言偏好，从 navigate 工具调用中记录常用网站，
// 异步写入 userProfile 表。无需手动配置。
// 见 openspec/changes/2026-06-18-user-preference-learning/design.md。

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { getUserProfile, setUserProfile } from './user-profile';

/** 常用网站记录条目 */
export interface FrequentSite {
  domain: string;
  count: number;
  lastVisited: number;
}

/** 最多保留的常用网站数量 */
const MAX_FREQUENT_SITES = 10;

/** 用于多数投票的最近用户消息数量 */
const RECENT_USER_MESSAGE_LIMIT = 3;

/**
 * 基于字符集的简单语言检测（CJK/假名/拉丁）。
 * 无需外部依赖，准确度满足 MVP 需求。
 */
export function detectLanguage(text: string): 'zh' | 'en' | 'ja' | 'unknown' {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const hiragana = (text.match(/[\u3040-\u309f]/g) || []).length;
  const katakana = (text.match(/[\u30a0-\u30ff]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;

  const ja = hiragana + katakana;

  if (ja > 0 && ja >= cjk * 0.3) return 'ja';
  if (cjk > latin) return 'zh';
  if (latin > cjk && latin > 0) return 'en';
  return 'unknown';
}

/**
 * 从 URL 提取 hostname 作为 domain。
 * 无效 URL 返回 null。
 */
export function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

/**
 * 将消息 content（string 或 content block 数组）转为纯文本。
 * 与 session-history.ts 的 contentToText 保持一致。
 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text: unknown }).text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 从消息数组中提取最近 N 条用户消息的纯文本。
 */
function recentUserTexts(messages: readonly AgentMessage[], limit: number): string[] {
  const userTexts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && userTexts.length < limit; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m.role === 'user') {
      const text = contentToText(m.content);
      if (text) userTexts.push(text);
    }
  }
  return userTexts.reverse();
}

/**
 * 多数投票确定主导语言。
 * 过滤 'unknown'，若无有效检测结果返回 null。
 * 平票时返回 null（不写入）。
 */
function majorityVote(languages: ('zh' | 'en' | 'ja' | 'unknown')[]): 'zh' | 'en' | 'ja' | null {
  const valid = languages.filter((l) => l !== 'unknown');
  if (valid.length === 0) return null;

  const counts = new Map<'zh' | 'en' | 'ja', number>();
  for (const l of valid) {
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }

  let maxCount = 0;
  let maxLang: 'zh' | 'en' | 'ja' | null = null;
  let tie = false;
  for (const [lang, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
      tie = false;
    } else if (count === maxCount) {
      tie = true;
    }
  }

  return tie ? null : maxLang;
}

/**
 * 从最近用户消息中学习语言偏好，写入 userProfile.language。
 * 异步执行，失败时静默（由调用方 catch）。
 *
 * @param sessionId 会话 ID（预留，当前语言偏好为全局存储）
 * @param messages 会话消息数组
 */
export async function learnFromMessage(
  sessionId: string,
  messages: AgentMessage[],
): Promise<void> {
  void sessionId; // 预留：当前语言偏好为全局存储，未来可按会话区分

  const texts = recentUserTexts(messages, RECENT_USER_MESSAGE_LIMIT);
  if (texts.length === 0) return;

  const languages = texts.map((t) => detectLanguage(t));
  const lang = majorityVote(languages);
  if (lang === null) return;

  await setUserProfile('language', lang);
}

/**
 * 从 URL 学习常用网站，更新 userProfile.frequentSites。
 * 频次 +1，按频次降序排序，保留 top-10。
 * 异步执行，失败时静默（由调用方 catch）。
 *
 * @param url 用户访问的 URL
 */
export async function learnFromNavigation(url: string): Promise<void> {
  const domain = extractDomain(url);
  if (!domain) return;

  const raw = await getUserProfile('frequentSites');
  let sites: FrequentSite[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        sites = parsed.filter(
          (s): s is FrequentSite =>
            s &&
            typeof s === 'object' &&
            typeof s.domain === 'string' &&
            typeof s.count === 'number' &&
            typeof s.lastVisited === 'number',
        );
      }
    } catch {
      sites = [];
    }
  }

  const now = Date.now();
  const existing = sites.find((s) => s.domain === domain);
  if (existing) {
    existing.count += 1;
    existing.lastVisited = now;
  } else {
    sites.push({ domain, count: 1, lastVisited: now });
  }

  // 按频次降序排序，保留 top-10
  sites.sort((a, b) => b.count - a.count);
  if (sites.length > MAX_FREQUENT_SITES) {
    sites = sites.slice(0, MAX_FREQUENT_SITES);
  }

  await setUserProfile('frequentSites', JSON.stringify(sites));
}
