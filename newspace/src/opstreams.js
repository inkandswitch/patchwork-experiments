// Opstreams — ported from littlebook (lb/littlebook/system/core/opstreams.ts)
// with three changes:
//
//   1. ONE op + snapshot (see ops.js). The Text/JSON/Bytes opstream classes
//      collapse into a single `Opstream` that applies the universal op via
//      `applyOp`.
//   2. a **complement**: a sidecar of capabilities/metadata that flows DOWN a
//      transform chain even when an intermediate transform ignores it. Capabilities
//      are FUNCTIONS whose presence is the affordance (a file carries `save()` and
//      which automerge handle backs it); a lowercaser passes them straight through;
//      codemirror feature-detects them.
//   3. the automerge doc is attached to the OPSTREAM (`automergeTextOpstream`),
//      not to whatever consumes it.
//
// The Solid binding is an OUTER wrapper (`opstreamToSignal`) — lb's `opsignals`
// class hierarchy was a mistake; we don't port it.

import { splice as amSplice, view as amView } from "@automerge/automerge";
import { createSignal, onCleanup } from "solid-js";
import { createEmitter } from "./util/emitter.js";
import { snapshot, isSnapshot, errorOp } from "./ops.js";

export * from "./ops.js";

// ── apply: the universal patcher ─────────────────────────────────────────────
// COPY-ON-WRITE: returns the (possibly new) value with structural sharing — the
// touched path is copied, untouched subtrees are shared by reference, and the
// input is never mutated. (string/Uint8Array roots are immutable so a new value
// comes back; objects/arrays are rebuilt immutably too, which suits Solid.)
// `path` navigates to the container; `range` is a [from,to] splice or a key
// assignment (value omitted ⇒ delete).
export function apply(value, op) {
  const path = op.path || [];
  if (path.length === 0) return patchHere(value, op.range, op.value);
  const [head, ...rest] = path;
  const child = patchPath(value?.[head], rest, op);
  return setKey(value, head, child);
}

function patchPath(node, path, op) {
  if (path.length === 0) return patchHere(node, op.range, op.value);
  const [head, ...rest] = path;
  return setKey(node, head, patchPath(node?.[head], rest, op));
}

function patchHere(container, range, value) {
  if (Array.isArray(range)) {
    const [from = 0, to = from] = range;
    // a string container OR an empty/undefined one spliced with a STRING value → TEXT. The
    // null case matters: an unwired text buffer starts as Opstream(undefined), so without
    // this its first keystroke would fall to the array branch and the value becomes an array.
    if (typeof container === "string" || (container == null && typeof value === "string")) {
      const base = typeof container === "string" ? container : "";
      return base.slice(0, from) + (value == null ? "" : value) + base.slice(to);
    }
    if (container instanceof Uint8Array) {
      const insert = value == null ? [] : Array.from(value);
      const out = [...container.slice(0, from), ...insert, ...container.slice(to)];
      return Uint8Array.from(out);
    }
    const copy = (container || []).slice();
    copy.splice(from, to - from, ...(value == null ? [] : [].concat(value)));
    return copy;
  }
  // assign / delete at key `range`
  if (value === undefined) {
    if (Array.isArray(container)) {
      const c = container.slice();
      c.splice(range, 1);
      return c;
    }
    const c = { ...container };
    delete c[range];
    return c;
  }
  return setKey(container, range, value);
}

function setKey(container, key, value) {
  if (Array.isArray(container)) {
    const c = container.slice();
    c[key] = value;
    return c;
  }
  return { ...(container || {}), [key]: value };
}

// ── base Opstream (in-memory) ────────────────────────────────────────────────
// `connect(cb)` sends a snapshot immediately, then streams ops. `apply` patches
// the value via `applyOp` (or replaces it on a snapshot) and emits.
export class Opstream {
  constructor(initialValue, { complement = {}, schema } = {}) {
    this.val = initialValue;
    this.complement = complement;
    this.schema = schema;
    this._version = 0;
    this.emitter = createEmitter();
  }
  get value() {
    return this.val;
  }
  get version() {
    return this._version;
  }
  connect(callback) {
    const off = this.emitter.on("op", callback);
    callback(snapshot(this.value));
    return off;
  }
  apply(op, agent) {
    // bare `apply` here is the module-level free function (a method name is not a
    // lexical binding in its own body), not this method — COW-patches the value
    this.val = isSnapshot(op) ? op.value : apply(this.val, op);
    this.emitter.emit("op", op, agent);
    this._version++;
  }
}

