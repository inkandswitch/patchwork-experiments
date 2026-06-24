import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel } from "../lib/context";
import type { JsonSchema } from "../lib/schema";
import type { Sticker } from "../stickers/types";
import type { Suggestion } from "../commands/datatype";

// The canvas context channels (see ../../spec.md "Channel registry"). Each
// value is a record so it is always mergeable; readers see the union across
// every scope, writers mutate only their own slice.

// Focus, promoted from per-tool local state to shared channels so embeds and
// decorators can read it without prop-drilling. `Selection` is the canvas's
// selected embed; `Highlight` is auxiliary emphasis any view contributes
// (hovered map pins, caret-touched mention tokens). Readers render their union.
export const Selection = defineChannel<Record<AutomergeUrl, true>>({
  name: "selection",
  empty: {},
});
export const Highlight = defineChannel<Record<AutomergeUrl, true>>({
  name: "highlight",
  empty: {},
});

// Sticker sources write their slice keyed by target *document* url; the
// renderer reads `stickers[docUrl]`. Sticker values live inline (plain JSON).
export const Stickers = defineChannel<Record<AutomergeUrl, Sticker[]>>({
  name: "stickers",
  empty: {},
});

// Request/response pair for search: boxes publish active query strings,
// contributors answer each with result document urls.
export const SearchQueries = defineChannel<Record<string, true>>({
  name: "search:queries",
  empty: {},
});
export const SearchResults = defineChannel<Record<string, AutomergeUrl[]>>({
  name: "search:results",
  empty: {},
});

// Request/response pair for slash-commands: identical to search with a
// different payload (suggestions to insert instead of result urls).
export const CommandQueries = defineChannel<Record<string, true>>({
  name: "commands:queries",
  empty: {},
});
export const CommandSuggestions = defineChannel<Record<string, Suggestion[]>>({
  name: "commands:suggestions",
  empty: {},
});

// Request/response pair for schema matching: consumers publish a JSON Schema
// (keyed by `schemaKey`), the canvas resolver answers with match urls. Schema
// resolution is plain canvas code (./schema-resolver.ts), not a provider.
export const SchemaQueries = defineChannel<Record<string, JsonSchema>>({
  name: "schema:queries",
  empty: {},
});
export const SchemaMatches = defineChannel<Record<string, AutomergeUrl[]>>({
  name: "schema:matches",
  empty: {},
});

// A stable stringification of a JSON Schema, used as the correlation key shared
// by every schema consumer (two consumers with the same schema share a key and
// a single result array).
export function schemaKey(schema: JsonSchema): string {
  return stableStringify(schema);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(
          (value as Record<string, unknown>)[key],
        )}`,
    );
  return `{${entries.join(",")}}`;
}
