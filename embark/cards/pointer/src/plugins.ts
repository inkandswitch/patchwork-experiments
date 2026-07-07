import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. The Pointer card is a `card` document whose
// behavior module (./card) the shared card shell loads, so this package
// registers nothing; the channel re-exports in ./index would drag runtime
// imports into the worker, which is why this file exists separately.
export const plugins: Plugin<any>[] = [];
