#!/usr/bin/env node
/**
 * CebianX Native Messaging Host 安装脚本
 *
 * 用法：
 *   node scripts/install-native-host.mjs --extension-id <32位Chrome扩展ID>
 *
 * 功能：
 *   - 检测操作系统（Windows/macOS/Linux）
 *   - 生成 Native Messaging Host manifest JSON
 *   - 生成启动器脚本（.cmd / .sh）
 *   - 注册到系统位置（Windows 注册表 / macOS/Linux 文件系统）
 *   - 打印安装结果和 Hermes 配置示例
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { homedir, platform } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const HOST_NAME = 'com.cebianx.mcp_host';
const NATIVE_HOST_SCRIPT = join(repoRoot, 'scripts', 'cebianx-mcp-native-host.ts');

// ─── 参数解析 ───

function parseArgs(argv) {
  const args = { extensionId: null, port: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--extension-id' || a === '-e') {
      args.extensionId = argv[++i];
    } else if (a === '--port' || a === '-p') {
      args.port = argv[++i];
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
CebianX Native Messaging Host 安装脚本

用法：
  node scripts/install-native-host.mjs --extension-id <Chrome扩展ID>

参数：
  --extension-id, -e <id>   CebianX 扩展的 32 字符 Chrome ID（必填）
  --port, -p <port>         Native Host HTTP Server 端口（默认 8788）
  --help, -h                显示帮助

示例：
  node scripts/install-native-host.mjs --extension-id abcdefghijklmnopqrstuvwxyzabcdef
`);
}

function validateExtensionId(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('扩展 ID 未提供。请使用 --extension-id 参数指定。');
  }
  // Chrome 扩展 ID 是 32 个小写字母（a-p）
  if (!/^[a-p]{32}$/.test(id)) {
    throw new Error(`扩展 ID 格式无效：${id}\nChrome 扩展 ID 应为 32 个小写字母（a-p）。`);
  }
}

// ─── 启动器脚本生成 ───

function generateLauncherWindows(hostScriptPath, port) {
  // Windows: .cmd 文件，调用 node 运行 tsx
  const portEnv = port ? `set CEBIANX_NATIVE_HOST_PORT=${port}\n` : '';
  return `@echo off
${portEnv}npx tsx "${hostScriptPath}"`;
}

function generateLauncherUnix(hostScriptPath, port) {
  // macOS/Linux: .sh 文件
  const portEnv = port ? `export CEBIANX_NATIVE_HOST_PORT=${port}\n` : '';
  return `#!/bin/bash
${portEnv}exec npx tsx "${hostScriptPath}"`;
}

// ─── 系统注册 ───

function getManifestPath() {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      // Windows 实际通过注册表指向 manifest，manifest 可放在任意位置
      return join(home, 'AppData', 'Local', 'CebianX', `${HOST_NAME}.json`);
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    case 'linux':
      return join(home, '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    default:
      throw new Error(`不支持的操作系统：${platform()}`);
  }
}

function getLauncherPath(manifestPath) {
  const dir = dirname(manifestPath);
  if (platform() === 'win32') {
    return join(dir, `${HOST_NAME}.cmd`);
  }
  return join(dir, `${HOST_NAME}.sh`);
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function registerWindows(manifestPath) {
  // 写入注册表 HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\<host_name>
  const key = `HKCU\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  try {
    execSync(`reg add "${key}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'pipe' });
    console.log(`[OK] 已写入注册表：${key}`);
  } catch (err) {
    throw new Error(`注册表写入失败：${err.message}`);
  }
}

function registerUnix(manifestPath) {
  // macOS/Linux: manifest 文件放在固定目录即可，Chrome 自动发现
  console.log(`[OK] manifest 已写入：${manifestPath}`);
}

// ─── 主流程 ───

function main() {
  const args = parseArgs(process.argv);
  validateExtensionId(args.extensionId);

  console.log('=== CebianX Native Messaging Host 安装 ===\n');
  console.log(`操作系统：${platform()}`);
  console.log(`扩展 ID：${args.extensionId}`);
  console.log(`Native Host 脚本：${NATIVE_HOST_SCRIPT}`);

  if (!existsSync(NATIVE_HOST_SCRIPT)) {
    throw new Error(`Native Host 脚本不存在：${NATIVE_HOST_SCRIPT}`);
  }

  // 1. 生成 manifest
  const manifestPath = getManifestPath();
  const launcherPath = getLauncherPath(manifestPath);
  ensureDir(manifestPath);
  ensureDir(launcherPath);

  // 2. 生成启动器
  const isWindows = platform() === 'win32';
  const launcherContent = isWindows
    ? generateLauncherWindows(NATIVE_HOST_SCRIPT, args.port)
    : generateLauncherUnix(NATIVE_HOST_SCRIPT, args.port);
  writeFileSync(launcherPath, launcherContent, 'utf8');
  if (!isWindows) {
    execSync(`chmod +x "${launcherPath}"`);
  }
  console.log(`\n[OK] 启动器已生成：${launcherPath}`);

  // 3. 生成 manifest JSON
  const manifest = {
    name: HOST_NAME,
    description: 'CebianX MCP Native Messaging Host - exposes browser automation to Hermes',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${args.extensionId}/`],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[OK] manifest 已生成：${manifestPath}`);

  // 4. 注册到系统
  console.log('\n--- 注册到系统 ---');
  if (isWindows) {
    registerWindows(manifestPath);
  } else {
    registerUnix(manifestPath);
  }

  // 5. 打印 Hermes 配置示例
  const port = args.port || '8788';
  console.log('\n=== 安装完成 ===\n');
  console.log('Hermes 配置示例（添加到 Hermes config.yaml 的 mcp.servers）：\n');
  console.log(`  cebianx:`);
  console.log(`    type: streamable-http`);
  console.log(`    url: http://127.0.0.1:${port}/mcp`);
  console.log(`    # 健康检查：http://127.0.0.1:${port}/health\n`);
  console.log('验证步骤：');
  console.log('  1. 重启 Chrome（使 manifest 生效）');
  console.log('  2. 打开 CebianX 扩展（侧边栏）');
  console.log(`  3. curl http://127.0.0.1:${port}/health  → 应返回 {"status":"ok","tools":13}`);
  console.log(`  4. curl -X POST http://127.0.0.1:${port}/mcp -H "Content-Type: application/json" -d '{"method":"tools/list"}'\n`);
}

try {
  main();
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
}
