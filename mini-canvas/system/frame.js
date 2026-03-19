/**
 * Default export for &lt;ref-view&gt; (see system README).
 *
 * @param {object} ref — world doc root ref
 * @param {HTMLElement} element — &lt;ref-view&gt; host (`element.filesystem` for system files)
 * @returns {() => void}
 */
export default function mountMiniCanvasFrame(_ref, element) {
  const div = document.createElement('div');
  div.textContent = 'hello world';
  div.style.cssText =
    'font-family: system-ui, sans-serif; font-size: 1rem; padding: 0.75rem; color: #18181b;';
  element.appendChild(div);
  return () => div.remove();
}
