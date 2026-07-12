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
// The store factory the bundled TS module publishes at load (see context.ts):
// this file can't import the implementation, so when a card is the first
// thing on the page to ask for the body store, it mints one through here.
const STORE_FACTORY_KEY = Symbol.for("patchwork.context-store.create.v1");

function createBodyStore() {
  const create = globalThis[STORE_FACTORY_KEY];
  if (typeof create !== "function") {
    throw new Error(
      "[context] no context-store implementation loaded: the body store can " +
        "only be created once a bundle containing @embark/context has run",
    );
  }
  return create();
}

function debugNodeName(node) {
  return node instanceof Element ? node.tagName.toLowerCase() : node?.nodeName;
}

/**
 * One-shot synchronous lookup: dispatch a discovery request from `node`, and
 * return whatever a `<patchwork-context>` host wrote into the event detail —
 * or the page-global body store when nothing answered.
 *
 * Discovery from a detached node can't reach any `<patchwork-context>` host,
 * so it would silently land on the body store even when the node belongs
 * inside an isolation boundary. That's a broken invariant (callers resolve
 * stores from mounted elements), so it throws instead of guessing.
 * @param {Node} node
 */
export function findContextStore(node) {
  if (!node.isConnected) {
    throw new Error(
      `[context] findContextStore called on a detached <${debugNodeName(node)}>: ` +
        "discovery cannot reach any <patchwork-context> host; resolve the store after the element is mounted",
    );
  }
  const request = new CustomEvent(CONTEXT_REQUEST, {
    bubbles: true,
    composed: true,
    detail: {},
  });
  node.dispatchEvent(request);
  // Create the body store on demand (mirroring the TS module's
  // getBodyContextStore): the store lives on document.body under a registered
  // symbol, so whichever copy of the code asks first creates it and every
  // other copy reuses it. Creation goes through the factory the TS module
  // publishes (see createBodyStore above).
  const store = (request.detail.store ??
    (document.body[BODY_STORE_KEY] ??= createBodyStore()));
  return store;
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
  const store = findContextStore(node);
  const owner = requireOwner(node);
  return store.handle(channel, owner);
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
