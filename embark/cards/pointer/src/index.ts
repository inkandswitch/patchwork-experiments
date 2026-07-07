// The Pointer card package: ./card is the behavior module the card shell
// loads, and the `pointer` channel it publishes is defined in ./channels —
// readers import it from here.
export * from "./channels";

// The plugin descriptors live in ./plugins — the worker-safe entry Patchwork's
// module loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";
