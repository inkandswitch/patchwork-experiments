// The search channels, owned by the Mentions card (whose behavior module runs
// the @-mention editor extension — the main search box on a canvas).
// Request/response pair: boxes publish active query strings into
// `SearchQueries`, contributors answer each with result document urls in
// `SearchResults`. Keyed by the raw query string so every contributor answers
// the same live queries.
//
// This module is the canonical definition — search providers (doc-finder,
// poi) import it by this package's automerge url instead of restating the
// shape.

// This package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const PACKAGE_URL = "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh";

/** Active query strings, as a set channel: `{ [query]: true }`. */
export const SearchQueries = {
  name: "search:queries",
  empty: {},
  set: true,
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};

/** Answers per query: `{ [query]: docUrl[] }`. */
export const SearchResults = {
  name: "search:results",
  empty: {},
  value: "doc-url",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};
