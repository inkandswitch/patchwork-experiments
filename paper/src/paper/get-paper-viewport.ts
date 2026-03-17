import type { ViewportElement } from './types.js';

export function getPaperViewport(el: HTMLElement): ViewportElement | null {
  let current: HTMLElement | null = el.parentElement;
  while (current) {
    if (typeof (current as any).getCamera === 'function') {
      return current as unknown as ViewportElement;
    }
    current = current.parentElement;
  }
  return null;
}
