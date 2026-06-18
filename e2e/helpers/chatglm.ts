import type { Page } from '@playwright/test';

/**
 * chatglm.cn helpers.
 *
 * Item 3 (send + receive) and Item 4 (multi-turn) need the user to be
 * logged in to chatglm.cn. Since the harness cannot enter a password or
 * solve a captcha, the workflow is:
 *   1. The spec calls `openChatglmTab` and shows the user the page.
 *   2. The spec calls `awaitUserLogin` which polls for the logged-in
 *      signal (e.g. a known cookie set, or the absence of the login
 *      button) for up to 5 minutes.
 *   3. Once the user is logged in, the spec proceeds.
 *
 * The polling logic intentionally does not detect specific UI changes
 * (chatglm.cn is a real production site that may update its UI at any
 * time). Instead it waits for the chat input to be enabled, which is a
 * strong signal that the user is past the login screen.
 */

const CHAT_INPUT_SELECTORS = [
  // Most common: a textarea inside the chat panel
  'textarea[placeholder*="请输入"]',
  'textarea[placeholder*="Send"]',
  'textarea[placeholder*="Message"]',
  // Fallback: contenteditable editor
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
];

/**
 * Wait until the user is logged in to chatglm.cn, indicated by the chat
 * input becoming available and not disabled.
 *
 * @param page chatglm.cn tab
 * @param timeoutMs total wait time (default 5 min)
 */
export async function awaitUserLogin(
  page: Page,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  const start = Date.now();
  let lastErr: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      for (const sel of CHAT_INPUT_SELECTORS) {
        const input = page.locator(sel).first();
        const count = await input.count();
        if (count === 0) continue;
        const isVisible = await input.isVisible().catch(() => false);
        if (!isVisible) continue;
        const isDisabled = await input.isDisabled().catch(() => true);
        if (isDisabled) continue;
        // Found a visible, enabled input — user is logged in
        return;
      }
    } catch (e) {
      lastErr = e as Error;
    }
    await page.waitForTimeout(2_000);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for user to log in to chatglm.cn.\n` +
    `Last error: ${lastErr?.message ?? '(none)'}\n` +
    `Please log in to the chatglm.cn tab opened by the test, then wait.`,
  );
}

/**
 * Type a message into the chat input and submit it. Returns when the
 * send button is clicked.
 */
export async function sendMessage(page: Page, text: string): Promise<void> {
  // Find the first visible, enabled input
  let input: ReturnType<Page['locator']> | null = null;
  for (const sel of CHAT_INPUT_SELECTORS) {
    const candidate = page.locator(sel).first();
    if ((await candidate.count()) > 0 && (await candidate.isVisible())) {
      input = candidate;
      break;
    }
  }
  if (!input) {
    throw new Error('Could not find chat input on chatglm.cn');
  }
  await input.fill(text);
  // Try to find a send button. chatglm.cn's selector may vary; use a
  // broad fallback. If the Enter key works, prefer that.
  const sendButton = page.locator('button[aria-label*="发送"], button[aria-label*="Send"]').first();
  if ((await sendButton.count()) > 0) {
    await sendButton.click();
  } else {
    await input.press('Enter');
  }
}

/**
 * Wait for an assistant reply to appear in the chat. The selector is
 * intentionally broad because chatglm.cn wraps replies in different
 * containers. We just look for the user's text to be followed by a
 * non-empty reply.
 */
export async function waitForAssistantReply(
  page: Page,
  userText: string,
  timeoutMs = 60_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Look for a message block that contains the user's text and is
    // followed by another message block. The reply text is in the block
    // AFTER the user's text.
    const found = await page.evaluate((needle: string) => {
      // Heuristic: find any element whose innerText includes the user's
      // text, then return the innerText of the next sibling-ish message.
      const all = Array.from(document.querySelectorAll('div, p, span, article'));
      for (const el of all) {
        const t = (el.textContent ?? '').trim();
        if (t.includes(needle) && t.length < needle.length + 5) {
          // Walk forward in DOM to find the next message container
          let n: Element | null = el.nextElementSibling;
          let steps = 0;
          while (n && steps < 5) {
            const nt = (n.textContent ?? '').trim();
            if (nt && nt !== needle && nt.length > 5) return nt;
            n = n.nextElementSibling;
            steps += 1;
          }
        }
      }
      return null;
    }, userText);
    if (found && found.length > 0) {
      return found;
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for assistant reply`);
}
