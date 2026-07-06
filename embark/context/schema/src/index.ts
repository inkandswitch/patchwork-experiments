// Schema matching: the JSON-Schema→zod hydrator, the correlation key + channels
// consumers publish named schemas on, the document-link extractor closure
// walkers use, and the matcher engine itself (run by the Schema Matcher card
// against the `OpenDocuments` channel). Packages define their own schemas and
// correlate purely by structural identity (see `schemaKey`).

export * from "./schema";
export * from "./doc-links";
export * from "./channels";
export * from "./schema-matcher";

// The plugin descriptors live in ./plugins — the worker-safe entry Patchwork's
// module loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";
