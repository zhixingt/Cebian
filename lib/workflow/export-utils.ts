/**
 * Workflow Export 工具函数
 *
 * 将 export 步骤中的数据构建、格式化、文件名插值等纯逻辑
 * 提取为可独立测试的函数，便于在 Service Worker / 前端上下文中复用。
 */

/**
 * 根据变量和指定键列表构建导出数据。
 * 若未指定键列表，自动排除内置变量（today, timestamp 等）。
 */
export function buildExportData(
  vars: Record<string, string>,
  exportKeys?: string[],
): Record<string, string> {
  const keys = exportKeys ?? Object.keys(vars).filter((k) => !['today', 'timestamp', 'date', 'year', 'month', 'day'].includes(k));
  const data: Record<string, string> = {};
  for (const k of keys) {
    if (vars[k] !== undefined) data[k] = vars[k];
  }
  return data;
}

/**
 * 将导出数据格式化为目标格式的文本内容。
 */
export function formatExportData(
  data: Record<string, string>,
  destination: 'clipboard' | 'csv' | 'json',
): string {
  switch (destination) {
    case 'clipboard': {
      return Object.entries(data)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    }

    case 'csv': {
      const rows = Object.entries(data);
      const header = rows.map(([k]) => k).join(',');
      const body = rows.map(([, v]) => `"${String(v).replace(/"/g, '""')}"`).join(',');
      return `${header}\n${body}`;
    }

    case 'json': {
      return JSON.stringify(data, null, 2);
    }

    default:
      throw new Error(`Unknown export destination: ${destination}`);
  }
}

/**
 * 文件名模板插值，支持 {{variable}} 语法。
 */
export function interpolateExportFilename(
  filename: string,
  vars: Record<string, string>,
): string {
  return filename.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/**
 * 将文本转为 Base64 Data URL。
 * 兼容浏览器和 Node.js（测试环境）上下文。
 */
export function dataUrlFromText(text: string, mimeType: string): string {
  const encoded = typeof Buffer !== 'undefined'
    ? Buffer.from(text).toString('base64')
    : btoa(unescape(encodeURIComponent(text)));
  return `data:${mimeType};base64,${encoded}`;
}
