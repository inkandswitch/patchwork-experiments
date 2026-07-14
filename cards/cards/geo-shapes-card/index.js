// The Geo Shapes card: owns the `geo:shapes` channel (./channels.js) and the
// renderer map extension (./renderer.js) its behavior module (./card.js)
// publishes into the canvas `map:extensions` channel while face-up. Source
// cards (geo-lines, geo-markers) import the channel from this package by its
// automerge url.
//
// The geo-shape context view rides card.js's `plugins` export — the card
// shell registers it while the card is on a canvas — so this package entry
// registers nothing.
export const plugins = [];
