import { describe, expect, it } from 'vitest';
import { uiToolRegistry } from '@/lib/tools/ui-registry';

// Create a fresh registry for each test to avoid singleton pollution
function createRegistry() {
  // Use the class directly if we could import it; since it's not exported,
  // we test the singleton but clean it up between tests.
  return uiToolRegistry;
}

describe('UIToolRegistry', () => {
  it('returns undefined for unregistered tools', () => {
    expect(uiToolRegistry.get('nonexistent')).toBeUndefined();
  });

  it('registers and retrieves a tool', () => {
    const name = 'test-tool-' + Date.now();
    const Component = () => null;
    uiToolRegistry.register({ name, Component });
    const got = uiToolRegistry.get(name);
    expect(got).toBeDefined();
    expect(got!.name).toBe(name);
    expect(got!.Component).toBe(Component);
  });

  it('overwrites on duplicate registration', () => {
    const name = 'dup-tool-' + Date.now();
    const C1 = () => null;
    const C2 = () => null;
    uiToolRegistry.register({ name, Component: C1 });
    uiToolRegistry.register({ name, Component: C2 });
    expect(uiToolRegistry.get(name)!.Component).toBe(C2);
  });

  it('getAll returns registered tools', () => {
    const before = uiToolRegistry.getAll().length;
    const name = 'all-tool-' + Date.now();
    uiToolRegistry.register({ name, Component: () => null });
    const after = uiToolRegistry.getAll().length;
    expect(after).toBe(before + 1);
    expect(uiToolRegistry.getAll().some(t => t.name === name)).toBe(true);
  });
});
