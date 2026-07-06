// The command channels, the suggestion shape, and the shared place/route
// resolution helpers (used by the weather and route cards) that were absorbed
// from the old @embark/core "kitchen sink". The `/` menu editor extension
// itself lives in the commands card (cards/commands-card), which publishes it
// into a canvas's `CodemirrorExtensions` channel while it sits face-up there.
export * from "./channels";
export * from "./suggestion";
export * from "./place-resolve";
export * from "./fuzzy";
export * from "./route-provider";

// The plugin descriptors live in ./plugins — the worker-safe entry Patchwork's
// module loader imports via the `patchwork` export condition.
export { plugins } from "./plugins";
