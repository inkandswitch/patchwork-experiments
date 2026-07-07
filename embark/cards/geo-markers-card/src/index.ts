import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Geo Markers card is a `card` document whose behavior module (./card) the
// shared card shell loads. While the card sits face-up on a canvas, that
// module publishes a marker geo shape for every `{lat, lon}` match in the open
// documents. This package registers nothing; it exists only to publish that
// module.
export const plugins: Plugin<any>[] = [];
