import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel, defineSetChannel } from "@embark/context";

// Request/response pair for search: boxes publish active query strings into
// `SearchQueries`, contributors answer each with result document urls in
// `SearchResults`. Keyed by the raw query string so every contributor answers
// the same live queries.
export const SearchQueries = defineSetChannel<string>({
  name: "search:queries",
});

export const SearchResults = defineChannel<Record<string, AutomergeUrl[]>>({
  name: "search:results",
  empty: {},
  value: "doc-url",
});
