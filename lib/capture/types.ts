/**
 * API Discovery 类型定义。
 *
 * 覆盖 CDP 网络事件、捕获会话状态、API 端点元数据、自动生成 Skill
 * 四个维度。所有 capture/ 模块共享这些类型。
 */

// ─── CDP 网络事件（chrome.debugger 透传） ───

/** CDP Network.requestWillBeSent 事件的关键字段 */
export interface CdpRequestWillBeSent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
    initialPriority?: string;
  };
  timestamp: number;
  wallTime?: number;
  type?: string; // ResourceType: XHR | Fetch | Document | ...
  frameId?: string;
}

/** CDP Network.responseReceived 事件的关键字段 */
export interface CdpResponseReceived {
  requestId: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
    protocol?: string;
    remoteIPAddress?: string;
  };
  timestamp: number;
  type?: string;
}

/** CDP Network.loadingFinished 事件 */
export interface CdpLoadingFinished {
  requestId: string;
  timestamp: number;
  encodedDataLength?: number;
}

/** CDP Network.loadingFailed 事件 */
export interface CdpLoadingFailed {
  requestId: string;
  timestamp: number;
  errorText: string;
  canceled?: boolean;
}

// ─── 捕获会话状态 ───

export type CaptureStatus = 'idle' | 'attaching' | 'capturing' | 'detaching' | 'error';

export interface CaptureSessionState {
  /** 当前附加的标签页 ID（null 表示未附加） */
  tabId: number | null;
  /** 会话状态 */
  status: CaptureStatus;
  /** 捕获开始时间戳（ms） */
  startedAt: number;
  /** 捕获结束时间戳（ms） */
  endedAt: number | null;
  /** 已捕获的请求总数 */
  requestCount: number;
  /** 已过滤为 API 候选的数量 */
  apiCandidateCount: number;
  /** 错误信息（status === 'error' 时） */
  error: string | null;
  /** 当前标签页的 hostname（用于按站点隔离） */
  hostname: string | null;
}

// ─── API 端点元数据 ───

/** 认证类型 */
export type AuthType = 'cookie' | 'bearer' | 'api-key' | 'none';

/** 参数类型推断 */
export type ParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

/** Query 参数定义 */
export interface QueryParamDef {
  name: string;
  type: ParamType;
  required: boolean;
  /** 观察到的值样本（脱敏后，最多保留 3 个） */
  samples: string[];
}

/** Body 字段定义 */
export interface BodyFieldDef {
  name: string;
  type: ParamType;
  required: boolean;
  samples: string[];
}

/** Path 参数定义 */
export interface PathParamDef {
  name: string;
  /** 原始路径片段（如 "123" → "{id}"） */
  placeholder: string;
}

/** 响应 Schema（简化版，仅第一层） */
export interface ResponseSchemaDef {
  status: number;
  mimeType: string;
  /** JSON 响应的字段类型映射（仅顶层） */
  fields?: Record<string, ParamType>;
  /** 如果是数组，元素的类型 */
  itemsType?: ParamType;
}

/** 端点元数据 — 一个 API 端点的完整描述 */
export interface EndpointMeta {
  /** 唯一 ID：`${method}|${normalizedPathname}` */
  id: string;
  /** HTTP 方法 */
  method: string;
  /** 归一化后的路径（如 /api/users/{id}） */
  pathname: string;
  /** 原始 hostname */
  hostname: string;
  /** Path 参数 */
  pathParams: PathParamDef[];
  /** Query 参数 */
  queryParams: QueryParamDef[];
  /** Body 字段 */
  bodyFields: BodyFieldDef[];
  /** 认证类型 */
  authType: AuthType;
  /** 认证 header 名称（api-key 类型时有效） */
  authHeaderName?: string;
  /** 响应 Schema 列表（按状态码区分） */
  responseSchemas: ResponseSchemaDef[];
  /** 观察到的样本数 */
  sampleCount: number;
  /** 观察到的状态码集合 */
  statusCodes: number[];
  /** 初始置信度（0-1） */
  confidence: number;
  /** 首次发现时间 */
  firstSeenAt: number;
  /** 最后发现时间 */
  lastSeenAt: number;
}

