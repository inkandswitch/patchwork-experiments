// The wire brush's brain — pure, testable logic the canvas gesture consumes.
//
// A PORT is any element carrying `data-automerge-url` + `data-automerge-path`
// (a form input, an editor outlet, …). Grabbing a port yields `{url, path}`, from
// which a live `automergeOpstream(handle, {path})` is rebuilt. Dropping it either
// rewires a matching editor inlet, or — on empty canvas — places a new
// `sketchy:editor` whose inlet accepts the stream's type.

// Walk up from `el` to the nearest port and describe it. Two kinds:
//   { kind:"context",   name }         — a canvas context outlet (camera/pointer/…),
//                                         whose opstream IS `context[name]` directly
//   { kind:"automerge", url, path }     — a data-automerge-* element (a form field, …)
export function readPort(el) {
  const peerEl = el && el.closest && el.closest("[data-sketchy-peer]");
  if (peerEl) {
    const contactUrl = peerEl.dataset.sketchyPeer || peerEl.getAttribute("data-sketchy-peer");
    const part = peerEl.dataset.sketchyPart || peerEl.getAttribute("data-sketchy-part");
    if (contactUrl && part) return { kind: "peer", contactUrl, part, element: peerEl };
  }
  const ctxEl = el && el.closest && el.closest("[data-sketchy-port]");
  if (ctxEl) {
    const name = ctxEl.dataset.sketchyPort || ctxEl.getAttribute("data-sketchy-port");
    if (name) return { kind: "context", name, element: ctxEl };
  }
  // a node outlet — another item's derived stream (e.g. a lens's output)
  const nodeEl = el && el.closest && el.closest("[data-sketchy-node]");
  if (nodeEl) {
    const node = nodeEl.dataset.sketchyNode || nodeEl.getAttribute("data-sketchy-node");
    const outlet = nodeEl.dataset.sketchyOutlet || nodeEl.getAttribute("data-sketchy-outlet");
    if (node && outlet) return { kind: "node", node, outlet, element: nodeEl };
  }
  // an INLET — a sink you can ALSO grab a wire from (drag backwards to find a source)
  const inEl = el && el.closest && el.closest("[data-sketchy-inlet]");
  if (inEl) {
    const node = inEl.dataset.itemId || inEl.getAttribute("data-item-id");
    const inlet = inEl.dataset.sketchyInlet || inEl.getAttribute("data-sketchy-inlet");
    if (node && inlet) return { kind: "inlet", node, inlet, element: inEl };
  }
  const port = el && el.closest && el.closest("[data-automerge-path]");
  if (!port) return null;
  const url = port.dataset.automergeUrl || port.getAttribute("data-automerge-url");
  let path;
  try {
    path = JSON.parse(port.dataset.automergePath ?? port.getAttribute("data-automerge-path"));
  } catch {
    return null;
  }
  if (!url || !Array.isArray(path)) return null;
  return { kind: "automerge", url, path, element: port };
}

// The persisted wiring for a port — what an editor item stores on its inlet. A
// context port stores `{context:name}`; an automerge port stores `{url,path}`.
export function portWiring(port) {
  if (!port) return null;
  if (port.kind === "context") return { context: port.name };
  if (port.kind === "peer") return { peer: port.contactUrl, part: port.part };
  if (port.kind === "node") return { node: port.node, outlet: port.outlet };
  return { url: port.url, path: port.path };
}

// Coarse type of a value (the type-tag fallback when an inlet has no schema).
export function valueType(v) {
  if (typeof v === "string") return "text";
  if (v instanceof Uint8Array) return "bytes";
  return "json";
}
export const streamType = (stream) => valueType(stream && stream.value);

