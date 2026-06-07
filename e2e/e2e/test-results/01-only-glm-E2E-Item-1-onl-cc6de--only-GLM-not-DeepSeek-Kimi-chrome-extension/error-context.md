# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 01-only-glm.spec.ts >> E2E Item 1: only GLM in Web Provider >> settings page lists only GLM, not DeepSeek/Kimi
- Location: e2e\specs\01-only-glm.spec.ts:27:3

# Error details

```
Error: Timed out waiting for extension service worker to register
```

```
TypeError: Cannot read properties of undefined (reading 'context')
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
  3  | 
  4  | /**
  5  |  * E2E Item 1: Web Provider section in Settings shows ONLY GLM.
  6  |  *
  7  |  * After the DeepSeek + Kimi removal, the Settings → Web Provider section
  8  |  * must not surface those providers. The test asserts the rendered
  9  |  * settings page lists only GLM.
  10 |  *
  11 |  * What this test does NOT cover:
  12 |  *   - The "available models" selector in the chat sidebar (a separate UI
  13 |  *     surface that mirrors the same preset list; covered indirectly by
  14 |  *     Item 6's data-layer assertions).
  15 |  */
  16 | test.describe('E2E Item 1: only GLM in Web Provider', () => {
  17 |   let ext: ExtensionContext;
  18 | 
  19 |   test.beforeAll(async () => {
  20 |     ext = await launchWithExtension();
  21 |   });
  22 | 
  23 |   test.afterAll(async () => {
> 24 |     await ext.context.close();
     |               ^ TypeError: Cannot read properties of undefined (reading 'context')
  25 |   });
  26 | 
  27 |   test('settings page lists only GLM, not DeepSeek/Kimi', async () => {
  28 |     const settingsUrl = `chrome-extension://${ext.extensionId}/settings.html`;
  29 |     const page = await ext.context.newPage();
  30 |     await page.goto(settingsUrl, { waitUntil: 'domcontentloaded' });
  31 |     // Wait for the Web Provider section to render
  32 |     await page.waitForLoadState('networkidle', { timeout: 15_000 });
  33 | 
  34 |     const bodyText = (await page.locator('body').innerText()).toLowerCase();
  35 |     expect(bodyText, 'settings page should be reachable').toBeTruthy();
  36 | 
  37 |     // Must mention GLM
  38 |     expect(bodyText, 'should mention GLM').toContain('glm');
  39 | 
  40 |     // Must NOT mention the removed web providers
  41 |     expect(bodyText, 'should not mention deepseek web provider').not.toContain('deepseek');
  42 |     expect(bodyText, 'should not mention kimi web provider').not.toContain('kimi');
  43 |   });
  44 | });
  45 | 
```