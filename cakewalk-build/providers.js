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
 * nothing to say — and say something worth reading when it does. A CakeWalk site is a folder
 * with pages in `content/` and layouts in `template/`; that pair is the signature, and the one
 * thing every fork shares.
 *
 * The case worth spelling out is the last one. `pushwork init` defaults to `--shape vfs`, which
 * puts the whole repo in one document keyed by path instead of a document per file. Such a repo
 * has content/ and template/ in it and still cannot be read here, so "not a CakeWalk repo" would
 * be both true and useless. Name the real problem instead.
 *
 * Whether the repo also carries a browser build is a question for when someone presses Build:
 * that answer is a fixable thing to say, not a reason to hide the button.
 */
export function describeRepo(doc) {
  if (!doc || typeof doc !== "object") return { buildable: false, reason: "Nothing selected" };

  const names = new Set(Array.isArray(doc.docs) ? doc.docs.map((d) => d?.name) : Object.keys(doc));
  const hasSite = names.has("content") && names.has("template");

  if (!Array.isArray(doc.docs)) {
    return {
      buildable: false,
      reason: hasSite
        ? "This repo was synced with the vfs shape — re-run pushwork with --shape patchwork-folder"
        : "Not a CakeWalk repo",
    };
  }

  if (!hasSite) return { buildable: false, reason: "Not a CakeWalk repo — no content/ and template/ in it" };
  return { buildable: true, reason: "" };
}
