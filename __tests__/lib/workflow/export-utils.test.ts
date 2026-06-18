/**
 * Workflow Export 工具函数单元测试
 *
 * 覆盖 buildExportData、formatExportData、interpolateExportFilename、dataUrlFromText。
 */

import { describe, it, expect } from 'vitest';
import {
  buildExportData,
  formatExportData,
  interpolateExportFilename,
  dataUrlFromText,
} from '@/lib/workflow/export-utils';

// ─── buildExportData ───

describe('buildExportData', () => {
  it('返回指定键的数据', () => {
    const vars = { a: '1', b: '2', c: '3' };
    expect(buildExportData(vars, ['a', 'c'])).toEqual({ a: '1', c: '3' });
  });

  it('自动排除内置变量', () => {
    const vars = { today: '2024-01-01', timestamp: '123', user: 'Alice', year: '2024' };
    expect(buildExportData(vars)).toEqual({ user: 'Alice' });
  });

  it('未指定键且无非内置变量时返回空对象', () => {
    const vars = { today: '2024-01-01', date: '01-01' };
    expect(buildExportData(vars)).toEqual({});
  });

  it('跳过 vars 中不存在的键', () => {
    const vars = { a: '1' };
    expect(buildExportData(vars, ['a', 'b'])).toEqual({ a: '1' });
  });
});

// ─── formatExportData ───

describe('formatExportData', () => {
  it('clipboard 格式：键值对文本', () => {
    const data = { name: 'Alice', age: '30' };
    const result = formatExportData(data, 'clipboard');
    expect(result).toBe('name: Alice\nage: 30');
  });

  it('csv 格式：逗号分隔，值中的引号转义', () => {
    const data = { name: 'Alice', quote: 'say "hello"' };
    const result = formatExportData(data, 'csv');
    expect(result).toBe('name,quote\n"Alice","say ""hello"""');
  });

  it('csv 格式空数据：只有空行', () => {
    const result = formatExportData({}, 'csv');
    expect(result).toBe('\n');
  });

  it('json 格式：美化输出', () => {
    const data = { name: 'Alice' };
    const result = formatExportData(data, 'json');
    expect(result).toBe(JSON.stringify(data, null, 2));
  });

  it('未知 destination 抛出错误', () => {
    expect(() => formatExportData({}, 'unknown' as any)).toThrow('Unknown export destination');
  });
});

// ─── interpolateExportFilename ───

describe('interpolateExportFilename', () => {
  it('替换 {{variable}} 为对应值', () => {
    const vars = { date: '2024-01-01', name: 'products' };
    expect(interpolateExportFilename('{{name}}-{{date}}.csv', vars)).toBe('products-2024-01-01.csv');
  });

  it('不存在的变量保留原样', () => {
    expect(interpolateExportFilename('{{missing}}.json', {})).toBe('{{missing}}.json');
  });

  it('无模板时原样返回', () => {
    expect(interpolateExportFilename('static.txt', { a: '1' })).toBe('static.txt');
  });
});

// ─── dataUrlFromText ───

describe('dataUrlFromText', () => {
  it('生成正确的 data URL', () => {
    const url = dataUrlFromText('hello', 'text/plain');
    expect(url).toMatch(/^data:text\/plain;base64,/);
    const base64 = url.replace(/^data:text\/plain;base64,/, '');
    expect(atob(base64)).toBe('hello');
  });

  it('处理 Unicode 字符', () => {
    const url = dataUrlFromText('中文', 'text/plain');
    const base64 = url.replace(/^data:text\/plain;base64,/, '');
    expect(decodeURIComponent(escape(atob(base64)))).toBe('中文');
  });
});
