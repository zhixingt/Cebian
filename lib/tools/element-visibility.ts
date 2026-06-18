/**
 * 检查 DOM 元素是否可见，用于 interact sequence 的 condition 判断。
 * 此函数设计为可注入页面执行，也可在测试环境中直接调用。
 */

export interface VisibilityCheckArgs {
  selector: string;
  condition: 'visible' | 'hidden' | string;
}

/**
 * 检查元素可见性。
 * @returns condition 为 'visible' 时返回元素是否可见；
 *          condition 为 'hidden' 时返回元素是否不可见；
 *          其他 condition 一律返回 true（不过滤）。
 */
export function checkElementVisibility(args: VisibilityCheckArgs): boolean {
  try {
    const el = document.querySelector<HTMLElement>(args.selector);
    if (!el) {
      // 元素不存在：visible 条件不满足，hidden 条件满足
      return args.condition !== 'visible';
    }
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // 综合可见性检查：尺寸、display、visibility、opacity
    const isVisible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0';
    if (args.condition === 'visible') return isVisible;
    if (args.condition === 'hidden') return !isVisible;
    return true;
  } catch {
    return false;
  }
}
