import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel } from "@embark/context";
import type { JsonSchema } from "./schema";

// A published schema query: the schema to match plus a short human-readable
// name for it (so views like the context viewer can label "where does this
// occur?" sections). Keyed by `schemaKey` (derived from the schema alone), so
// two consumers with the same schema share a key, matches, and — last writer
// wins — a name.
export type SchemaQuery = { name: string; schema: JsonSchema };

// Request/response pair for schema matching: consumers publish a named JSON
// Schema (keyed by `schemaKey`) into `SchemaQueries`, the canvas resolver
// (./schema-resolver.ts) answers with match urls in `SchemaMatches`.
export const SchemaQueries = defineChannel<Record<string, SchemaQuery>>({
  name: "schema:queries",
  empty: {},
});

export const SchemaMatches = defineChannel<Record<string, AutomergeUrl[]>>({
  name: "schema:matches",
  empty: {},
});

// A stable, canonical stringification of a JSON Schema, used as the correlation
// key shared by every schema consumer. Because packages now define their own
// schemas (no central registry), correlation is purely structural: two
// consumers that describe the same shape — regardless of object key order —
// produce the same key and therefore share a single result array.
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
