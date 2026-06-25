/**
 * lib/agent-context.ts 测试
 *
 * 覆盖 buildApiSkillPreamble：
 * - hostname 缺失时返回空字符串
 * - 无可用 Skill 时返回空字符串
 * - 有可用 GET Skill 时返回格式化前导文本
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApiSkillPreamble } from '@/lib/agent-context';
import type { AutoSkillDefinition } from '@/lib/capture/types';

const mockGetEnabledSkillsForHostname = vi.fn<(hostname: string) => Promise<AutoSkillDefinition[]>>();
const mockGetEffectiveConfidence = vi.fn<(skill: AutoSkillDefinition) => number>();

vi.mock('@/lib/capture/skill-registry', () => ({
  getEnabledSkillsForHostname: mockGetEnabledSkillsForHostname,
  getEffectiveConfidence: mockGetEffectiveConfidence,
}));

beforeEach(() => {
  mockGetEnabledSkillsForHostname.mockReset();
  mockGetEffectiveConfidence.mockReset();
  mockGetEffectiveConfidence.mockImplementation((skill) => skill.initialConfidence);
});

function makeSkill(overrides: Partial<AutoSkillDefinition> = {}): AutoSkillDefinition {
  return {
    name: 'auto-api-example-com-get-query',
    description: 'Auto-discovered API: GET /query (api.example.com)',
    endpointId: 'GET|/query',
    hostname: 'api.example.com',
    method: 'GET',
    authType: 'cookie',
    pathname: '/query',
    pathParams: [],
    queryParams: [{ name: 'q', type: 'string', required: true, samples: [] }],
    bodyFields: [],
    bgFetchPatterns: ['https://api.example.com/query'],
    script: 'async function run(args = {}) { /* ... */ }',
    initialConfidence: 0.85,
    enabled: true,
    createdAt: Date.now(),
    stats: {
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      lastCalledAt: null,
      dynamicConfidence: 0,
    },
    ...overrides,
  };
}

describe('buildApiSkillPreamble', () => {
  it('hostname 缺失时返回空字符串', async () => {
    const result = await buildApiSkillPreamble(undefined);
    expect(result).toBe('');
    expect(mockGetEnabledSkillsForHostname).not.toHaveBeenCalled();
  });

  it('无可用 Skill 时返回空字符串', async () => {
    mockGetEnabledSkillsForHostname.mockResolvedValue([]);
    const result = await buildApiSkillPreamble('api.example.com');
    expect(result).toBe('');
    expect(mockGetEnabledSkillsForHostname).toHaveBeenCalledWith('api.example.com');
  });

  it('有可用 GET Skill 时返回正确前导文本', async () => {
    mockGetEnabledSkillsForHostname.mockResolvedValue([
      makeSkill({
        name: 'auto-api-example-com-get-query',
        pathname: '/query',
        method: 'GET',
        queryParams: [{ name: 'q', type: 'string', required: true, samples: [] }],
        initialConfidence: 0.85,
      }),
    ]);

    const result = await buildApiSkillPreamble('api.example.com');

    expect(result).toContain('AUTO-DISCOVERED API SKILLS FOR CURRENT SITE:');
    expect(result).toContain('- GET /query [confidence=85%]: q(string, required)');
    expect(result).toContain(
      'When reading structured data from this site, prefer using smart_read_page with mode="json" and the URL matching the skill pathname.',
    );
    expect(result).toContain(
      'For write operations (POST/PUT/DELETE), ask the user for confirmation first unless the skill has been converted to a regular skill.',
    );
  });
});
