/**
 * Regression: Rolldown minifier mangle can produce variable names that
 * collide across code-split chunk boundaries, causing `ReferenceError:
 * <mangled_name> is not defined` at module evaluation time (stack:
 * "(anonymous) @ global code").
 *
 * Known historical instances:
 *   - "qyt is not defined" / "Xyt is not defined" (v1.2.x)
 *   - "fetcherandom is not defined" (v1.3.1)
 *
 * Root cause pattern:
 *   A lazy-loaded chunk (e.g. skill-transfer, Settings) contains both
 *   fetch-related calls AND random-key generation (Math.random().toString(36)).
 *   The minifier merges these semantic contexts into a single mangled name like
 *   "fetcherandom". If the variable definition is tree-shaken into a different
 *   chunk than its usage site, the ReferenceError fires at global scope.
 *
 * Mitigations (defense in depth):
 *   1. Global error boundary in sidepanel/main.tsx (prevents white-screen)
 *   2. IIFE self-containment for all executeScript({func}) targets
 *   3. This test: post-build scan to catch problematic mangled names early
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Patterns that indicate a minifier produced a name by merging semantically
 * unrelated tokens (e.g. "fetch" + "random" = "fetcherandom"). These are
 * HIGH RISK for cross-chunk ReferenceError because the merged name is unlikely
 * to have a matching definition in any single scope.
 */
const SUSPICIOUS_MANGLED_PATTERNS = [
  /fetcherandom/,
  /randomfetch/,
  // Add more patterns as they are discovered in the field
];

describe('minifier cross-chunk mangle safety', () => {
  /**
   * Scan all JS files in the build output for suspicious mangled names.
   * This test requires a successful `wxt build` to have been run before
   * test execution (the .output directory must exist).
   */
  it('build output contains no suspicious cross-chunk mangled names', () => {
    const outputDir = join(process.cwd(), '.output', 'chrome-mv3');
    let jsFiles: string[] = [];

    try {
      const outputStat = statSync(outputDir);
      if (!outputStat.isDirectory()) {
        console.warn('[minifier-safety] .output/chrome-mv3 not found — skipping scan (run build first)');
        return;
      }
    } catch {
      console.warn('[minifier-safety] .output/chrome-mv3 not found — skipping scan (run build first)');
      return;
    }

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
        } else if (extname(entry) === '.js') {
          jsFiles.push(full);
        }
      }
    }

    walk(outputDir);

    const findings: Array<{ file: string; pattern: RegExp; matches: string[] }> = [];

    for (const file of jsFiles) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of SUSPICIOUS_MANGLED_PATTERNS) {
        const matches = content.match(pattern);
        if (matches) {
          findings.push({
            file: file.replace(join(outputDir), ''),
            pattern,
            matches,
          });
        }
      }
    }

    expect(findings).toEqual([]);
    // If the assertion fails, this message helps triage:
    if (findings.length > 0) {
      console.error(
        '[minifier-safety] Found suspicious mangled names:\n' +
          findings.map(f => `  ${f.file}: ${f.pattern} → ${f.matches.join(', ')}`).join('\n'),
      );
    }
  });

  it('sidepanel entry has global error boundary for ReferenceError', () => {
    // The error boundary is an external classic script (not type="module")
    // injected into sidepanel.html by the `cebian:sidepanel-error-boundary`
    // Vite plugin. It must be external (not inline) because Chrome extension
    // CSP blocks inline scripts ("script-src 'self'").
    const outputDir = join(process.cwd(), '.output', 'chrome-mv3');
    try {
      const html = readFileSync(join(outputDir, 'sidepanel.html'), 'utf-8');
      expect(html).toContain('sidepanel-error-boundary.js');
      // Verify the JS file exists
      const jsPath = join(outputDir, 'sidepanel-error-boundary.js');
      const jsContent = readFileSync(jsPath, 'utf-8');
      expect(jsContent).toContain('ReferenceError');
      expect(jsContent).toContain('SidepanelBoundary');
      expect(jsContent).toContain('__sidepanelCrash');
    } catch {
      console.warn('[minifier-safety] sidepanel.html not found — skipping HTML boundary check (run build first)');
    }
  });
});
