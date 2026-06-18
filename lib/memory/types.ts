// ─── 分层记忆系统类型定义 ───
//
// 三个 Dexie 表对应的 record 类型，以及检索结果的聚合类型。
// 见 openspec/changes/2026-06-18-layered-memory-system/design.md。

/**
 * 用户画像：键值对存储用户偏好（语言、常用网站、工作习惯等）。
 * 每次对话全量注入 system prompt。
 */
export interface UserProfileRecord {
  /** PK: 'language' | 'preferredSites' | 'workHabits' | ... */
  key: string;
  /** JSON string or plain text */
  value: string;
  updatedAt: number;
}

/**
 * Agent 记忆：任务经验与教训，按相关性检索注入。
 */
export interface AgentMemoryRecord {
  /** PK: UUID */
  id: string;
  type: 'success' | 'failure' | 'pattern';
  content: string;
  keywords: string[];
  createdAt: number;
  /** 初始相关性分数 (0-1) */
  relevance: number;
}

/**
 * 会话摘要：历史会话的关键信息摘要，按关键词和时间衰减检索。
 */
export interface SessionSummaryRecord {
  /** PK: UUID */
  id: string;
  /** 关联的会话 ID */
  sessionId: string;
  title: string;
  /** 摘要（首条用户消息 + 末条助手消息截取） */
  summary: string;
  keywords: string[];
  createdAt: number;
}

/**
 * 检索结果聚合类型。
 */
export interface RetrievedMemories {
  profile: UserProfileRecord[];
  summaries: SessionSummaryRecord[];
  memories: AgentMemoryRecord[];
}
