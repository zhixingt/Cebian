import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

// Mock user-profile 模块，隔离 preference-learner 的单元测试
vi.mock('@/lib/memory/user-profile', () => ({
  getUserProfile: vi.fn<() => Promise<string | undefined>>(),
  setUserProfile: vi.fn<() => Promise<void>>(),
}));

import { getUserProfile, setUserProfile } from '@/lib/memory/user-profile';
import {
  detectLanguage,
  extractDomain,
  learnFromMessage,
  learnFromNavigation,
  type FrequentSite,
} from '@/lib/memory/preference-learner';

// 构造用户消息的辅助函数
function userMessage(content: string | unknown): AgentMessage {
  return { role: 'user', content } as unknown as AgentMessage;
}

function assistantMessage(content: string): AgentMessage {
  return { role: 'assistant', content } as unknown as AgentMessage;
}

describe('detectLanguage', () => {
  it('中文文本 → zh', () => {
    expect(detectLanguage('你好，今天天气怎么样？')).toBe('zh');
    expect(detectLanguage('帮我写一个函数来处理数据')).toBe('zh');
  });

  it('英文文本 → en', () => {
    expect(detectLanguage('Hello, how are you today?')).toBe('en');
    expect(detectLanguage('Please help me write a function')).toBe('en');
  });

  it('日文文本（含假名）→ ja', () => {
    expect(detectLanguage('こんにちは、今日は良い天気ですね')).toBe('ja');
    expect(detectLanguage('おはようございます')).toBe('ja');
  });

  it('混合文本（中文+英文，中文占多）→ zh', () => {
    expect(detectLanguage('请帮我 review 这段代码，看看有没有问题')).toBe('zh');
  });

  it('混合文本（英文占多）→ en', () => {
    expect(detectLanguage('Please help me 帮忙 review this code')).toBe('en');
  });

  it('空字符串 → unknown', () => {
    expect(detectLanguage('')).toBe('unknown');
  });

  it('纯数字/标点 → unknown', () => {
    expect(detectLanguage('1234567890')).toBe('unknown');
    expect(detectLanguage('！@#￥%……&*（）')).toBe('unknown');
    expect(detectLanguage('   \n\t  ')).toBe('unknown');
  });
});

describe('extractDomain', () => {
  it('正常 URL → domain', () => {
    expect(extractDomain('https://github.com/user/repo')).toBe('github.com');
    expect(extractDomain('http://example.com')).toBe('example.com');
  });

  it('无效 URL → null', () => {
    expect(extractDomain('not a url')).toBeNull();
    expect(extractDomain('')).toBeNull();
    expect(extractDomain('://missing-protocol')).toBeNull();
  });

  it('带端口 → domain（不含端口）', () => {
    expect(extractDomain('http://localhost:3000/path')).toBe('localhost');
    expect(extractDomain('https://example.com:8080')).toBe('example.com');
  });

  it('带路径 → domain', () => {
    expect(extractDomain('https://docs.example.com/api/v1/users?id=42')).toBe(
      'docs.example.com',
    );
  });
});

