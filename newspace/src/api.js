// element.api — the public surface on the Sketchy element. "Everything doable in
// the system is doable from devtools": `sketchyEl.api.find(url)` gets an opstream,
// `api.editors()` lists editors, `api.describe(x)` introspects. Keep it SMALL (do
// less); grow it only as real needs appear.
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { createProtocols, automergeProtocol } from "./protocols.js";
import { listEditors, editorsFor } from "./surfaces.js";

const REGISTRY_TYPES = ["sketchy:surface", "sketchy:brush", "patchwork:tool", "patchwork:datatype", "patchwork:component"];

// Introspect anything: a registered plugin id, a function, an opstream, an object.
// emacs-help-ish, from devtools.
export function describe(x) {
  if (typeof x === "function") {
    const src = String(x);
    const sig = src.slice(0, src.indexOf(")") + 1).replace(/\s+/g, " ").trim();
    return { kind: "function", name: x.name || "(anonymous)", signature: sig, arity: x.length };
  }
  if (typeof x === "string") {
    for (const type of REGISTRY_TYPES) {
      let list = [];
      try {
        const r = getRegistry(type);
        list = r && typeof r.filter === "function" ? r.filter(() => true) : Array.isArray(r) ? r : [];
      } catch {}
      const p = list.find((d) => d && d.id === x);
      if (p) return { kind: type, id: p.id, name: p.name, icon: p.icon, inlets: p.inlets, outlets: p.outlets, supportedDatatypes: p.supportedDatatypes, tags: p.tags };
    }
    return { kind: "unknown", id: x };
  }
  if (x && typeof x === "object") {
    if (typeof x.connect === "function") return { kind: "opstream", readonly: typeof x.apply !== "function", complement: x.complement, schema: !!x.schema, valueType: typeof x.value };
    if (x.type && x.id) return { kind: x.type, id: x.id, name: x.name, inlets: x.inlets, outlets: x.outlets };
    return { kind: "object", keys: Object.keys(x) };
  }
  return { kind: typeof x, value: x };
}

export function createSketchyApi({ repo, element } = {}) {
  const protocols = createProtocols();
  if (repo) protocols.register("automerge", automergeProtocol(repo));

  return {
    repo,
    element,
    // url → opstream (via registered protocol handlers)
    find: (url, opts) => protocols.find(url, opts),
    registerProtocol: protocols.register,
    protocols,
    // editor registry
    editors: listEditors,
    editorsFor,
    // introspection
    describe,
  };
}