// ─── 自动生成的 Skill ───

/** Skill 执行统计 */
export interface SkillStats {
  /** 总调用次数 */
  callCount: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 最后调用时间 */
  lastCalledAt: number | null;
  /** 动态置信度（基于成功率调整） */
  dynamicConfidence: number;
}

/** 自动生成的 Skill 定义 */
export interface AutoSkillDefinition {
  /** Skill 名称：auto-${hostname}-${endpointId} */
  name: string;
  /** 描述 */
  description: string;
  /** 关联的端点 ID */
  endpointId: string;
  /** hostname */
  hostname: string;
  /** HTTP 方法 */
  method: string;
  /** 认证类型（从 EndpointMeta 透传） */
  authType: AuthType;
  /** 认证 header 名称（api-key 类型时有效） */
  authHeaderName?: string;
  /** 归一化路径 */
  pathname: string;
  /** Path 参数（可选，兼容旧数据） */
  pathParams?: PathParamDef[];
  /** Query 参数（可选，兼容旧数据） */
  queryParams?: QueryParamDef[];
  /** Body 字段（可选，兼容旧数据） */
  bodyFields?: BodyFieldDef[];
  /** bgFetch 权限 patterns */
  bgFetchPatterns: string[];
  /** 生成的脚本代码 */
  script: string;
  /** 初始置信度 */
  initialConfidence: number;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 执行统计 */
  stats: SkillStats;
}

// ─── 消息协议（Background ↔ Sidepanel） ───

/** API Discovery 消息类型标识 */
export const API_DISCOVERY_MSG = 'cebianx:api-discovery' as const;

/** Sidepanel → Background 的控制消息 */
export type ApiDiscoveryControlMessage =
  | { type: 'enable' }
  | { type: 'disable' }
  | { type: 'start_capture'; tabId: number }
  | { type: 'stop_capture' }
  | { type: 'analyze_capture' }
  | { type: 'list_auto_skills' }
  | { type: 'enable_skill'; skillName: string }
  | { type: 'disable_skill'; skillName: string }
  | { type: 'delete_skill'; skillName: string };

/** Background → Sidepanel 的状态消息 */
export type ApiDiscoveryStatusMessage =
  | { type: 'capture_status'; state: CaptureSessionState }
  | { type: 'capture_progress'; requestCount: number; apiCandidateCount: number }
  | { type: 'analysis_complete'; endpointsFound: number; skillsGenerated: number }
  | { type: 'skills_list'; skills: AutoSkillDefinition[] }
  | { type: 'error'; message: string };

// ─── 常量 ───

/** 捕获最大时长（5 分钟） */
export const CAPTURE_MAX_DURATION_MS = 5 * 60 * 1000;

/** 捕获最大请求数 */
export const CAPTURE_MAX_REQUESTS = 2000;

/** 心跳间隔（20 秒，对抗 SW 30s 超时） */
export const CAPTURE_HEARTBEAT_INTERVAL_MS = 20_000;

/** Skill 生成的最少样本数 */
export const SKILL_MIN_SAMPLES = 2;

/** Skill 展示给 Agent 的最低置信度 */
export const SKILL_MIN_CONFIDENCE = 0.6;

/** Skill 动态置信度：启用所需的最少调用次数 */
export const SKILL_ENABLE_MIN_CALLS = 3;

/** 置信度计算权重 */
export const CONFIDENCE_HISTORY_WEIGHT = 0.7;
export const CONFIDENCE_RECENT_WEIGHT = 0.3;

/** 置信度上限 */
export const CONFIDENCE_MAX = 0.95;
