/**
 * Default export for &lt;ref-view&gt; (see tool README). Renders mini-canvas UI for the document ref.
 *
 * @param {object} ref Ref object from `findRef` / `createRef` (`.ref()`, `.get()`, …)
 * @param {HTMLElement} element Host element (&lt;ref-view&gt;)
 * @returns {() => void}
 */
export default function mountMiniCanvasFrame(ref, element) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-canvas-root';
  const card = document.createElement('div');
  card.className = 'mini-canvas-card';
  const h1 = document.createElement('h1');
  h1.textContent = 'Hello, world';
  const p = document.createElement('p');
  const folderUrl = ref.ref('sourceFolder').get();
  p.textContent = folderUrl
    ? `sourceFolder (via ref): ${folderUrl}`
    : 'mini-canvas — empty starter tool';
  card.append(h1, p);
  wrap.appendChild(card);
  element.appendChild(wrap);
  return () => wrap.remove();
}
