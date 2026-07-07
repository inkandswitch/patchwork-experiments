// The geo-shape vocabulary and the shared `GeoShapes` context channel. The
// renderer map extension the geo-shapes card publishes into `map:extensions`
// lives behind the `./renderer` subpath — it drags in maplibre, and most
// consumers (the source cards, the zoom card) only need the channel and types.
// Modeled on @embark/stickers: sources publish plain JSON shapes into their
// slice, one renderer draws the union. The plugin descriptors live in
// ./plugins — the worker-safe entry Patchwork's module loader imports via the
// `patchwork` export condition.
export { plugins } from "./plugins";

export * from "./shape";
export * from "./channels";
