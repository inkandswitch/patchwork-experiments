import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Schema Matcher card is a `card` document whose behavior module (./card)
// the shared card shell loads. While the card sits face-up on a canvas it runs
// the schema matcher engine (./schema-matcher): matching every schema that
// `SchemaMatches` readers declare interest in against the documents in the
// `OpenDocuments` channel and answering with match urls in `SchemaMatches`.
// This package registers nothing; it exists only to publish that module.
export const plugins: Plugin<any>[] = [];
