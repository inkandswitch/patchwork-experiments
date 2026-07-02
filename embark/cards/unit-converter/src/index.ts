import type { Plugin } from "@inkandswitch/patchwork-plugins";

// "Convert to metric" is no longer a datatype/tool: it is a `card` document
// whose behavior module (./card) the shared card shell loads. This package
// registers nothing; it exists only to publish that module.
export const plugins: Plugin<any>[] = [];
