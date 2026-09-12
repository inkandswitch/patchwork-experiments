// Providers
// How a component finds out about the world it is rendered into.
//
// A `patchwork:component` is handed an element and nothing else — no document, no account. What
// it needs instead comes from the host's providers: you dispatch a `patchwork:subscribe` event
// from your <patchwork-view> carrying a MessagePort, name a selector, and the host posts
// `{type:"change", value}` back whenever that value changes.
//
// This is a vanilla port of `@inkandswitch/patchwork-providers`. That package is not in the
// bootloader importmap, and the protocol is a few lines of DOM event plus a MessageChannel.

/** Heads are pinned onto a URL by the service worker; the bare URL is the document's identity. */
export const withoutHeads = (url) => (url ? String(url).split("#")[0] : undefined);

/**
 * Subscribe to one of the host's providers. Calls `onChange` with each new value and returns an
 * unsubscribe function. `makeChannel` is injected so this can be tested without a host.
 */
export function subscribe(element, selector, onChange, { makeChannel = () => new MessageChannel() } = {}) {
  const target = element.closest?.("patchwork-view") ?? element;
  const channel = makeChannel();
  const port = channel.port2;

  const listener = (event) => {
    if (event.data?.type === "change") onChange(event.data.value);
  };

  port.addEventListener("message", listener);
  port.start?.();

  target.dispatchEvent(
    new CustomEvent("patchwork:subscribe", {
      detail: { selector, port: channel.port1 },
      bubbles: true,
      composed: true,
    })
  );

  return () => {
    port.removeEventListener("message", listener);
    try { port.postMessage({ type: "unsubscribe" }) } catch {}
    try { port.close() } catch {}
  };
}

/** The document the user has selected, or undefined. The provider answers with a list. */
export const onSelectedDoc = (element, onChange, options) =>
  subscribe(element, { type: "patchwork:selected-doc" }, (urls) => onChange(withoutHeads(Array.isArray(urls) ? urls[0] : urls)), options);

/**
 * This tool's private, account-scoped storage document — created by the host on first request,
 * so a component never writes to the account itself and never has to race another tab over
 * creating one.
 */
export const onToolStorage = (element, toolId, onChange, options) =>
  subscribe(element, { type: "patchwork:tool-storage", toolId }, (url) => onChange(withoutHeads(url)), options);

/**
 * Can this document be built, and if not, why not?
 *
 * A context tool is offered every document the user looks at, so it has to know when it has
 * nothing to say. A CakeWalk site is a repo with pages in `content/` and layouts in `template/`;
 * that pair is the signature, and the one thing every fork shares.
 *
 * Both of pushwork's shapes count. They store the structure differently — `patchwork-folder`
 * lists children per directory, `vfs` keys one root document by whole path — so the same
 * question is asked two ways. An earlier version checked only for bare `content` and `template`
 * keys, which a vfs repo never has: its keys are `content/alifib/index.md`. That reported every
 * vfs repo as "not a CakeWalk repo", which was true of nothing.
 */
export function describeRepo(doc) {
  if (!doc || typeof doc !== "object") return { buildable: false, reason: "Nothing selected" };

  if (Array.isArray(doc.docs)) {
    const names = new Set(doc.docs.map((d) => d?.name));
    return names.has("content") && names.has("template")
      ? { buildable: true, reason: "" }
      : { buildable: false, reason: "Not a CakeWalk repo — no content/ and template/ in it" };
  }

  if (doc["@patchwork"]?.type === "directory") {
    const keys = Object.keys(doc);
    const hasDir = (name) => keys.some((k) => k === name || k.startsWith(name + "/"));
    return hasDir("content") && hasDir("template")
      ? { buildable: true, reason: "" }
      : { buildable: false, reason: "Not a CakeWalk repo — no content/ and template/ in it" };
  }

  return { buildable: false, reason: "Not a CakeWalk repo" };
}
