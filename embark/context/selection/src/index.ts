// The selection/highlight focus channels. Shared token UI (EmbedToken, chips,
// hover->highlight wiring) ships from the `./tokens` subpath so packages that
// only need the channel definitions don't pull in Solid or the token CSS.
export * from "./channels";

// The plugin descriptors live in ./plugins — the worker-safe entry Patchwork's
// module loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";
