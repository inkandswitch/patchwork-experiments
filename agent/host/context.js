/**
 * Talking to the host's context providers, in vanilla JS.
 *
 * Patchwork exposes ambient context (which document is selected, where the
 * user's focus is, per-tool storage) through a port-based protocol: dispatch a
 * `patchwork:subscribe` event carrying one end of a MessageChannel, and the
 * host posts `{type: "change", value}` down it whenever the value changes.
 *
 * The published helper for this is Solid-flavoured and not in the importmap,
 * and this package may not import a sibling's copy — so this is an independent
 * implementation of the same protocol, with a plain callback instead of a
 * signal.
 */

/**
 * Subscribe to a provider selector.
 * @returns {() => void} unsubscribe
 */
export function subscribe(element, selector, onValue) {
  const view = element.closest?.("patchwork-view")
  const target = view ?? element
  const channel = new MessageChannel()
  const port = channel.port2
  let closed = false

  port.onmessage = (event) => {
    if (event.data?.type === "change") {
      try {
        onValue(event.data.value)
      } catch {
        /* a throwing subscriber must not tear down the port */
      }
    }
  }
  port.start()

  target.dispatchEvent(
    new CustomEvent("patchwork:subscribe", {
      detail: { selector, port: channel.port1 },
      bubbles: true,
      composed: true,
    })
  )

  return () => {
    if (closed) return
    closed = true
    try {
      port.postMessage({ type: "unsubscribe" })
    } catch {
      /* the host may already be gone */
    }
    try {
      port.close()
    } catch {
      /* ditto */
    }
  }
}

/** The document the user is currently looking at. Calls back with a url or null. */
export function selectedDocUrl(element, onUrl) {
  return subscribe(element, { type: "patchwork:selected-doc" }, (urls) => {
    onUrl(Array.isArray(urls) ? (urls[0] ?? null) : (urls ?? null))
  })
}

/** Ask Patchwork to open a document, optionally in a particular tool. */
export function openDocument(element, url, toolId) {
  element.dispatchEvent(
    new CustomEvent("patchwork:open-document", {
      detail: { url, toolId },
      bubbles: true,
      composed: true,
    })
  )
}
