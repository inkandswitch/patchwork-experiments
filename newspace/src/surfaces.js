// sketchy:surface — a mounted placeable surface. Headless transforms remain
// `sketchy:lens`; both normalize to the same descriptor shape below.
//
// A role is derived from inlet/outlet topology. UI is optional.
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { fileTextOpstream, automergeOpstream } from "./opstreams.js";
import { paramDefs } from "./brush-host.js";

function registryList(type) {
  try {
    const r = getRegistry(type);
    if (!r) return [];
    if (typeof r.filter === "function") return r.filter(() => true);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

export function normalizeSurface(d) {
  if (!d) return d;
  const out = { ...d };
  if (d.type === "sketchy:lens" || d.lens) {
    const inlet = d.inlet || { name: "in", type: "json" };
    const outlet = d.outlet || { name: "out", type: "json" };
    out.lens = true;
    out.inlets = d.inlets || [{ ...inlet, required: inlet.required !== false }];
    out.outlets = d.outlets || [outlet];
  }
  out.surface = true;
  return out;
}

export function listMountedSurfaces() {
  return registryList("sketchy:surface").map(normalizeSurface);
}

export function listLensSurfaces() {
  return registryList("sketchy:lens").map(normalizeSurface);
}

export function listSurfaces() {
  return [...listMountedSurfaces(), ...listLensSurfaces()];
}

export function surfacesFor(type) {
  return listMountedSurfaces().filter(
    (e) =>
      !e.supportedDatatypes ||
      e.supportedDatatypes.includes("*") ||
      e.supportedDatatypes.includes(type)
  );
}

export function loadSurfaceMount(descriptor) {
  return Promise.resolve(descriptor.load ? descriptor.load() : descriptor.mount || descriptor);
}

// Build default inlet opstreams for a surface placed on a doc `handle`.
export function defaultSurfaceInlets(descriptor, handle, { path, heads } = {}) {
  const inlets = {};
  for (const inlet of descriptor.inlets || []) {
    if (inlet.type === "text") inlets[inlet.name] = fileTextOpstream(handle, { path, heads });
    else if (inlet.type === "json" || inlet.type == null)
      inlets[inlet.name] = automergeOpstream(handle, { path, heads });
  }
  return inlets;
}

export async function mountSurface(descriptor, args = {}) {
  const { element, handle, inlets, outlets = {}, setOutlet, api, config = {}, setConfig, path, heads } = args;
  void element; void outlets; void setOutlet; void api; void setConfig;
  const mount = await loadSurfaceMount(descriptor);
  const ins = inlets || (handle ? defaultSurfaceInlets(descriptor, handle, { path, heads }) : {});
  return mount({ ...args, inlets: ins, outlets, config });
}

export function surfaceRole(d) {
  if (!d) return "editor";
  if (d.lens) return "lens";
  if (d.role) return d.role;
  const ins = (d.inlets || []).length, outs = (d.outlets || []).length;
  if (ins === 0 && outs > 0) return "source";
  if (outs === 0 && ins > 0) return "sink";
  return "editor";
}

const UI_TO_WIRE = { color: "text", text: "text", size: "number", slider: "number", number: "number", toggle: "json", select: "text", language: "language" };
export function paramsAsInlets(descriptor) {
  return paramDefs(descriptor).map((p) => ({
    name: p.key || p.name,
    type: p.wire || UI_TO_WIRE[p.type] || p.type,
    schema: p.schema, default: p.default, required: false, param: true,
  }));
}

export function effectiveInlets(descriptor) {
  return [...(descriptor?.inlets || []), ...paramsAsInlets(descriptor)];
}

export function inletDefsFor(descriptor, item) {
  if (descriptor && typeof descriptor.dynamicInlets === "function") {
    try { return descriptor.dynamicInlets((item && item.config) || {}) || []; } catch { return []; }
  }
  return (descriptor && descriptor.inlets) || [];
}

export function outletDefsFor(descriptor, item) {
  if (descriptor && typeof descriptor.dynamicOutlets === "function") {
    try { return descriptor.dynamicOutlets((item && item.config) || {}) || []; } catch { return []; }
  }
  return (descriptor && descriptor.outlets) || [];
}

// Compatibility names while stored items and some UI still say "editor".
export const listEditors = listMountedSurfaces;
export const editorsFor = surfacesFor;
export const loadEditorMount = loadSurfaceMount;
export const defaultInlets = defaultSurfaceInlets;
export const mountEditor = mountSurface;
export const nodeRole = surfaceRole;
