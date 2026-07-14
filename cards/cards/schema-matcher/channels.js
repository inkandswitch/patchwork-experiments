// The schema-matching vocabulary, owned by the Schema Matcher card (the engine
// that answers the queries lives in this package's card.js).
//
// Schema matching rides a single channel: reading *is* asking. A consumer
// subscribes to `SchemaMatches` with a declared key interest — each key is
// `schemaKey(schema)`, the canonical schema JSON, so `JSON.parse(key)`
// recovers the schema exactly — and the matcher card watches the channel's
// reader registry (`store.interests(SchemaMatches)`) and answers with match
// urls under the same key. Two consumers with the same schema share one key
// and one result array; when a key's last reader unsubscribes, its entry drops
// out. Readers that declare no keys (inspectors) are passive observers and
// create no queries.
//
// This module is the canonical definition — consumers import it by this
// package's automerge url instead of restating the shapes.

// This package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";

/**
 * A JSON Schema as plain JSON (what zod 4's `z.toJSONSchema` emits — consumers
 * write the literal by hand here).
 * @typedef {boolean | { [key: string]: unknown }} JsonSchema
 */

/** Queries and answers in one: `{ [schemaKey(schema)]: matchUrl[] }`. */
export const SchemaMatches = {
  name: "schema:matches",
  empty: {},
  key: "json-schema",
  value: "doc-url",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};

/**
 * The documents currently in scope for schema matching, as a url-keyed set.
 * Each writer contributes its own scoped slice (`{ [url]: true }`) and the
 * merged value is the key union, so releasing a scope drops exactly its docs.
 * The Open Documents card publishes the frame's selected document plus its
 * link closure; cards that mint synthetic documents (the POI provider,
 * stickerable mirrors) add theirs. The matcher card reads the union.
 */
export const OpenDocuments = {
  name: "open-documents",
  empty: {},
  set: true,
  key: "doc-url",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};

/**
 * A stable, canonical stringification of a JSON Schema, used as the
 * correlation key shared by every schema consumer. Because packages define
 * their own schemas (no central registry), correlation is purely structural:
 * two consumers that describe the same shape — regardless of object key order
 * — produce the same key and therefore share a single result array.
 * @param {JsonSchema} schema
 * @returns {string}
 */
export function schemaKey(schema) {
  return stableStringify(schema);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}
