import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. The page-url card is a `card` document whose
// behavior module (./card) the shared card shell loads, so this package
// registers nothing.
export const plugins: Plugin<any>[] = [];
