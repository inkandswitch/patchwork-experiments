// The shared schema-matching vocabulary: the JSON-Schema→zod hydrator, the
// correlation key + channels consumers publish schemas on, and the
// document-link extractor closure walkers use. The matcher engine itself lives
// with its only runner, the Schema Matcher card (@embark/schema-matcher).
// Packages define their own schemas and correlate purely by structural
// identity (see `schemaKey`).

export * from "./schema";
export * from "./doc-links";
export * from "./channels";

// The plugin descriptors live in ./plugins — the worker-safe entry Patchwork's
// module loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";
