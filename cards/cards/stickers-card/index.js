// The Stickers card: owns the `stickers` channel (./channels.js), the shared
// sticker-source engine (./engine.js), and the CodeMirror renderer
// (./renderer.js) its behavior module (./card.js) publishes into the canvas
// `codemirror:extensions` channel while face-up. Source cards import the
// channel and engine from this package by its automerge url.
//
// The sticker context view rides card.js's `plugins` export — the card shell
// registers it while the card is on a canvas — so this package entry
// registers nothing.
export const plugins = [];