// ── Source: a read-only opstream (output only) ───────────────────────────────
// "a source here is an edge" — an output port that emits snapshots and never
// takes `apply`. Used for the read side of a transform / an outlet.
export class Source {
  constructor(value, { complement = {}, schema } = {}) {
    this._val = value;
    this.complement = complement;
    this.schema = schema;
    this.emitter = createEmitter();
  }
  get value() {
    return this._val;
  }
  get error() { return this._error || null; }
  push(value) {
    this._val = value;
    this._error = null; // a fresh value clears the error state
    this.emitter.emit("op", snapshot(value));
  }
  // emit an ERROR down the stream (keeps the last good value; marks `.error`)
  pushError(e) {
    const op = errorOp(e);
    this._error = op.error;
    this.emitter.emit("op", op);
  }
  connect(callback) {
    const off = this.emitter.on("op", callback);
    callback(snapshot(this.value));
    if (this._error) callback(errorOp(this._error)); // late subscribers see the error too
    return off;
  }
}

// ── transform: derive an opstream, COMPLEMENT PASSES THROUGH ─────────────────
// An edit lens, with the two modes you can pick between per-lens:
//
//   (a) MAP THE OP — `spec.map(op, source) -> op' | op'[] | null`. The incoming
//       op is rewritten into the equivalent op(s) on the derived domain and
//       forwarded. Preserves granularity (a splice stays a splice → cursor-stable
//       through the lens). `null` drops it. Use for ~bijective lenses.
//   (b) RECOMPUTE — omit `map`. On any source op the projected value is
//       re-snapshotted downstream (a fresh op describing the new state). Use for
//       computed / non-1:1 views.
//
// `spec.value(sourceValue) -> derivedValue` projects the read value (used for
// `.value`, the connect snapshot, and mode (b)). `spec.apply(op, source)` writes
// back — itself either mapping the view-op to source op(s) or appending new ones.
// `spec.complement` EXTENDS the inherited complement; omit it and the source's
// complement passes through unchanged.
export function transform(source, spec = {}) {
  const project = spec.value || ((v) => v);
  const map = spec.map;
  const emitter = createEmitter();
  const off = source.connect((o) => {
    if (isSnapshot(o)) return emitter.emit("op", snapshot(project(source.value)));
    if (map) {
      const mapped = map(o, source);
      if (mapped == null) return;
      for (const m of [].concat(mapped)) emitter.emit("op", m);
    } else {
      emitter.emit("op", snapshot(project(source.value)));
    }
  });

  return {
    schema: spec.schema,
    complement: spec.complement
      ? { ...source.complement, ...spec.complement }
      : source.complement, // PASSTHROUGH
    get value() {
      return project(source.value);
    },
    connect(callback) {
      const o = emitter.on("op", callback);
      callback(snapshot(project(source.value)));
      return o;
    },
    apply: spec.apply ? (op, agent) => spec.apply(op, source, agent) : undefined,
    disconnect() {
      off();
    },
  };
}

// ── automerge bridge (generic) ───────────────────────────────────────────────
// The automerge doc is attached HERE, not to whatever consumes the stream — the
// consumer "doesn't know thing 1 about automerge".
//
// `automergeOpstream(handle)` streams the WHOLE doc; pass `{path}` to scope to a
// subtree (e.g. `["content"]` for a text field). Works for ANY shape: ops are the
// universal {path, range, value} (relative to the stream's value). `apply`
// translates an op into automerge mutations (string/list splice, object
// assign/delete); remote changes translate automerge *patches* back into ops so
// consumers can map granular edits (cursor-stable), falling back to a snapshot
// when a patch can't be expressed as an op.
//
// Pass `{heads}` to pin the stream to a historical version: the value is frozen at
// those heads and the returned stream has NO `apply` — read-only is the *absence*
// of apply (feature-detected), not a boolean flag, mirroring how a capability is
// the presence of its function. (`Source` is the same shape: connect, no apply.)
export function automergeOpstream(handle, { path = [], heads, schema, ...meta } = {}) {
  if (heads) {
    const readAt = () => nodeAt(amView(handle.doc(), heads), path);
    return {
      schema,
      complement: { automerge: true, handle, url: handle.url, path, heads, ...meta },
      get value() {
        return readAt();
      },
      connect(callback) {
        callback(snapshot(readAt())); // frozen — one snapshot, never changes
        return () => {};
      },
      // no `apply` → read-only
      disconnect() {},
    };
  }

  const read = () => nodeAt(handle.doc(), path);

  const emitter = createEmitter();
  let applyingLocally = false;

  const onChange = (payload) => {
    if (applyingLocally) return;
    const ops = patchesToOps(payload?.patches, path);
    if (ops === null) emitter.emit("op", snapshot(read())); // not op-expressible
    else for (const o of ops) emitter.emit("op", o); // [] ⇒ nothing relevant, no emit
  };
  handle.on("change", onChange);

  const change = (fn) => {
    applyingLocally = true;
    try {
      handle.change(fn);
    } finally {
      applyingLocally = false;
    }
  };

  const self = {
    schema,
    complement: { automerge: true, handle, url: handle.url, path, ...meta },
    get value() {
      return read();
    },
    connect(callback) {
      const off = emitter.on("op", callback);
      callback(snapshot(read()));
      return off;
    },
    apply(op, _agent) {
      if (isSnapshot(op)) {
        change((d) => replaceAt(d, path, op.value));
        emitter.emit("op", op);
        return;
      }
      const absPath = path.concat(op.path || []);
      change((d) => applyAutomerge(d, absPath, op.range, op.value));
      emitter.emit("op", op);
    },
    disconnect() {
      handle.off("change", onChange);
    },
  };
  return self;
}

