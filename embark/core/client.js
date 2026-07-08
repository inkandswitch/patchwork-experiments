// The context-store client for bundleless cards. Hand-written plain JS with no
// imports: everything here talks to the store through its structural surface —
// the discovery event name, the body-store symbol — so this module works from
// any bundle or none. Cards import this file by the core package's automerge
// URL instead of inlining the boilerplate.
//
// The store itself (createContextStore) lives in context/store/src/context.ts
// and is provided by the environment; this file only finds it and adapts it.

const CONTEXT_REQUEST = "patchwork:context-request";
const BODY_STORE_KEY = Symbol.for("patchwork.context-store.v1");

/**
 * One-shot synchronous lookup: dispatch a discovery request from `node`, and
 * return whatever a `<patchwork-context>` host wrote into the event detail —
 * or the page-global body store when nothing answered.
 * @param {Node} node
 */
export function findContextStore(node) {
  const request = new CustomEvent(CONTEXT_REQUEST, {
    bubbles: true,
    composed: true,
    detail: {},
  });
  node.dispatchEvent(request);
  return request.detail.store ?? document.body[BODY_STORE_KEY];
}

/**
 * Node-relative subscribe: resolve the store from `node`, deliver the current
 * value once (asynchronously, to avoid re-entrancy during setup), then notify
 * on every change. Returns the unsubscribe function.
 * @param {Node} node
 * @param {{ name: string, empty: object }} channel
 * @param {(value: object) => void} cb
 * @param {string[]} [keys] declared key interest, for attribution and
 *   reader-registry-as-request channels (e.g. schema:matches)
 */
export function subscribeContext(node, channel, cb, keys) {
  const store = findContextStore(node);
  let delivered = false;
  const wrapped = (value) => {
    delivered = true;
    cb(value);
  };
  const unsubscribe = store.subscribe(channel, wrapped, {
    owner: requireOwner(node),
    keys,
  });
  queueMicrotask(() => {
    if (!delivered) wrapped(store.read(channel));
  });
  return unsubscribe;
}

/**
 * Node-relative writer handle: resolve the store from `node` and hand back a
 * fresh scope to write into, attributed to the embed `node` lives in. Call
 * `.change(slice => …)` to write and `.release()` in cleanup.
 * @param {Node} node
 * @param {{ name: string, empty: object }} channel
 */
export function getContextHandle(node, channel) {
  return findContextStore(node).handle(channel, requireOwner(node));
}

/**
 * The embed/document `element` lives in, read structurally from the DOM
 * (`<patchwork-view doc-url tool-id>` and `[data-embed-id]`). Fields are
 * `undefined` when absent — unlike `requireOwner` this never throws.
 * @param {Element} element
 */
export function ownerOf(element) {
  const view = element.closest("patchwork-view");
  return {
    docUrl: view?.getAttribute("doc-url") ?? undefined,
    embedId:
      element.closest("[data-embed-id]")?.getAttribute("data-embed-id") ??
      undefined,
    toolId: view?.getAttribute("tool-id") ?? undefined,
  };
}

/**
 * Like `ownerOf`, but throws when the walk finds no embed to attribute to —
 * every store read and write must carry an owner.
 * @param {Node} node
 */
export function requireOwner(node) {
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) {
    throw new Error(
      "[context] cannot attribute context access: node is not an element and has no parentElement",
    );
  }
  const owner = ownerOf(el);
  if (owner.docUrl || owner.embedId) return owner;
  throw new Error(
    `[context] cannot attribute context access from <${el.tagName.toLowerCase()}>: ` +
      (el.isConnected
        ? "no <patchwork-view doc-url> or [data-embed-id] ancestor"
        : "element is not connected to the document"),
  );
}
