import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. Plugin discovery imports this module inside a
// Web Worker, which has no importmap — so this file must contain only plugin
// metadata: no runtime import of any bare specifier (the channel re-exports in
// ./index pull in solid-js at the top level via @embark/context).
//
// No plugins: the search channels' faces come entirely from shared context
// views — query chips are the viewer's default string face, and results carry
// `value: "doc-url"` so the selection package's token view draws them.
export const plugins: Plugin<any>[] = [];
