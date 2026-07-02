import type { Plugin } from "@inkandswitch/patchwork-plugins";

// "Make stickerable" is no longer a component: it is a `card` document whose
// behavior module (./card) the shared card shell loads. This package registers
// nothing; it exists only to publish that module.
export const plugins: Plugin<any>[] = [];
