// sketchy:editor — a node with typed inlets/outlets that carry opstreams.
//
// A descriptor (registered in the `plugins` array, type "sketchy:window") is:
//   { type:"sketchy:window", id, name, icon, supportedDatatypes,
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
import { paramDefs } from "./brush-host.js";

// registered editor descriptors (defensive: no host registry ⇒ [])
export function listEditors() {
  try {
    const r = getRegistry("sketchy:window");
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
export async function mountEditor(descriptor, args = {}) {
  const { element, handle, inlets, outlets = {}, setOutlet, api, config = {}, setConfig, path, heads } = args;
  const mount = await loadEditorMount(descriptor);
  const ins = inlets || (handle ? defaultInlets(descriptor, handle, { path, heads }) : {});
  // `config` is the surface's PERSISTED state (a url, a json-path expr, a raw value);
  // `setConfig(patch)` merges into it on the item in the doc (survives reload + syncs).
  // Forward the WHOLE args object (incl. broadcast/onBroadcast/onConfig/share/shareDoc/
  // onShared) so node mounts get the sharing plumbing — previously these were dropped.
  return mount({ ...args, inlets: ins, outlets, config });
}

// A node's ROLE, derived from its port topology (the source/sink/transform/editor
// distinction the design converged on — a role, not a separate plugin type):
//   source    — no inlets, has outlets (file, gamepad, clock, …)
//   sink      — has inlets, no outlets
//   transform — both (a lens you can see; an editor is technically this too)
// `lens` descriptors are tagged explicitly. Editors with both ports read as
// "editor" so the menu can group them apart from pure transforms.
export function nodeRole(d) {
  if (!d) return "editor";
  if (d.lens) return "lens";
  if (d.role) return d.role; // explicit override
  const ins = (d.inlets || []).length, outs = (d.outlets || []).length;
  if (ins === 0 && outs > 0) return "source";
  if (outs === 0 && ins > 0) return "sink";
  return "editor";
}

// A surface (and a brush) may declare params — configurable knobs shown in the properties
// panel. The design insight: a param is ALSO wireable — you can drive it from a stream
// instead of the UI. So params project to OPTIONAL inlets (tagged `param`), and a surface's
// EFFECTIVE inlets are its declared inlets plus those. Params come from EITHER a real
// `schema` (paramsSchema → fields, keyed by `key`, typed by a UI control) OR a legacy
// `params` array (keyed by `name`, typed by a wiring type) — `paramDefs` unifies them.
// A field's UI control type maps to the wiring type its inlet should accept.
const UI_TO_WIRE = { color: "text", text: "text", size: "number", slider: "number", number: "number", toggle: "json", select: "text", language: "language" };
export function paramsAsInlets(descriptor) {
  return paramDefs(descriptor).map((p) => ({
    name: p.key || p.name,
    type: p.wire || UI_TO_WIRE[p.type] || p.type, // a UI field's control type → its wire type
    schema: p.schema, default: p.default, required: false, param: true,
  }));
}
export function effectiveInlets(descriptor) {
  return [...(descriptor?.inlets || []), ...paramsAsInlets(descriptor)];
}

// A surface's inlet defs for a given ITEM. Most are static (descriptor.inlets), but
// a descriptor may declare `dynamicInlets(config)` to derive them from the item's
// persisted config (the template-doc punches inlets from `<…>` holes in its text).
export function inletDefsFor(descriptor, item) {
  if (descriptor && typeof descriptor.dynamicInlets === "function") {
    try { return descriptor.dynamicInlets((item && item.config) || {}) || []; } catch { return []; }
  }
  return (descriptor && descriptor.inlets) || [];
}

// Symmetric to inletDefsFor: a descriptor may declare `dynamicOutlets(config)` to
// derive its OUTLET ports from the item's persisted config (the LLM punches a named
// outlet per `@out name` line in its prompt). Otherwise the static `descriptor.outlets`.
export function outletDefsFor(descriptor, item) {
  if (descriptor && typeof descriptor.dynamicOutlets === "function") {
    try { return descriptor.dynamicOutlets((item && item.config) || {}) || []; } catch { return []; }
  }
  return (descriptor && descriptor.outlets) || [];
}
