export * from "./channels";

// The (empty) plugin list lives in ./plugins — the worker-safe entry
// Patchwork's module loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";
