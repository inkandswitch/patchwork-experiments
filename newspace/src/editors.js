// sketchy:editor — a node with typed inlets/outlets that carry opstreams.
//
// A descriptor (registered in the `plugins` array, type "sketchy:editor") is:
//   { type:"sketchy:editor", id, name, icon, supportedDatatypes,
//     inlets:  [{ name, type, required? }],   // ports that take an opstream IN
//     outlets: [{ name, type }],              // ports that expose an opstream OUT
//     async load() -> mount }                 // mount({element,inlets,outlets,handle}) => cleanup
//
// inlets/outlets live ON the descriptor (so they're readable without loading the
// editor's code); `load()` returns the heavy mount function. Port `type` is a
// coarse tag for wiring ("text" | "json" | "language" | …); finer typing is the
// opstream's Standard Schema.
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { fileTextOpstream, automergeOpstream } from "./opstreams.js";

// registered editor descriptors (defensive: no host registry ⇒ [])
export function listEditors() {
  try {
    const r = getRegistry("sketchy:editor");
    if (!r) return [];
    if (typeof r.filter === "function") return r.filter(() => true);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// editors that can edit a given datatype
export function editorsFor(type) {
  return listEditors().filter(
    (e) =>
      !e.supportedDatatypes ||
      e.supportedDatatypes.includes("*") ||
      e.supportedDatatypes.includes(type)
  );
}

export function loadEditorMount(descriptor) {
  return Promise.resolve(descriptor.load ? descriptor.load() : descriptor.mount || descriptor);
}

// Build default inlet opstreams for an editor placed on a doc `handle`. A "text"
// inlet → a file text stream (string at `path`, default ["content"]); anything
// else → the whole-doc stream. `{heads}` pins to a version ⇒ read-only streams
// (no `apply`). "language" inlets have no doc source — left for explicit wiring.
export function defaultInlets(descriptor, handle, { path, heads } = {}) {
  const inlets = {};
  for (const inlet of descriptor.inlets || []) {
    if (inlet.type === "text") inlets[inlet.name] = fileTextOpstream(handle, { path, heads });
    else if (inlet.type === "json" || inlet.type == null)
      inlets[inlet.name] = automergeOpstream(handle, { path, heads });
    // "language" and other source-less inlets are wired explicitly, not defaulted
  }
  return inlets;
}

// Mount an editor into `element`. Inlets default from `handle` unless supplied
// explicitly (e.g. wired from another node's outlet). Returns cleanup.
export async function mountEditor(descriptor, { element, handle, inlets, outlets = {}, path, heads } = {}) {
  const mount = await loadEditorMount(descriptor);
  const ins = inlets || (handle ? defaultInlets(descriptor, handle, { path, heads }) : {});
  return mount({ element, inlets: ins, outlets, handle });
}
