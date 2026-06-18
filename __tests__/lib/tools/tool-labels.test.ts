import { describe, expect, it } from 'vitest';
import { getToolLabel } from '@/lib/tools/tool-labels';

describe('getToolLabel', () => {
  it('returns raw name for unknown tools', () => {
    expect(getToolLabel('unknown_tool', {})).toBe('unknown_tool');
  });

  it('formats mcp tools', () => {
    expect(getToolLabel('mcp__my_server__myTool', {})).toBe('tools.mcpCall');
  });

  it('formats mcp tool with missing separator', () => {
    expect(getToolLabel('mcp__incomplete', {})).toBe('mcp__incomplete');
  });

  it('formats read_page with mode', () => {
    expect(getToolLabel('read_page', { mode: 'markdown' })).toBe('tools.readPage');
  });

  it('formats read_page with selector', () => {
    expect(getToolLabel('read_page', { mode: 'html', selector: '#main' })).toBe('tools.readPage');
  });

  it('formats execute_js', () => {
    expect(getToolLabel('execute_js', {})).toBe('tools.executeJs');
  });

  it('formats screenshot', () => {
    expect(getToolLabel('screenshot', {})).toBe('tools.screenshot');
  });

  it('formats ask_user', () => {
    expect(getToolLabel('ask_user', {})).toBe('tools.askUser');
  });

  it('formats run_skill', () => {
    expect(getToolLabel('run_skill', { skill: 'my-skill' })).toBe('tools.runSkill');
  });

  // fs tools
  it('formats fs_create_file', () => {
    expect(getToolLabel('fs_create_file', { path: '/tmp/foo.ts' })).toBe('tools.fs.createFile');
  });

  it('formats fs_edit_file', () => {
    expect(getToolLabel('fs_edit_file', { path: '/tmp/foo.ts' })).toBe('tools.fs.editFile');
  });

  it('formats fs_mkdir', () => {
    expect(getToolLabel('fs_mkdir', { path: '/tmp/dir' })).toBe('tools.fs.mkdir');
  });

  it('formats fs_rename', () => {
    expect(getToolLabel('fs_rename', { old_path: '/tmp/a' })).toBe('tools.fs.rename');
  });

  it('formats fs_delete', () => {
    expect(getToolLabel('fs_delete', { path: '/tmp/a' })).toBe('tools.fs.delete');
  });

  it('formats fs_read_file', () => {
    expect(getToolLabel('fs_read_file', { path: '/tmp/a' })).toBe('tools.fs.readFile');
  });

  it('formats fs_list', () => {
    expect(getToolLabel('fs_list', { path: '/tmp' })).toBe('tools.fs.list');
  });

  it('formats fs_search content mode', () => {
    expect(getToolLabel('fs_search', { mode: 'content', pattern: 'foo' })).toBe('tools.fs.searchContent');
  });

  it('formats fs_search files mode', () => {
    expect(getToolLabel('fs_search', { mode: 'files', pattern: '*.ts' })).toBe('tools.fs.searchFiles');
  });

  it('formats fs_save_url', () => {
    expect(getToolLabel('fs_save_url', { dest: '/tmp/out.zip' })).toBe('tools.fs.saveUrl');
  });

  // chrome_api
  it('formats chrome_api help', () => {
    expect(getToolLabel('chrome_api', { namespace: 'help' })).toBe('tools.chromeApi.help');
  });

  it('formats chrome_api call', () => {
    expect(getToolLabel('chrome_api', { namespace: 'tabs', method: 'create' })).toBe('tools.chromeApi.call');
  });

  // interact actions
  it('formats interact click', () => {
    expect(getToolLabel('interact', { action: 'click', selector: '#btn' })).toBe('tools.interact.click');
  });

  it('formats interact dblclick', () => {
    expect(getToolLabel('interact', { action: 'dblclick' })).toBe('tools.interact.dblclick');
  });

  it('formats interact rightclick', () => {
    expect(getToolLabel('interact', { action: 'rightclick' })).toBe('tools.interact.rightclick');
  });

  it('formats interact hover', () => {
    expect(getToolLabel('interact', { action: 'hover' })).toBe('tools.interact.hover');
  });

  it('formats interact focus', () => {
    expect(getToolLabel('interact', { action: 'focus' })).toBe('tools.interact.focus');
  });

  it('formats interact type', () => {
    expect(getToolLabel('interact', { action: 'type' })).toBe('tools.interact.type');
  });

  it('formats interact clear', () => {
    expect(getToolLabel('interact', { action: 'clear' })).toBe('tools.interact.clear');
  });

  it('formats interact select', () => {
    expect(getToolLabel('interact', { action: 'select' })).toBe('tools.interact.select');
  });

  it('formats interact scroll', () => {
    expect(getToolLabel('interact', { action: 'scroll' })).toBe('tools.interact.scroll');
  });

  it('formats interact keypress', () => {
    expect(getToolLabel('interact', { action: 'keypress', key: 'Enter' })).toBe('tools.interact.keypress');
  });

  it('formats interact wait', () => {
    expect(getToolLabel('interact', { action: 'wait' })).toBe('tools.interact.wait');
  });

  it('formats interact wait_hidden', () => {
    expect(getToolLabel('interact', { action: 'wait_hidden' })).toBe('tools.interact.waitHidden');
  });

  it('formats interact wait_navigation', () => {
    expect(getToolLabel('interact', { action: 'wait_navigation' })).toBe('tools.interact.waitNavigation');
  });

  it('formats interact sequence', () => {
    expect(getToolLabel('interact', { action: 'sequence', steps: [1, 2, 3] })).toBe('tools.interact.sequence');
  });

  it('formats interact unknown', () => {
    expect(getToolLabel('interact', { action: 'shake' })).toBe('tools.interact.unknown');
  });

  // inspect
  it('formats inspect selector', () => {
    expect(getToolLabel('inspect', { selector: '#app' })).toBe('tools.inspect.selector');
  });

  it('formats inspect text', () => {
    expect(getToolLabel('inspect', { text: 'Hello world' })).toBe('tools.inspect.text');
  });

  it('formats inspect page', () => {
    expect(getToolLabel('inspect', {})).toBe('tools.inspect.page');
  });

  // tab
  it('formats tab open', () => {
    expect(getToolLabel('tab', { action: 'open' })).toBe('tools.tab.open');
  });

  it('formats tab close', () => {
    expect(getToolLabel('tab', { action: 'close', tabId: 42 })).toBe('tools.tab.close');
  });

  it('formats tab switch', () => {
    expect(getToolLabel('tab', { action: 'switch', tabId: 1 })).toBe('tools.tab.switch');
  });

  it('formats tab reload', () => {
    expect(getToolLabel('tab', { action: 'reload' })).toBe('tools.tab.reload');
  });

  it('formats tab list_frames', () => {
    expect(getToolLabel('tab', { action: 'list_frames' })).toBe('tools.tab.listFrames');
  });

  it('formats tab unknown', () => {
    expect(getToolLabel('tab', { action: 'focus' })).toBe('tools.tab.unknown');
  });

  // pdf
  it('formats pdf info', () => {
    expect(getToolLabel('pdf', { action: 'info' })).toBe('tools.pdf.info');
  });

  it('formats pdf read', () => {
    expect(getToolLabel('pdf', { action: 'read', pageRange: '1-5' })).toBe('tools.pdf.read');
  });

  it('formats pdf search', () => {
    expect(getToolLabel('pdf', { action: 'search', query: 'foo' })).toBe('tools.pdf.search');
  });

  it('formats pdf unknown', () => {
    expect(getToolLabel('pdf', { action: 'delete' })).toBe('tools.pdf.unknown');
  });

  it('formats tab close without tabId', () => {
    expect(getToolLabel('tab', { action: 'close' })).toBe('tools.tab.close');
  });

  it('formats pdf read without pageRange', () => {
    expect(getToolLabel('pdf', { action: 'read' })).toBe('tools.pdf.read');
  });

  it('formats pdf search with non-string query', () => {
    expect(getToolLabel('pdf', { action: 'search', query: 123 })).toBe('tools.pdf.search');
  });
});
