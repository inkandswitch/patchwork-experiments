// The `doc-url` context view: any key or value element that is a document url
// draws as the document's real embed face (EmbedToken), wired to the shared
// hover->Highlight interaction. This is the one view that needs ambient state —
// the store the Highlight channel lives on — so it resolves it (and the owner
// its hover writes are attributed to: the enclosing inspector) from its own
// mounted element via the same DOM discovery writers use.
//
// Loaded lazily through this package's `doc-url-context-view` plugin, always
// as a real module (never bundled), so the store-client import below resolves
// at load time.

import { render } from "solid-js/web";
import html from "solid-js/html";
import { EmbedToken, useHighlight } from "./tokens.js";

// The @embark/core package — a hard dependency, declared in this
// package's package.json so isolation bridges can rewrite the url.
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { findContextStore, requireOwner } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);

/** @type {(element: HTMLElement, value: unknown) => () => void} */
export const docUrlView = (element, value) => {
  const url = /** @type {string} */ (value);
  const store = findContextStore(element);
  const owner = requireOwner(element);
  return render(() => {
    const highlight = useHighlight(store, owner);
    return html`<${EmbedToken} url=${url} highlight=${highlight} />`;
  }, element);
};
