// The Schema Matcher card: owns the `schema:matches` and `open-documents`
// channels plus `schemaKey` (./channels.js) and the document-link extractor
// (./doc-links.js). Its behavior module (./card.js) is the matcher engine
// that answers schema queries while the card is face-up. Consumers import the
// channels and helpers from this package by its automerge url.
//
// The json-schema context view rides card.js's `plugins` export — the card
// shell registers it while the card is on a canvas — so this package entry
// registers nothing.
export const plugins = [];
