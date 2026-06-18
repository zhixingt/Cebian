/**
 * 内置 Skill 自动部署 —— 在 Service Worker 启动时将打包的默认 skill
 * 写入 VFS（~/.cebian/skills/），供 agent 扫描和使用。
 *
 * 设计原则
 * ========
 * - 幂等：重复执行不会覆盖用户已修改的 skill（只检查 SKILL.md 是否存在）。
 * - 静默：部署失败只打 warn log，不阻断 SW 启动流程。
 * - 版本化：通过 frontmatter 中的 `metadata.builtinVersion` 标记内置版本，
 *   后续如需强制升级，可比较版本号决定覆盖策略。
 */

import { vfs } from '@/lib/vfs';
import { CEBIAN_SKILLS_DIR, SKILL_ENTRY_FILE } from '@/lib/constants';

// ─── Vite ?raw imports —— 构建时内联为字符串 ───

import browserwingSkillMd from '@/assets/skills/browserwing/SKILL.md?raw';
import browserwingApiJs from '@/assets/skills/browserwing/scripts/api.js?raw';
import browserwingBatchFillJs from '@/assets/skills/browserwing/scripts/batch-fill.js?raw';

// ─── Registry ───

interface BuiltinSkillFile {
  /** 相对于 skill 根目录的虚拟路径。 */
  relPath: string;
  /** 文件内容（UTF-8 字符串）。 */
  content: string;
}

interface BuiltinSkill {
  /** 部署到 VFS 的目录名。 */
  dirName: string;
  /** 文件列表。 */
  files: BuiltinSkillFile[];
  /** 当前内置版本号，用于未来升级判断。 */
  version: number;
}

const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    dirName: 'browserwing',
    version: 1,
    files: [
      { relPath: SKILL_ENTRY_FILE, content: browserwingSkillMd },
      { relPath: 'scripts/api.js', content: browserwingApiJs },
      { relPath: 'scripts/batch-fill.js', content: browserwingBatchFillJs },
    ],
  },
];

// ─── Deploy ───

/**
 * 检查并部署所有内置 skill。
 *
 * @returns 部署结果摘要，用于日志和调试。
 */
export async function seedBuiltinSkills(): Promise<{
  installed: string[];
  skipped: string[];
  errors: Array<{ skill: string; message: string }>;
}> {
  const installed: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ skill: string; message: string }> = [];

  for (const skill of BUILTIN_SKILLS) {
    const skillRoot = `${CEBIAN_SKILLS_DIR}/${skill.dirName}`;
    const skillMdPath = `${skillRoot}/${SKILL_ENTRY_FILE}`;

    try {
      // 幂等检查：若 SKILL.md 已存在则跳过，保护用户自定义内容
      const exists = await vfs.exists(skillMdPath);
      if (exists) {
        skipped.push(skill.dirName);
        continue;
      }

      // 创建目录
      await vfs.mkdir(skillRoot, { recursive: true });

      // 写入所有文件
      for (const file of skill.files) {
        const filePath = `${skillRoot}/${file.relPath}`;
        // 确保子目录存在（如 scripts/）
        const lastSlash = file.relPath.lastIndexOf('/');
        if (lastSlash > 0) {
          const subDir = `${skillRoot}/${file.relPath.slice(0, lastSlash)}`;
          try {
            await vfs.mkdir(subDir, { recursive: true });
          } catch { /* ignore if already exists */ }
        }
        await vfs.writeFile(filePath, file.content);
      }

      installed.push(skill.dirName);
      console.log(`[seedBuiltinSkills] installed built-in skill: ${skill.dirName} (v${skill.version})`);
    } catch (err) {
      const message = (err as Error).message || String(err);
      errors.push({ skill: skill.dirName, message });
      console.warn(`[seedBuiltinSkills] failed to install ${skill.dirName}:`, message);
    }
  }

  return { installed, skipped, errors };
}
