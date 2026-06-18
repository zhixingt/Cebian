/**
 * DOM Trigger Content Script
 *
 * Automatically injected into every web page. Maintains a lightweight
 * MutationObserver that watches for elements matching selectors registered
 * by workflow DOM triggers. When a match appears, it notifies the background
 * to execute the associated workflow.
 */

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',

  main() {
    let activeSelectors = new Map<string, string>(); // selector -> workflowId
    let observer: MutationObserver | null = null;

    // ─── Sync triggers from background ────────────────────────────────

    async function syncTriggers(): Promise<void> {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'get_dom_triggers' });
        const triggers = (res?.triggers ?? []) as Array<{ selector: string; workflowId: string }>;
        activeSelectors = new Map(triggers.map((t) => [t.selector, t.workflowId]));
        updateObserver();
      } catch {
        // Background may not be ready yet; observer stays idle.
      }
    }

    // ─── Observe / re-observe ─────────────────────────────────────────

    function updateObserver(): void {
      if (observer) {
        observer.disconnect();
        observer = null;
      }

      const selectors = Array.from(activeSelectors.keys());
      if (selectors.length === 0) return;

      // Immediate check: element may already be in the DOM.
      checkSelectors(selectors);

      observer = new MutationObserver(() => {
        checkSelectors(selectors);
      });

      // Observe the entire document subtree.
      observer.observe(document.body, { childList: true, subtree: true });
    }

    function checkSelectors(selectors: string[]): void {
      for (const selector of selectors) {
        if (document.querySelector(selector)) {
          const workflowId = activeSelectors.get(selector);
          if (!workflowId) continue;

          // Fire once per selector per page load.
          activeSelectors.delete(selector);

          try {
            chrome.runtime.sendMessage({
              type: 'dom_trigger_fired',
              workflowId,
              selector,
              url: location.href,
            });
          } catch {
            // ignore
          }

          // If no selectors remain, disconnect observer to save resources.
          if (activeSelectors.size === 0 && observer) {
            observer.disconnect();
            observer = null;
          }
          break;
        }
      }
    }

    // ─── Listen for background-driven updates ─────────────────────────

    function onMessage(msg: unknown): void {
      if (typeof msg !== 'object' || msg === null) return;
      const m = msg as Record<string, unknown>;
      if (m.type === 'dom_triggers_updated') {
        void syncTriggers();
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);

    // ─── Init ─────────────────────────────────────────────────────────

    void syncTriggers();

    // Re-sync when the page becomes visible again (SW may have restarted).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void syncTriggers();
      }
    });
  },
});
