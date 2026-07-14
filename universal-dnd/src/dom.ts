/**
 * Minimal, inlined copy of the `@inkandswitch/edge-handles/dom` discovery
 * helpers. Inlined (rather than imported) because edge-handles is NOT in the
 * platform import map, and these are a handful of attribute reads anyway. The
 * attribute conventions match the platform's so existing tooling stays
 * interoperable.
 */

const HANDLE_ATTRS = [
  "data-ref-url",
  "data-edge-url",
  "data-doc-url",
  "doc-url",
] as const;

/** Read a handle URL directly off an element, without walking ancestors. */
export function handleFromElement(el: Element): string | null {
  for (const attr of HANDLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) return v;
  }
  return null;
}

/** Walk up from `node` to the nearest element carrying a handle URL. */
export function closestHandle(node: Node | null): string | null {
  let el: Element | null =
    node instanceof Element ? node : (node?.parentElement ?? null);
  while (el) {
    const found = handleFromElement(el);
    if (found) return found;
    el = el.parentElement;
  }
  return null;
}
