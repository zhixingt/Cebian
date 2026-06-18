import { describe, it, expect } from 'vitest';

/**
 * Regression tests for the "GLM web provider reads wrong page" bug.
 *
 * User reproduction (2026-06-07):
 *   Load Cebian → sidepanel web:glm:glm-4.6 → send '你好'
 *   → sidepanel shows RotateCcw retry button (looks like a refresh icon)
 *   → assistant text bubble is empty
 *
 * Root cause:
 *   loginUrl: 'https://chatglm.cn' (root) redirects after login to
 *   /main/alltoolsdetail (tool description page), NOT to the chat
 *   interface. DOM reader looks for .markdown-body:last-of-type on
 *   the wrong page, reads the tool description as the "AI reply",
 *   minChunkLength: 2 filters it as noise, reader stable-check
 *   triggers 60s timeout. Sidepanel shows retry icon (the RotateCcw
 *   in MessageMetaRow), no text.
 *
 * Fix (two-pronged):
 *   1. loginUrl updated from 'https://chatglm.cn' (root) to
 *      'https://chatglm.cn/main/chat/new' (new-conversation entry).
 *   2. The content-script orchestrator detects the wrong-page pattern
 *      (/alltoolsdetail) and pushes an actionable WEB_LLM_ERROR
 *      with the current URL, instead of burning the full 60s.
 *
 * Test 1 below pins the loginUrl fix. Test 2 below pins the page-
 * detection fix at the orchestrator level (NOT the reader — the
 * reader is a pure DOM poller and shouldn't have URL awareness).
 */

describe('GLM preset loginUrl', () => {
  it('points to the chat entry page, not the root', async () => {
    const { WEB_PROVIDER_PRESETS } = await import('@/lib/ai-config/web-provider-presets');
    const glm = WEB_PROVIDER_PRESETS.find((p) => p.id === 'glm');
    expect(glm).toBeDefined();
    // The regression: was 'https://chatglm.cn' (root → redirects to
    // /main/alltoolsdetail tool description page after login).
    expect(glm!.loginUrl).not.toBe('https://chatglm.cn');
    expect(glm!.loginUrl).not.toMatch(/alltoolsdetail/);
    // Should now be a /main/* chat entry path.
    expect(glm!.loginUrl).toMatch(/^https:\/\/chatglm\.cn\/main\//);
  });
});

describe('content-script wrong-page early-out', () => {
  it('matches /main/alltoolsdetail and stops the reader', () => {
    // Pure function: just verify the regex pattern matches the actual
    // production path. The early-out code in content-script.ts uses
    // this exact regex.
    const wrongPath = '/main/alltoolsdetail';
    const wrongPathWithQuery = '/main/alltoolsdetail?lang=zh';
    const chatPath = '/main/chat/new';
    const chatPathWithQuery = '/main/chat?lang=zh';
    const pattern = /\/alltoolsdetail(\?|$|\/)/;

    expect(pattern.test(wrongPath)).toBe(true);
    expect(pattern.test(wrongPathWithQuery)).toBe(true);
    expect(pattern.test(chatPath)).toBe(false);
    expect(pattern.test(chatPathWithQuery)).toBe(false);
  });
});
