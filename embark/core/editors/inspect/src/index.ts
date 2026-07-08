export {
  resolveInspectTarget,
  isFolderDoc,
  type InspectTarget,
  type InspectDoc,
} from "./resolve-target";

// The plugin descriptors (the inspect tool and its private spec editor) live
// in ./plugins — the worker-safe entry Patchwork's module loader imports via
// the `patchwork` export condition.
export { plugins } from "./plugins";
