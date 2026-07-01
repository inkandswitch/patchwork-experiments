import type { Extension } from "@codemirror/state";
import type { Plugin } from "@inkandswitch/patchwork-plugins";

// A single always-registered codemirror extension. It brings no behavior of its
// own; it installs whatever feature cards publish into the canvas
// `CodemirrorExtensions` channel (see ./host), and is inert outside a canvas.
// This is the only globally-registered codemirror extension — mentions,
// stickers, etc. are no longer baked in and ride in through their cards instead.
export const plugins: Plugin<any>[] = [
  {
    type: "codemirror:extension",
    id: "embark-codemirror-extensions-host",
    name: "Embark codemirror extensions host",
    supportedDatatypes: ["markdown", "essay"],
    async load(): Promise<Extension> {
      const { codemirrorExtensionsHost } = await import("./host");
      return codemirrorExtensionsHost();
    },
  },
];