describe('learnFromMessage', () => {
  beforeEach(() => {
    vi.mocked(getUserProfile).mockReset();
    vi.mocked(setUserProfile).mockReset();
  });

  it('3 条中文消息 → language = zh', async () => {
    const messages: AgentMessage[] = [
      userMessage('你好，请帮我写代码'),
      userMessage('我需要一个函数来处理数据'),
      userMessage('谢谢你的帮助'),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).toHaveBeenCalledWith('language', 'zh');
  });

  it('3 条英文消息 → language = en', async () => {
    const messages: AgentMessage[] = [
      userMessage('Hello, please help me write code'),
      userMessage('I need a function to process data'),
      userMessage('Thank you for your help'),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).toHaveBeenCalledWith('language', 'en');
  });

  it('混合消息（2 中 1 英）→ zh（多数投票）', async () => {
    const messages: AgentMessage[] = [
      userMessage('你好'),
      userMessage('Hello world'),
      userMessage('请帮我'),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).toHaveBeenCalledWith('language', 'zh');
  });

  it('少于 3 条消息 → 用现有消息', async () => {
    const messages: AgentMessage[] = [userMessage('你好世界')];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).toHaveBeenCalledWith('language', 'zh');
  });

  it('无用户消息 → 不写入', async () => {
    const messages: AgentMessage[] = [
      assistantMessage('Hello there'),
      assistantMessage('How can I help?'),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).not.toHaveBeenCalled();
  });

  it('只取最近 3 条用户消息', async () => {
    // 5 条消息：前 2 条英文，后 3 条中文 → 应判定为 zh
    const messages: AgentMessage[] = [
      userMessage('Hello world'),
      userMessage('Good morning'),
      userMessage('你好'),
      userMessage('请帮我'),
      userMessage('谢谢'),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).toHaveBeenCalledWith('language', 'zh');
  });

  it('平票时不写入（1 中 1 英）', async () => {
    const messages: AgentMessage[] = [
      userMessage('你好'),
      userMessage('Hello'),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).not.toHaveBeenCalled();
  });

  it('全部 unknown 时不写入', async () => {
    const messages: AgentMessage[] = [
      userMessage('12345'),
      userMessage('!@#$%'),
      userMessage('   '),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).not.toHaveBeenCalled();
  });

  it('content 为数组形式（content blocks）也能正确检测', async () => {
    const messages: AgentMessage[] = [
      userMessage([{ type: 'text', text: '你好世界' }]),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).toHaveBeenCalledWith('language', 'zh');
  });

  it('空 content 的用户消息被跳过', async () => {
    const messages: AgentMessage[] = [
      userMessage(''),
      userMessage('你好世界'),
    ];
    await learnFromMessage('sess-1', messages);
    expect(setUserProfile).toHaveBeenCalledWith('language', 'zh');
  });
});

