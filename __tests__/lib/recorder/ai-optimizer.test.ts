import { describe, it, expect } from 'vitest';
import { analyzeOptimizations } from '@/lib/recorder/ai-optimizer';
import type { SequenceStep } from '@/lib/recorder/session-to-sequence';

function makeStep(overrides: Partial<SequenceStep> = {}): SequenceStep {
  return {
    action: 'click',
    selector: '#btn',
    timeout: 5000,
    deltaX: undefined,
    deltaY: undefined,
    key: undefined,
    modifiers: undefined,
    text: undefined,
    ...overrides,
  } as SequenceStep;
}

describe('analyzeOptimizations', () => {
  it('returns empty array for empty steps', () => {
    expect(analyzeOptimizations([])).toEqual([]);
  });

  it('detects fixed date in type step', () => {
    const steps = [
      makeStep({ action: 'type', selector: '#date', text: '2024-01-15' }),
    ];
    const opts = analyzeOptimizations(steps);
    expect(opts.length).toBeGreaterThanOrEqual(1);
    const dateOpt = opts.find((o) => o.type === 'replace_date');
    expect(dateOpt).toBeDefined();
    expect(dateOpt!.stepIndices).toContain(0);

    // 验证应用效果
    const applied = dateOpt!.apply(steps);
    expect((applied[0] as any).text).toBe('{{today}}');
  });

  it('detects email in type step', () => {
    const steps = [
      makeStep({ action: 'type', selector: '#email', text: 'test@example.com' }),
    ];
    const opts = analyzeOptimizations(steps);
    const emailOpt = opts.find((o) => o.type === 'parametrize_input');
    expect(emailOpt).toBeDefined();
    expect(emailOpt!.title).toContain('邮箱');

    const applied = emailOpt!.apply(steps);
    expect((applied[0] as any).text).toBe('{{email}}');
  });

  it('detects missing wait after download click', () => {
    const steps = [
      makeStep({ action: 'click', selector: 'button:contains("下载")' }),
      makeStep({ action: 'click', selector: '#other' }),
    ];
    const opts = analyzeOptimizations(steps);
    const waitOpt = opts.find((o) => o.type === 'add_wait_after_action');
    expect(waitOpt).toBeDefined();

    const applied = waitOpt!.apply(steps);
    expect(applied[1].action).toBe('wait');
    expect(applied[1].timeout).toBe(3000);
  });

  it('detects missing wait_navigation after link click', () => {
    const steps = [
      makeStep({ action: 'click', selector: 'a[href="/next"]' }),
      makeStep({ action: 'click', selector: '#btn' }),
    ];
    const opts = analyzeOptimizations(steps);
    const navOpt = opts.find((o) => o.type === 'add_wait_after_navigation');
    expect(navOpt).toBeDefined();

    const applied = navOpt!.apply(steps);
    expect(applied[1].action).toBe('wait_navigation');
  });

  it('detects repeated clicks', () => {
    const steps = [
      makeStep({ action: 'click', selector: '#load-more' }),
      makeStep({ action: 'click', selector: '#load-more' }),
      makeStep({ action: 'click', selector: '#load-more' }),
      makeStep({ action: 'click', selector: '#load-more' }),
    ];
    const opts = analyzeOptimizations(steps);
    const repeatOpt = opts.find((o) => o.type === 'merge_repeated_clicks');
    expect(repeatOpt).toBeDefined();

    const applied = repeatOpt!.apply(steps);
    expect(applied.length).toBeLessThan(steps.length);
  });

  it('does not suggest wait after click when next step is already wait', () => {
    const steps = [
      makeStep({ action: 'click', selector: 'button:contains("提交")' }),
      makeStep({ action: 'wait', timeout: 1000 }),
    ];
    const opts = analyzeOptimizations(steps);
    const waitOpt = opts.find((o) => o.type === 'add_wait_after_action');
    expect(waitOpt).toBeUndefined();
  });

  it('applies multiple suggestions independently', () => {
    const steps = [
      makeStep({ action: 'type', selector: '#date', text: '2024-06-17' }),
      makeStep({ action: 'click', selector: 'button:contains("导出")' }),
      makeStep({ action: 'click', selector: '#btn' }),
    ];
    const opts = analyzeOptimizations(steps);
    expect(opts.length).toBeGreaterThanOrEqual(2);

    // 依次应用
    let current = steps;
    for (const opt of opts) {
      current = opt.apply(current);
    }
    expect(current.length).not.toBe(steps.length);
  });
});
