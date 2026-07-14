// The slash-command channels, owned by the Commands card (whose behavior
// module runs the `/` menu editor extension). Request/response pair: boxes
// publish active query strings into `CommandQueries`, contributors answer each
// with suggestions to insert in `CommandSuggestions`. Identical in shape to
// the search channels (see @embark/mentions-card), with a different payload
// (suggestions instead of result urls).
//
// This module is the canonical definition — command providers (weather, route)
// import it by this package's automerge url instead of restating the shape.

// This package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const PACKAGE_URL = "automerge:asYz1WKN9GHigxdQPVVfr5h8MuW";

/**
 * One entry offered while the user is typing a `/` command. `label` is what
 * the menu shows and `url` is the (prototype) card document the command stands
 * for. When the user picks a suggestion the menu clones `url` (so each
 * insertion is independent) and inserts a token referencing the clone. How the
 * token renders is decided by the resolved document itself.
 *
 * Suggestions ride the `CommandSuggestions` channel inline (plain JSON).
 * @typedef {{ label: string, url: string }} Suggestion
 */

/** Active `/` query strings, as a set channel: `{ [query]: true }`. */
export const CommandQueries = {
  name: "commands:queries",
  empty: {},
  set: true,
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};

/** Answers per query: `{ [query]: Suggestion[] }`. */
export const CommandSuggestions = {
  name: "commands:suggestions",
  empty: {},
  value: "suggestion",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};
