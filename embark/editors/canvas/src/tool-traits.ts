// Per-tool rendering traits, shared by the canvas frame and the parts-bin
// previews so both agree on how a given tool wants to be presented. Keyed by
// tool id; a consumer with no explicit tool id falls back to the document's
// datatype, which for these tools matches the tool id.

// Tools that bring their own chrome: on the canvas they render without the drag
// border / clipping and are dragged by grabbing their surface (a per-embed
// `showFrame` still overrides this), and in the parts bin their preview shows
// without a wrapper border. Cards carry their own playing-card surface, so they
// belong here — dropping one out of the bin lands a frameless embed.
export const FRAMELESS_TOOLS = new Set<string>([
  "parts-bin",
  "context-canvas",
  "card",
]);

// Tools that report their own intrinsic size and change it as their state
// changes (e.g. the deck, which grows when fanned and shrinks when folded; a
// card's fixed playing-card footprint). Their embed omits the stored
// width/height and shrink-wraps the content instead (see
// `.embark-embed--autosize`), so the card resizes dynamically.
export const AUTOSIZE_TOOLS = new Set<string>(["deck", "card"]);