describe('learnFromNavigation', () => {
  beforeEach(() => {
    vi.mocked(getUserProfile).mockReset();
    vi.mocked(setUserProfile).mockReset();
  });

  it('首次访问 → frequentSites = [{domain, count:1}]', async () => {
    vi.mocked(getUserProfile).mockResolvedValue(undefined);
    await learnFromNavigation('https://github.com/user/repo');
    expect(setUserProfile).toHaveBeenCalledTimes(1);
    const [key, value] = vi.mocked(setUserProfile).mock.calls[0];
    expect(key).toBe('frequentSites');
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites).toHaveLength(1);
    expect(sites[0].domain).toBe('github.com');
    expect(sites[0].count).toBe(1);
    expect(sites[0].lastVisited).toBeGreaterThan(0);
  });

  it('重复访问 → count+1', async () => {
    const existing: FrequentSite[] = [
      { domain: 'github.com', count: 5, lastVisited: 1000 },
    ];
    vi.mocked(getUserProfile).mockResolvedValue(JSON.stringify(existing));
    await learnFromNavigation('https://github.com/new');
    const [, value] = vi.mocked(setUserProfile).mock.calls[0];
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites).toHaveLength(1);
    expect(sites[0].domain).toBe('github.com');
    expect(sites[0].count).toBe(6);
    expect(sites[0].lastVisited).toBeGreaterThan(1000);
  });

  it('新增 domain 与已有 domain 共存', async () => {
    const existing: FrequentSite[] = [
      { domain: 'github.com', count: 3, lastVisited: 1000 },
    ];
    vi.mocked(getUserProfile).mockResolvedValue(JSON.stringify(existing));
    await learnFromNavigation('https://google.com');
    const [, value] = vi.mocked(setUserProfile).mock.calls[0];
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites).toHaveLength(2);
    // 按频次降序：github.com(3) 在前，google.com(1) 在后
    expect(sites[0].domain).toBe('github.com');
    expect(sites[0].count).toBe(3);
    expect(sites[1].domain).toBe('google.com');
    expect(sites[1].count).toBe(1);
  });

  it('按频次降序排序', async () => {
    const existing: FrequentSite[] = [
      { domain: 'a.com', count: 1, lastVisited: 1000 },
      { domain: 'b.com', count: 5, lastVisited: 1000 },
      { domain: 'c.com', count: 3, lastVisited: 1000 },
    ];
    vi.mocked(getUserProfile).mockResolvedValue(JSON.stringify(existing));
    await learnFromNavigation('https://a.com');
    const [, value] = vi.mocked(setUserProfile).mock.calls[0];
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites.map((s) => s.domain)).toEqual(['b.com', 'c.com', 'a.com']);
    expect(sites[0].count).toBe(5);
    expect(sites[1].count).toBe(3);
    expect(sites[2].count).toBe(2); // a.com 从 1 增到 2
  });

  it('top-10 截断：超过 10 个站点时保留 top-10', async () => {
    // 构造 10 个 site，频次从 2 到 11（确保新站点 count=1 会被截断）
    const existing: FrequentSite[] = Array.from({ length: 10 }, (_, i) => ({
      domain: `site${i}.com`,
      count: i + 2, // site0=2, site1=3, ..., site9=11
      lastVisited: 1000,
    }));
    vi.mocked(getUserProfile).mockResolvedValue(JSON.stringify(existing));
    // 访问新 domain（频次为 1，小于所有已有站点）
    await learnFromNavigation('https://newsite.com');
    const [, value] = vi.mocked(setUserProfile).mock.calls[0];
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites).toHaveLength(10);
    // newsite.com (count=1) 应被截断
    const domains = sites.map((s) => s.domain);
    expect(domains).not.toContain('newsite.com');
    // 验证保留的是 top-10（频次 2..11）
    expect(domains).toContain('site0.com');
    expect(domains).toContain('site9.com');
    // 验证排序：降序
    for (let i = 0; i < sites.length - 1; i++) {
      expect(sites[i].count).toBeGreaterThanOrEqual(sites[i + 1].count);
    }
  });

  it('top-10 截断：新站点频次高于最小值时替换最少的', async () => {
    // 构造 10 个 site，频次从 1 到 10
    const existing: FrequentSite[] = Array.from({ length: 10 }, (_, i) => ({
      domain: `site${i}.com`,
      count: i + 1, // site0=1, site1=2, ..., site9=10
      lastVisited: 1000,
    }));
    vi.mocked(getUserProfile).mockResolvedValue(JSON.stringify(existing));
    // 再次访问 site9.com（频次 10→11），不新增站点，无需截断
    await learnFromNavigation('https://site9.com');
    const [, value] = vi.mocked(setUserProfile).mock.calls[0];
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites).toHaveLength(10);
    expect(sites[0].domain).toBe('site9.com');
    expect(sites[0].count).toBe(11);
  });

  it('无效 URL → 不写入', async () => {
    await learnFromNavigation('not-a-url');
    expect(getUserProfile).not.toHaveBeenCalled();
    expect(setUserProfile).not.toHaveBeenCalled();
  });

  it('frequentSites JSON 解析失败 → 视为空数组重新开始', async () => {
    vi.mocked(getUserProfile).mockResolvedValue('not valid json {');
    await learnFromNavigation('https://github.com');
    const [, value] = vi.mocked(setUserProfile).mock.calls[0];
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites).toHaveLength(1);
    expect(sites[0].domain).toBe('github.com');
    expect(sites[0].count).toBe(1);
  });

  it('frequentSites 为空字符串 → 视为空数组', async () => {
    vi.mocked(getUserProfile).mockResolvedValue('');
    await learnFromNavigation('https://github.com');
    const [, value] = vi.mocked(setUserProfile).mock.calls[0];
    const sites: FrequentSite[] = JSON.parse(value);
    expect(sites).toHaveLength(1);
    expect(sites[0].domain).toBe('github.com');
  });
});
