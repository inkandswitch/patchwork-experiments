import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Geo Shapes card is a `card` document whose behavior module (./card) the
// shared card shell loads. While the card sits face-up on a canvas, that
// module publishes the geo-shape renderer map extension into the canvas
// `MapExtensions` channel. This package registers nothing; it exists only to
// publish that module.
export const plugins: Plugin<any>[] = [];
