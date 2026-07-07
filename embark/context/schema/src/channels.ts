import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel, defineSetChannel } from "@embark/context";
import type { JsonSchema } from "./schema";

// Schema matching rides a single channel: reading *is* asking. A consumer
// subscribes to `SchemaMatches` with a declared key interest — each key is
// `schemaKey(schema)`, the canonical schema JSON, so `JSON.parse(key)`
// recovers the schema exactly — and the Schema Matcher card
// (@embark/schema-matcher) watches the channel's reader registry
// (`store.interests(SchemaMatches)`) and answers with match urls under the
// same key. Two consumers with the same schema share one key and one result
// array; when a key's last reader unsubscribes, its entry drops out. Readers
// that declare no keys (inspectors) are passive observers and create no
// queries.
export const SchemaMatches = defineChannel<Record<string, AutomergeUrl[]>>({
  name: "schema:matches",
  empty: {},
  key: "json-schema",
  value: "doc-url",
});

// The documents currently in scope for schema matching, as a url-keyed set.
// Each writer contributes its own scoped slice (`{ [url]: true }`) and the
// merged value is the key union, so releasing a scope drops exactly its docs.
// The Open Documents card publishes the frame's selected document plus its link
// closure; cards that mint synthetic documents (the POI provider, stickerable
// mirrors) add theirs. The Schema Matcher card (@embark/schema-matcher) reads
// the union — this channel replaces the old DOM `patchwork:mounted` discovery.
export const OpenDocuments = defineSetChannel<AutomergeUrl>({
  name: "open-documents",
  key: "doc-url",
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
