import { z } from 'https://esm.sh/zod@4.3';

const FrameSchema = z.object({});

export const schema = {
  init() {
    return FrameSchema.parse({});
  },
  parse(value) {
    return FrameSchema.parse(value);
  },
};

/**
 * @param {HTMLElement} element — <ref-view> host (use element.ref for data access)
 * @returns {() => void}
 */
export default function mount(element) {
  const div = document.createElement('div');
  div.textContent = 'hello world';
  div.style.cssText =
    'font-family: system-ui, sans-serif; font-size: 1rem; padding: 0.75rem; color: #18181b;';
  element.appendChild(div);
  return () => div.remove();
}
