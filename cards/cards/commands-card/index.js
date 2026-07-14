// The Commands card: owns the slash-command channels (./channels.js) and the
// shared command helpers — place resolution (./place-resolve.js), fuzzy
// matching (./fuzzy.js), the route provider choice (./route-provider.js).
// Its behavior module (./card.js) runs the `/` menu editor extension,
// published into the canvas `codemirror:extensions` channel while face-up.
// Command providers (weather, route) import the channels and helpers from
// this package by its automerge url.
//
// The suggestion context view rides card.js's `plugins` export — the card
// shell registers it while the card is on a canvas — so this package entry
// registers nothing.
export const plugins = [];
