// The Geo Zoom card is a `card` document whose behavior module
// (./dist/card.js) the shared card shell loads. While the card sits face-up on
// a canvas, that module publishes the zooming map extension into the canvas
// `map:extensions` channel. This package registers nothing; it exists only to
// publish that module.
export const plugins = [];
