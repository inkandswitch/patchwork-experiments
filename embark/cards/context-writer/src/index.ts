import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Context Writer is a debug tool: a `card` document whose behavior module
// (./card) the shared card shell loads. It registers no datatype/tool of its
// own — it exists only to publish that module.
export const plugins: Plugin<any>[] = [];
