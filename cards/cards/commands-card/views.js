// The `suggestion` context view: a command suggestion drawn as a labeled token
// over its prototype card document, wired to the shared hover->Highlight
// interaction (store and owner resolved from the mounted element, like the
// doc-url view). The token building blocks come from the selection card — the
// owner of the `highlight` channel the hover writes.
//
// Loaded lazily through this package's `suggestion-context-view` plugin.

import { render } from "solid-js/web";
import html from "solid-js/html";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SELECTION_PACKAGE_URL = "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW";

const { findContextStore, requireOwner } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { EmbedToken, useHighlight } = await import(
  getImportableUrlFromAutomergeUrl(SELECTION_PACKAGE_URL, "tokens.js")
);

/** @type {(element: HTMLElement, value: unknown) => () => void} */
export const suggestionView = (element, value) => {
  const suggestion = /** @type {import("./channels.js").Suggestion} */ (value);
  const store = findContextStore(element);
  const owner = requireOwner(element);
  return render(() => {
    const highlight = useHighlight(store, owner);
    return html`<${EmbedToken}
      url=${suggestion.url}
      label=${suggestion.label}
      highlight=${highlight}
    />`;
  }, element);
};
