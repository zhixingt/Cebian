import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatInput } from '@/components/chat/ChatInput';
import * as vfs from '@/lib/vfs';
import * as template from '@/lib/ai-config/template';
import * as scanner from '@/lib/ai-config/scanner';
import { useStorageItem } from '@/hooks/useStorageItem';
import { useRecorder } from '@/hooks/useRecorder';
import { useWebProviders } from '@/hooks/useWebProviders';
import { useMobileEmulation } from '@/hooks/useMobileEmulation';
import { recorderChannel } from '@/lib/recorder/sidepanel-channel';
import { getModel } from '@earendil-works/pi-ai';

vi.mock('@/hooks/useStorageItem');
vi.mock('@/hooks/useRecorder');
vi.mock('@/hooks/useWebProviders');
vi.mock('@/hooks/useMobileEmulation');
vi.mock('@/lib/recorder/sidepanel-channel', () => ({
  recorderChannel: {
    subscribeSession: vi.fn(() => () => {}),
  },
}));
vi.mock('@/lib/element-picker', () => ({
  startElementPicker: vi.fn(),
  cancelElementPicker: vi.fn(),
}));
vi.mock('@/lib/ai-config/scanner', () => ({
  scanPrompts: vi.fn(),
}));
// ChatInput imports getModel from @earendil-works/pi-ai to decide whether
// the active model is a reasoning model. Stub it to a no-op so the import
// resolves under vitest and the component doesn't crash on the first
// render.
vi.mock('@earendil-works/pi-ai', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-ai')>('@earendil-works/pi-ai');
  return {
    ...actual,
    getModel: vi.fn(() => ({ reasoning: false, input: [] as string[] })),
  };
});

const noopSend = vi.fn().mockResolvedValue({ status: 'dispatched' as const });

describe('ChatInput slash menu via new trigger path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default hook stubs that exercise the path used by the test.
    // useStorageItem is called for several distinct items
    // (activeModel, thinkingLevel, providerCredentials, customProviders);
    // we identify them by their `getValue` symbol/identity. Since we
    // don't have direct access to the storage items here, we just
    // always return safe defaults that satisfy both ChatInput and its
    // child ModelSelector.
    vi.mocked(useStorageItem).mockImplementation((_item: any, fallback: any) => {
      // Return a valid model so ChatInput doesn't bail into the
      // "no model" branch.
      const model = { provider: 'anthropic', modelId: 'claude-test' } as any;
      // Heuristic: if the fallback is an array, return an empty array
      // (customProviders, etc.). If it's a record-like object (provider
      // credentials), return `{}`. Otherwise return the model — most
      // other items are scalars (thinking level, max rounds, etc.) and
      // aren't read by the slash-menu path.
      if (Array.isArray(fallback)) return [fallback as any[], vi.fn()];
      if (fallback && typeof fallback === 'object') return [model, vi.fn()];
      return [fallback, vi.fn()];
    });
    vi.mocked(useRecorder).mockReturnValue({
      isOwner: false,
      truncated: undefined,
      startedAt: null,
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as any);
    vi.mocked(useWebProviders).mockReturnValue({ providers: [], isLoading: false } as any);
    vi.mocked(useMobileEmulation).mockReturnValue({
      isActiveTabMobile: false,
      toggle: vi.fn(),
    } as any);
    // Default — let individual tests override.
    vi.mocked(recorderChannel.subscribeSession).mockReturnValue(() => {});
    vi.mocked(getModel).mockReturnValue({ reasoning: false, input: [] } as any);
  });

  it('typing "/" then Enter on the first item puts resolved text in the textarea', async () => {
    vi.spyOn(vfs.vfs, 'readFile').mockResolvedValue('---\nname: alpha\n---\nHi {{name}}!');
    vi.spyOn(template, 'gatherTemplateVars').mockResolvedValue({ name: 'world' });
    vi.spyOn(template, 'replaceTemplateVars').mockImplementation((text, vars) =>
      text.replace(/\{\{(\w+)\}\}/g, (_m, k) => String((vars as any)[k] ?? '')),
    );
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([
      { fileName: 'a.md', name: 'alpha', description: '', filePath: '/prompts/a.md' },
    ]);

    render(
      <TooltipProvider>
        <ChatInput onSend={noopSend} />
      </TooltipProvider>,
    );
    const textarea = screen.getByPlaceholderText(/placeholder|type|message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '/' } });
    const item = await screen.findByText('/alpha');
    fireEvent.click(item);
    await waitFor(() => {
      expect(textarea.value).toBe('Hi world!');
    });
  });
});
