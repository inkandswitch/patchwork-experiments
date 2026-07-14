// The Mentions card: owns the search channels (./channels.js) the @mention
// menu is brokered over. Its behavior module (./card.js) publishes the
// @mention codemirror extension into the canvas `codemirror:extensions`
// channel while face-up. Search providers (doc-finder) import the channels
// from this package by its automerge url. This package registers no plugins.
export const plugins = [];
