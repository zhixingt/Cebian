/**
 * 将 AutoSkillDefinition 转换为 VFS 普通 Skill。
 *
 * 输出结构：
 *   ~/.cebian/skills/<dirName>/SKILL.md
 *   ~/.cebian/skills/<dirName>/scripts/api.js
 */
import { vfs, normalizePath } from '@/lib/vfs';
import type { AutoSkillDefinition } from './types';

export interface ConvertedSkillPaths {
  dirName: string;
  dirPath: string;
  skillMdPath: string;
  scriptPath: string;
}

export function generateSkillDirectoryName(autoSkillName: string): string {
  let base = autoSkillName.startsWith('auto-') ? autoSkillName.slice(5) : autoSkillName;
  if (base === 'new-skill') {
    base = `${base}-converted`;
  }
  return base;
}

export async function convertAutoSkillToRegularSkill(
  skill: AutoSkillDefinition,
  skillsRoot: string,
): Promise<ConvertedSkillPaths> {
  const dirName = generateSkillDirectoryName(skill.name);
  const dirPath = normalizePath(`${skillsRoot}/${dirName}`);
  const scriptsDir = `${dirPath}/scripts`;
  const skillMdPath = `${dirPath}/SKILL.md`;
  const scriptPath = `${scriptsDir}/api.js`;

  if (await vfs.exists(dirPath)) {
    throw new Error(`Regular skill directory "${dirName}" already exists.`);
  }

  const permissions = ['bgFetch'];
  for (const pattern of skill.bgFetchPatterns) {
    permissions.push(`bgFetch:${pattern}`);
  }

  const params = [
    ...(skill.pathParams ?? []).map((p) => `${p.name}(string)`),
    ...(skill.queryParams ?? []).map((p) => `${p.name}(${p.type}${p.required ? ', required' : ''})`),
    ...(skill.bodyFields ?? []).map((p) => `${p.name}(${p.type}${p.required ? ', required' : ''})`),
  ].join(', ');

  const skillMd = `---
name: ${dirName}
description: "${escapeYamlString(skill.description)}"
metadata:
  author: ""
  version: "0.1.0"
  source: "api-discovery"
  originalSkill: "${skill.name}"
  method: "${skill.method}"
  pathname: "${skill.pathname}"
  permissions:
${permissions.map((p) => `    - "${escapeYamlString(p)}"`).join('\n')}
---

## Instructions

Call this skill with:

- script: \"scripts/api.js\"
- args: { ${params || 'no params'} }

Auto-converted from captured API endpoint: ${skill.method} ${skill.pathname} (${skill.hostname})
`;

  await vfs.mkdir(scriptsDir, { recursive: true });
  await vfs.writeFile(skillMdPath, skillMd);
  await vfs.writeFile(scriptPath, skill.script);

  return { dirName, dirPath, skillMdPath, scriptPath };
}

function escapeYamlString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
