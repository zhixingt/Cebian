import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTriggerSlashPrompt } from '@/lib/chat/trigger-slash-prompt';
import * as vfs from '@/lib/vfs';
import * as template from '@/lib/ai-config/template';

const prompt = {
  fileName: 'a.md',
  name: 'alpha',
  description: '',
  filePath: '/prompts/a.md',
};

describe('makeTriggerSlashPrompt', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reads the file, replaces template vars, calls onLoaded, and toasts on success', async () => {
    vi.spyOn(vfs.vfs, 'readFile').mockResolvedValue(new TextEncoder().encode('---\nname: alpha\n---\nHello {{name}}!'));
    vi.spyOn(template, 'gatherTemplateVars').mockResolvedValue({ name: 'world' });
    vi.spyOn(template, 'replaceTemplateVars').mockReturnValue('Hello world!');
    const onLoaded = vi.fn();
    const toast = { error: vi.fn(), info: vi.fn(), success: vi.fn() };

    const trigger = makeTriggerSlashPrompt({ toast, onLoaded });
    await trigger(prompt);

    expect(onLoaded).toHaveBeenCalledWith('Hello world!');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts an error and does not call onLoaded when vfs.readFile throws', async () => {
    vi.spyOn(vfs.vfs, 'readFile').mockRejectedValue(new Error('not found'));
    vi.spyOn(template, 'gatherTemplateVars').mockResolvedValue({});
    const onLoaded = vi.fn();
    const toast = { error: vi.fn(), info: vi.fn(), success: vi.fn() };

    const trigger = makeTriggerSlashPrompt({ toast, onLoaded });
    await trigger(prompt);

    expect(onLoaded).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
