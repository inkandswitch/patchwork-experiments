// The sticker renderer codemirror extension is no longer registered globally (it
// used to load into every markdown editor). It now ships as a factory the
// Stickers card publishes into the canvas `CodemirrorExtensions` channel while
// present (see @embark/stickers-card and @embark/codemirror-extensions-host).
// This package still registers the timer widget a `tool` sticker embeds, the
// `sticker` context view for the context viewer, and exports the renderer
// factory for the card. The plugin descriptors live in ./plugins — the
// worker-safe entry Patchwork's module loader imports via the `patchwork`
// export condition.
export { plugins } from "./plugins";

export { stickerRenderer } from "./renderer";

// The sticker vocabulary, the shared `Stickers` context channel, and the
// scanning engine that example sources (unit/metric/currency converters, timer,
// schedule) build on. Absorbed from the old @embark/core "kitchen sink".
export * from "./sticker";
export * from "./channels";
export * from "./source-lib";
