// The map analog of @embark/codemirror-extensions-host: cards publish live
// `MapExtension` functions into the canvas `map:extensions` channel, and every
// map tool installs the union via `installMapExtensionsHost`. The plugin
// descriptors live in ./plugins — the worker-safe entry Patchwork's module
// loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";

export { MapExtensions, type MapExtension } from "./channel";
export { installMapExtensionsHost } from "./host";
