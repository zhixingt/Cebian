import { describe, it, expect, beforeEach } from 'vitest';
import { checkElementVisibility } from '@/lib/tools/element-visibility';

describe('checkElementVisibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns false for visible condition when element does not exist', () => {
    expect(checkElementVisibility({ selector: '#missing', condition: 'visible' })).toBe(false);
  });

  it('returns true for hidden condition when element does not exist', () => {
    expect(checkElementVisibility({ selector: '#missing', condition: 'hidden' })).toBe(true);
  });

  it('returns true for visible condition when element is visible', () => {
    const el = document.createElement('div');
    el.id = 'visible-el';
    el.textContent = 'hello';
    document.body.appendChild(el);
    // jsdom 中 getBoundingClientRect 默认返回 0，需要 mock
    el.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    expect(checkElementVisibility({ selector: '#visible-el', condition: 'visible' })).toBe(true);
  });

  it('returns false for visible condition when display is none', () => {
    const el = document.createElement('div');
    el.id = 'hidden-el';
    el.style.display = 'none';
    document.body.appendChild(el);
    expect(checkElementVisibility({ selector: '#hidden-el', condition: 'visible' })).toBe(false);
  });

  it('returns false for visible condition when visibility is hidden', () => {
    const el = document.createElement('div');
    el.id = 'hidden-el';
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    expect(checkElementVisibility({ selector: '#hidden-el', condition: 'visible' })).toBe(false);
  });

  it('returns false for visible condition when opacity is 0', () => {
    const el = document.createElement('div');
    el.id = 'transparent-el';
    el.style.opacity = '0';
    document.body.appendChild(el);
    expect(checkElementVisibility({ selector: '#transparent-el', condition: 'visible' })).toBe(false);
  });

  it('returns false for visible condition when element has zero size', () => {
    const el = document.createElement('div');
    el.id = 'zero-el';
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    expect(checkElementVisibility({ selector: '#zero-el', condition: 'visible' })).toBe(false);
  });

  it('returns true for hidden condition when element has zero size', () => {
    const el = document.createElement('div');
    el.id = 'zero-el';
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    expect(checkElementVisibility({ selector: '#zero-el', condition: 'hidden' })).toBe(true);
  });

  it('returns true for unknown condition regardless of visibility', () => {
    const el = document.createElement('div');
    el.id = 'el';
    document.body.appendChild(el);
    expect(checkElementVisibility({ selector: '#el', condition: 'whatever' })).toBe(true);
  });

  it('returns false when querySelector throws', () => {
    const originalQuerySelector = document.querySelector;
    document.querySelector = () => { throw new Error('DOM error'); };
    expect(checkElementVisibility({ selector: '#any', condition: 'visible' })).toBe(false);
    document.querySelector = originalQuerySelector;
  });
});
