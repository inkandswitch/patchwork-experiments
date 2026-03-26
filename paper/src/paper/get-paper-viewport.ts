import type { ViewportElement } from './types.js';

export function getPaperViewport(el: HTMLElement): ViewportElement | null {
  const direct = el.closest('[data-paper-viewport]');
  if (direct) return direct as unknown as ViewportElement;
  const tool = el.closest('[data-paper-tool]');
  if (!tool) return null;
  return tool.querySelector('[data-paper-viewport]') as unknown as ViewportElement | null;
}
