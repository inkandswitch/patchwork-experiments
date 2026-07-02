import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Stickers card is no longer a datatype/tool: it is a `card` document whose
// behavior module (./card) the shared card shell loads. While the card sits
// face-up on a canvas, that module publishes the sticker renderer codemirror
// extension into the canvas `CodemirrorExtensions` channel. This package
// registers nothing; it exists only to publish that module.
export const plugins: Plugin<any>[] = [];
