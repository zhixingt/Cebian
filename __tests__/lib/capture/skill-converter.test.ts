import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertAutoSkillToRegularSkill, generateSkillDirectoryName } from '@/lib/capture/skill-converter';
import { vfs } from '@/lib/vfs';
import type { AutoSkillDefinition } from '@/lib/capture/types';

vi.mock('@/lib/vfs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vfs')>();
  return {
    ...actual,
    vfs: {
      exists: vi.fn(),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    },
  };
});

function makeSkill(name: string): AutoSkillDefinition {
  return {
    name,
    description: 'Auto-discovered API: GET /api/users (example.com)',
    endpointId: 'GET|/api/users',
    hostname: 'example.com',
    method: 'GET',
    authType: 'none',
    pathname: '/api/users',
    pathParams: [],
    queryParams: [{ name: 'page', type: 'number', required: false, samples: ['1'] }],
    bodyFields: [],
    bgFetchPatterns: ['https://example.com/api/users'],
    script: 'async function run(args = {}) { return { ok: true }; }',
    initialConfidence: 0.85,
    enabled: false,
    createdAt: 1710000000000,
    stats: { callCount: 0, successCount: 0, failureCount: 0, lastCalledAt: null, dynamicConfidence: 0 },
  };
}

describe('generateSkillDirectoryName', () => {
  it('strips auto- prefix', () => {
    expect(generateSkillDirectoryName('auto-example-com-get-api-users')).toBe('example-com-get-api-users');
  });

  it('appends -converted for reserved name', () => {
    expect(generateSkillDirectoryName('new-skill')).toBe('new-skill-converted');
  });
});

describe('convertAutoSkillToRegularSkill', () => {
  beforeEach(() => {
    vi.mocked(vfs.exists).mockReset();
    vi.mocked(vfs.mkdir).mockReset();
    vi.mocked(vfs.writeFile).mockReset();
  });

  it('writes SKILL.md and scripts/api.js', async () => {
    vi.mocked(vfs.exists).mockResolvedValue(false);
    vi.mocked(vfs.mkdir).mockResolvedValue(undefined);
    vi.mocked(vfs.writeFile).mockResolvedValue(undefined);

    const skill = makeSkill('auto-example-com-get-api-users');
    const result = await convertAutoSkillToRegularSkill(skill, '/skills');

    expect(result.dirName).toBe('example-com-get-api-users');
    expect(result.dirPath).toBe('/skills/example-com-get-api-users');
    expect(vfs.mkdir).toHaveBeenCalledWith('/skills/example-com-get-api-users/scripts', { recursive: true });
    expect(vfs.writeFile).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(vfs.writeFile).mock.calls;
    const skillMd = calls.find(([path]) => path === '/skills/example-com-get-api-users/SKILL.md')?.[1] as string;
    expect(skillMd).toContain('name: example-com-get-api-users');
    expect(skillMd).toContain('description:');
    expect(skillMd).toContain('bgFetch:https://example.com/api/users');

    const scriptFile = calls.find(([path]) => path === '/skills/example-com-get-api-users/scripts/api.js')?.[1] as string;
    expect(scriptFile).toContain(skill.script);
  });

  it('throws if directory already exists', async () => {
    vi.mocked(vfs.exists).mockResolvedValue(true);
    const skill = makeSkill('auto-example-com-get-api-users');
    await expect(convertAutoSkillToRegularSkill(skill, '/skills')).rejects.toThrow('already exists');
  });
});
