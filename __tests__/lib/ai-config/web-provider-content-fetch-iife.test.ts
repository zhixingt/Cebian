/**
 * Regression: content-fetch adapter functions are passed to
 * `chrome.scripting.executeScript({func})` which serializes them via
 * `Function.prototype.toString()`. **Module-scope constants are NOT captured**
 * by that serialization — only the function body is. So if the function
 * references any module-scope const, it becomes `undefined` in the MAIN
 * world → runtime `ReferenceError` (e.g. "qyt is not defined" after minify).
 *
 * This file pins the invariant: every module-scope const that the adapter
 * function references MUST also be declared INSIDE the function body.
 *
 * Historical bug: ADAPTER_TIMEOUT_MS was at module scope, referenced inside
 * the function body. Worked when the bundle inlined everything (build-time
 * tree-shake erased the module boundary), but failed when minification
 * preserved the module boundary. Symptom in the field: chat was broken
 * with "qyt is not defined" / "Xyt is not defined".
 *
 * If you add a new module-scope constant, also add the const declaration
 * inside the IIFE work function (or move the constant inside the export
 * function).
 */
import { describe, it, expect } from 'vitest';
import { glmMainWorldFetch } from '@/lib/ai-config/web-provider-content-fetch-glm';

describe('content-fetch adapter IIFE serialization invariant', () => {
  it('glmMainWorldFetch is self-contained (no module-scope references survive Function.toString serialization)', () => {
    const src = glmMainWorldFetch.toString();
    // Extract the function body (between the first { and the last })
    const bodyStart = src.indexOf('{') + 1;
    const bodyEnd = src.lastIndexOf('}');
    const fnBody = src.substring(bodyStart, bodyEnd);

    // The constant must be DECLARED inside the function body. If it's only
    // at module scope, the function body would only contain a *reference*,
    // not the `const ADAPTER_TIMEOUT_MS = 90_000;` declaration.
    //
    // Note: the minifier may rewrite `90_000` to `9e4` (scientific notation),
    // so accept either form.
    expect(fnBody).toMatch(/const\s+ADAPTER_TIMEOUT_MS\s*=\s*(?:90_?000|9e4)/);
  });
});
