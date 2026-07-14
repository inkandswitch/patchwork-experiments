// The focus channels, owned by the Selection card. `Selection` is the canvas's
// selected embed; `Highlight` is auxiliary emphasis any view contributes
// (hovered map pins, caret-touched mention tokens, hovered tokens). Each is a
// set of document urls; readers render the union across every scope.
//
// This module is the canonical definition — consumers import it (bundleless
// cards via this package's automerge url, bundled editors via a `link:`
// dependency) instead of restating the shape. The store correlates channels
// structurally by `name`; `definedBy`/`spec` only attribute the definition
// back here.

// This package's own automerge url (pushwork rootUrl), self-reference for
// attribution. Copy-safe: a bundled copy of this def still points here.
const PACKAGE_URL = "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW";

/**
 * A set channel of document urls: `{ [docUrl]: true }`. Writers add/delete
 * keys in their own scoped slice; the merged value is the key union.
 * @typedef {Record<string, true>} DocUrlSet
 */

export const Selection = {
  name: "selection",
  empty: {},
  set: true,
  key: "doc-url",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};

export const Highlight = {
  name: "highlight",
  empty: {},
  set: true,
  key: "doc-url",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};
