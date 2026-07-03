// Schema matching: the JSON-Schema→zod hydrator, the correlation key + channels
// consumers publish named schemas on, the document-link extractor closure
// walkers use, and the matcher engine itself (run by the Schema Matcher card
// against the `OpenDocuments` channel). Packages define their own schemas and
// correlate purely by structural identity (see `schemaKey`).

import type { Plugin } from "@inkandswitch/patchwork-plugins";

export * from "./schema";
export * from "./doc-links";
export * from "./channels";
export * from "./schema-matcher";

// Registers a context visualizer for `schema:queries` (loaded lazily by the
// context viewer). See @embark/context's `embark:context-visualizer` type.
export const plugins: Plugin<any>[] = [
  {
    type: "embark:context-visualizer",
    id: "schema-context-visualizer",
    name: "Schema context visualizer",
    channels: ["schema:queries"],
    async load() {
      const { schemaVisualizer } = await import("./visualizer");
      return schemaVisualizer;
    },
  },
];
