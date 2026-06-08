import { vfs } from '@/lib/vfs';
import { parseFrontmatter } from '@/lib/frontmatter';
import { CEBIAN_PROMPTS_DIR } from '@/lib/constants';
import {
  replaceTemplateVars,
  gatherTemplateVars,
} from '@/lib/ai-config/template';
import type { PromptMeta } from '@/lib/ai-config/scanner';
import { t } from '@/lib/i18n';

interface ToastLike {
  error: (msg: string) => void;
  info: (msg: string) => void;
  success: (msg: string) => void;
}

export interface TriggerSlashPromptDeps {
  toast: ToastLike;
  /** Receives the resolved text to load into the composer. */
  onLoaded: (text: string) => void;
}

/**
 * Build a function that triggers a slash-prompt: read the file, apply
 * template variables, and hand the result to `onLoaded`. The same code
 * path is used by the ChatInput slash menu and the QuickActionsBar
 * buttons — keeping them in sync by construction.
 */
export function makeTriggerSlashPrompt(
  deps: TriggerSlashPromptDeps,
): (prompt: PromptMeta) => Promise<void> {
  return async (prompt: PromptMeta) => {
    try {
      const raw = await vfs.readFile(`${CEBIAN_PROMPTS_DIR}/${prompt.fileName}`, 'utf8');
      const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
      const { body } = parseFrontmatter(content);
      const vars = await gatherTemplateVars();
      const replaced = replaceTemplateVars(body.trim(), vars);
      deps.onLoaded(replaced);
    } catch {
      deps.toast.error(t('chat.composer.readPromptFailed'));
    }
  };
}