// Does an inlet accept a value? Prefer the inlet's STANDARD SCHEMA (`accepts`/
// `schema`) — validate the value against it; an inlet with no schema falls back to
// the coarse `type` tag. This is the whiteboard's `accepts: schema` model.
export function inletAcceptsValue(inlet, value) {
  const schema = inlet && (inlet.schema || inlet.accepts);
  if (schema && schema["~standard"]) {
    try {
      const out = schema["~standard"].validate(value);
      return !(out && out.issues); // no issues ⇒ accepts
    } catch {
      return false;
    }
  }
  return inletAcceptsType(inlet, valueType(value));
}

// type-tag fallback (untyped/"json" inlet accepts anything)
export function inletAcceptsType(inlet, type) {
  if (!inlet || inlet.type == null) return true;
  if (inlet.type === "json") return true;
  return inlet.type === type;
}

// The first inlet that accepts `value` (prefers a required one).
export function firstMatchingInlet(editor, value) {
  const inlets = editor.inlets || [];
  return (
    inlets.find((i) => i.required && inletAcceptsValue(i, value)) ||
    inlets.find((i) => inletAcceptsValue(i, value)) ||
    null
  );
}

// The first inlet of `defs` that accepts a source with a KNOWN outlet type — matched
// by declared type (`outletFeedsInlet`), which is what makes a bang→bang (or any
// semantic type whose VALUE looks like plain json) connection work. Falls back to
// value-based matching when the outlet type is unknown.
export function firstMatchingInletForOutlet(defs, outletType, value) {
  const inlets = defs || [];
  if (outletType == null) return firstMatchingInlet({ inlets }, value);
  return (
    inlets.find((i) => i.required && outletFeedsInlet({ type: outletType }, i)) ||
    inlets.find((i) => outletFeedsInlet({ type: outletType }, i)) ||
    null
  );
}

// Editors with an inlet that accepts the stream's current value (schema-checked).
export function editorsForStream(editors, stream) {
  const v = stream && stream.value;
  return (editors || []).filter((e) => (e.inlets || []).some((i) => inletAcceptsValue(i, v)));
}

// Can an OUTLET feed an INLET? (type-tag compatibility, permissive: a json/untyped
// port on either side matches anything — finer checks happen on the live value.)
export function outletFeedsInlet(outlet, inlet) {
  if (!outlet) return false;
  const it = inlet && inlet.type, ot = outlet.type;
  if (it == null || it === "json") return true; // inlet accepts anything
  if (ot == null || ot === "json") return true; // outlet can produce anything
  return ot === it;
}

// Descriptors that have an outlet which could feed `inlet` — i.e. "anything matching
// that schema", for the menu you get when dropping an inlet on empty canvas.
export function descriptorsFeeding(descriptors, inlet) {
  return (descriptors || []).filter((d) => (d.outlets || []).some((o) => outletFeedsInlet(o, inlet)));
}

// The set of canvas context outlets (camera/pointer/…) currently IN USE — i.e.
// referenced by some editor inlet OR by a floating top-layer inspector's source.
// These stay visible after the wire tool is deselected. Floats live in user state
// (the top layer), so they must be scanned too — missing them is why an in-use
// outlet would vanish when the wire tool turned off.
export function usedContextOutlets(items = [], floats = []) {
  const s = new Set();
  for (const it of items) {
    if (!it || it.kind !== "editor" || !it.inlets) continue;
    for (const w of Object.values(it.inlets)) if (w && w.context) s.add(w.context);
  }
  for (const f of floats) {
    if (f && f.source && f.source.context) s.add(f.source.context);
  }
  return s;
}

let n = 0;
// Build an `editor` item for the layout doc. `inlets` maps a port name to a
// wiring `{url, path, heads?}` (live by default — pin with `heads` for read-only).
export function makeEditorItem({ id, editorId, x, y, w = 360, h = 260, inlets = {}, rotation, parent }, seed) {
  const it = {
    id: id || "ed-" + (seed != null ? seed : Date.now().toString(36)) + "-" + n++,
    kind: "editor",
    editorId,
    x,
    y,
    w,
    h,
    inlets,
  };
  if (rotation) it.rotation = rotation;
  if (parent) it.parent = parent;
  return it;
}
