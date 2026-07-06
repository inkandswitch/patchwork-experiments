// The channel cards publish their editor extensions into; this host package owns
// the contract since it is the sole reader (see ./host).
export { CodemirrorExtensions } from "./channel";

// A single always-registered codemirror extension. It brings no behavior of its
// own; it installs whatever feature cards publish into the canvas
// `CodemirrorExtensions` channel (see ./host), and is inert outside a canvas.
// This is the only globally-registered codemirror extension — mentions,
// stickers, etc. are no longer baked in and ride in through their cards instead.
// The plugin descriptors live in ./plugins — the worker-safe entry Patchwork's
// module loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";
