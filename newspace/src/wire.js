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
  return { url: port.url, path: port.path };
}

// Coarse type of a stream's value, used to match against inlet `type` tags.
// (Finer matching can compare Standard Schemas later.)
export function streamType(stream) {
  const v = stream && stream.value;
  if (typeof v === "string") return "text";
  if (v instanceof Uint8Array) return "bytes";
  return "json";
}

// Does an inlet accept a stream of `type`? An untyped or "json" inlet accepts
// anything; otherwise the tags must match.
export function inletAcceptsType(inlet, type) {
  if (!inlet || inlet.type == null) return true;
  if (inlet.type === "json") return true;
  return inlet.type === type;
}

// The first inlet of an editor that accepts `type` (prefers a required one).
export function firstMatchingInlet(editor, type) {
  const inlets = editor.inlets || [];
  return (
    inlets.find((i) => i.required && inletAcceptsType(i, type)) ||
    inlets.find((i) => inletAcceptsType(i, type)) ||
    null
  );
}

// Editors that can take a stream of this type on some inlet (for the popup).
export function editorsForStream(editors, stream) {
  const type = streamType(stream);
  return (editors || []).filter((e) => (e.inlets || []).some((i) => inletAcceptsType(i, type)));
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