// A text-field convenience: the value is the string at `path`, complement carries
// the file metadata a text editor reads (mime/name/extension). Thin wrapper over
// the generic bridge.
//
// CAPABILITIES ARE FUNCTIONS. A capability lives in the complement as a function
// whose *presence is the affordance* — `complement.save?.()` rather than a
// `saveable` boolean (which would only say a capability exists, not how to use
// it). An automerge stream auto-persists, so it carries no `save`; a backend that
// needs explicit saving (e.g. a real file) supplies `save` via `meta`, and it
// passes through the lens chain like any other complement entry.
export function fileTextOpstream(handle, { path = ["content"], ...meta } = {}) {
  return automergeOpstream(handle, {
    path,
    mimeType: handle.doc()?.mimeType,
    name: handle.doc()?.name,
    extension: handle.doc()?.extension,
    ...meta,
  });
}

// navigate to the value at `path`
function nodeAt(root, path) {
  let n = root;
  for (const k of path) n = n == null ? n : n[k];
  return n;
}

// apply a universal op to an automerge draft at an absolute `path`
export function applyAutomerge(draft, path, range, value) {
  if (Array.isArray(range)) {
    const [from = 0, to = from] = range;
    const target = nodeAt(draft, path);
    if (typeof target === "string") {
      amSplice(draft, path, from, to - from, value == null ? "" : value);
    } else if (Array.isArray(target)) {
      // a LIST splice — use the proxy's splice so OBJECT elements are materialised correctly
      // (automerge's `splice()` helper is for text/scalars; it won't insert object values).
      target.splice(from, to - from, ...(value == null ? [] : [].concat(value)));
    } else {
      // bytes / scalar: COW-rebuild the whole value and assign it
      replaceAt(draft, path, apply(target, { path: [], range, value }));
    }
    return;
  }
  // assign / delete at key `range`
  const container = nodeAt(draft, path);
  if (value === undefined) {
    if (Array.isArray(container)) container.splice(range, 1);
    else delete container[range];
  } else {
    container[range] = value;
  }
}

// replace the value at `path` (used by snapshot / scalar rebuild)
function replaceAt(draft, path, value) {
  if (path.length === 0) {
    for (const k of Object.keys(draft)) delete draft[k];
    Object.assign(draft, value);
    return;
  }
  const target = nodeAt(draft, path);
  if (typeof target === "string") {
    amSplice(draft, path, 0, target.length, value);
    return;
  }
  const parent = nodeAt(draft, path.slice(0, -1));
  parent[path[path.length - 1]] = value;
}

// translate automerge change patches into universal ops, relative to `boundPath`.
// returns `[]` when nothing under the scope changed, or `null` when a patch can't
// be expressed as an op (caller resnapshots).
export function patchesToOps(patches, boundPath) {
  const ops = [];
  for (const p of patches || []) {
    const pp = p.path || [];
    // share boundPath as a prefix? (compare up to the shorter length)
    const n = Math.min(pp.length, boundPath.length);
    let prefixMatch = true;
    for (let i = 0; i < n; i++)
      if (pp[i] !== boundPath[i]) {
        prefixMatch = false;
        break;
      }
    if (!prefixMatch) continue; // a sibling elsewhere — ignore
    if (pp.length <= boundPath.length) return null; // the scope itself / an ancestor changed
    const rel = pp.slice(boundPath.length);
    const key = rel[rel.length - 1];
    const container = rel.slice(0, -1);
    switch (p.action) {
      case "splice": // text insert
        ops.push({ path: container, range: [key, key], value: typeof p.value === "string" ? p.value : "" });
        break;
      case "insert": // list insert
        ops.push({ path: container, range: [key, key], value: p.values ?? [] });
        break;
      case "del":
        if (typeof key === "number")
          ops.push({ path: container, range: [key, key + (p.length ?? 1)], value: undefined });
        else ops.push({ path: container, range: key, value: undefined }); // object key
        break;
      case "put":
        ops.push({ path: container, range: key, value: p.value });
        break;
      default:
        return null; // inc / conflict / unknown → resnapshot
    }
  }
  return ops;
}

// ── outer Solid binding (replaces lb's opsignals) ────────────────────────────
// Wrap ANY opstream into a Solid accessor. Inside a reactive root the connection
// is torn down on cleanup; otherwise call the returned `.dispose`.
export function opstreamToSignal(opstream) {
  const [get, set] = createSignal(opstream.value);
  const off = opstream.connect((o) => set(() => (isSnapshot(o) ? o.value : opstream.value)));
  try {
    onCleanup(off);
  } catch {
    // not in a reactive root — caller disposes via `.dispose`
  }
  get.dispose = off;
  return get;
}
