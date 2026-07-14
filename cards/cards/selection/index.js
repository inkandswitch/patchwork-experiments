// The Selection card: gives the `selection` / `highlight` focus channels a
// physical representation. The card behavior module (./card.js) is loaded by
// the shared card shell; the channel definitions live in ./channels.js and the
// shared token UI in ./tokens.js — consumers import those from this package.
//
// The doc-url context view rides card.js's `plugins` export — the card shell
// registers it while the card is on a canvas — so this package entry
// registers nothing.
export const plugins = [];
