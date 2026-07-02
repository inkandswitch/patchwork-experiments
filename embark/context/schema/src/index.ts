// Schema matching: the JSON-Schema→zod hydrator, the correlation key + channels
// consumers publish named schemas on, the document-link extractor the resolver
// walks with, and the canvas resolver engine itself. Packages define their own
// schemas and correlate purely by structural identity (see `schemaKey`).

export * from "./schema";
export * from "./doc-links";
export * from "./channels";
export * from "./schema-resolver";
