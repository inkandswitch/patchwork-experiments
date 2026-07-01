import type { Plugin } from "@inkandswitch/patchwork-plugins";

// "Make stickerable" is a `patchwork:component`, not a tool+datatype: it has no
// state of its own, so it ships as a handle-less view (./component) that the
// canvas embeds directly by url — same shape as the sticker-source cards. Unlike
// those, it doesn't *produce* stickers; it bridges other views' visible text
// into the sticker system so any source can annotate them, then paints the
// resulting stickers back over the DOM.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "stickerable",
    name: "Make stickerable",
    icon: "Sparkles",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
];
