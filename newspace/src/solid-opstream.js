// Solid → Opstream bridges — the INWARD direction.
//
// `opstreamToSignal` (in opstreams.js) wraps an opstream so Solid can READ it.
// This module is the mirror: it turns Solid reactivity into an opstream so the
// rest of the system (codemirror, automerge, transforms, the wire) can read and
// drive it. Two flavours, by how much granularity the source can give us:
//
//   signalToOpstream(accessor)  — a signal/memo/any reactive fn → SNAPSHOT stream.
//       A signal is opaque: when it changes we only know the new whole value, so
//       every change emits a fresh `snapshot`. Read-only unless you hand it a
//       setter, which makes `apply` write back.
//
//   storeOpstream(store, setStore) — a Solid store → REAL (granular) op stream.
//       A store IS structured, and its setter is CALLED WITH A PATH. So we wrap
//       the setter: an ordinary `set("user","name","bob")` becomes the universal
//       op {path:["user"], range:"name", value:"bob"} and streams out — a splice
//       stays a splice, cursor-stable through the chain. Incoming ops `reconcile`
//       back in, so Solid computes the minimal granular updates. Editing the store
//       the normal way and syncing it as ops become the same act.
//
// Core stays framework-agnostic (ops.js); this is an OUTER binding, like
// opstreamToSignal — no parallel class hierarchy.

import { createRenderEffect, createRoot, onCleanup, untrack } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { createEmitter } from "./util/emitter.js";
import { snapshot, isSnapshot } from "./ops.js";
import { apply } from "./opstreams.js";

// ── signalToOpstream: any reactive read → a snapshot opstream ─────────────────
// `accessor` is anything callable-and-tracked: a `createSignal` getter, a memo,
// or an arbitrary `() => derivedValue`. We run it inside our OWN root + effect so
// the stream observes changes whether or not the caller is in a reactive scope;
// the effect is torn down on `disconnect()` (and on the surrounding root's cleanup
// when there is one, mirroring opstreamToSignal).
//
// Pass `{ set }` (the matching signal setter) to make the stream writable: `apply`
// then COW-patches the current value and pushes it back through the setter — the
// change re-enters via the effect and emits, so there's exactly one outgoing op.
export function signalToOpstream(accessor, { set, schema, complement = {} } = {}) {
  const emitter = createEmitter();
  let current = untrack(accessor);
  let primed = false;

  const dispose = createRoot((dispose) => {
    // a RENDER effect: its first pass runs SYNCHRONOUSLY here, so the dependency
    // is established and primed with the true initial value before the caller can
    // mutate the signal — later passes (deferred, like a normal effect) emit.
    createRenderEffect(() => {
      const v = accessor();
      current = v;
      if (!primed) {
        primed = true; // skip the synchronous priming run — connect sends the snapshot
        return;
      }
      emitter.emit("op", snapshot(v));
    });
    return dispose;
  });

  try {
    onCleanup(dispose);
  } catch {
    // not in a reactive root — caller tears down via disconnect()
  }

  const self = {
    schema,
    complement,
    get value() {
      return current;
    },
    connect(callback) {
      const off = emitter.on("op", callback);
      callback(snapshot(current));
      return off;
    },
    disconnect() {
      dispose();
    },
  };

  if (set) {
    // writable: patch and push through the setter; the effect emits the op.
    self.apply = (op, _agent) => {
      const next = isSnapshot(op) ? op.value : apply(current, op);
      set(() => next); // function form so a callable `next` isn't taken as an updater
    };
  }

  return self;
}

// ── storeOpstream: a Solid store → a real, granular op stream ─────────────────
// Returns `[opstream, set]`. Use the returned `set` exactly like Solid's
// `setStore` — same path-arg call signatures — but every call also emits the
// equivalent universal op. The raw `setStore` you pass in is used INTERNALLY for
// `apply` (so incoming ops don't echo back out).
//
//   set("a", "b", 3)        → op {path:["a"], range:"b", value:3}
//   set("list", 0, "x")     → op {path:["list"], range:0, value:"x"}
//   set(partial) / set(produce(...)) / range & selector setters
//                           → can't be expressed as one op → root snapshot
//
// Granular incoming ops are applied with `reconcile`, which diffs the patched
// value into the store and lets Solid fire the minimal fine-grained updates.
export function storeOpstream(store, setStore, { schema, complement = {} } = {}) {
  const emitter = createEmitter();

  const set = (...args) => {
    setStore(...args);
    const op = setterArgsToOp(args, store);
    emitter.emit("op", op || snapshot(unwrap(store)));
  };

  const self = {
    schema,
    complement,
    get value() {
      return unwrap(store);
    },
    connect(callback) {
      const off = emitter.on("op", callback);
      callback(snapshot(unwrap(store)));
      return off;
    },
    // incoming op → COW-patch → reconcile in. Uses the RAW setter, so it never
    // re-enters `set` and never echoes; we emit the op explicitly for fan-out.
    apply(op, _agent) {
      const next = isSnapshot(op) ? op.value : apply(unwrap(store), op);
      setStore(reconcile(next));
      emitter.emit("op", op);
    },
  };

  return [self, set];
}

// Convenience: own the store too. `createStoreOpstream(initial)` →
// `[opstream, set, store]` (the read proxy, in case you want to render from it).
export function createStoreOpstream(initial, opts = {}) {
  const [store, setStore] = createStore(initial);
  const [opstream, set] = storeOpstream(store, setStore, opts);
  return [opstream, set, store];
}

// Translate Solid setter path-args into ONE universal op, or null when the call
// can't be expressed as a single op (whole-root merge, produce, range/selector
// setters) — the caller then resnapshots. The op's value is read back from the
// store post-set so functional updaters resolve and no store proxy leaks out.
function setterArgsToOp(args, store) {
  if (args.length < 2) return null; // set(value) / set(produce(...)) → snapshot
  const keys = args.slice(0, -1); // drop the value/updater; we re-read the value
  if (!keys.every((k) => typeof k === "string" || typeof k === "number")) return null;
  const range = keys[keys.length - 1];
  const path = keys.slice(0, -1);
  return { path, range, value: readPath(unwrap(store), keys) };
}

function readPath(root, keys) {
  let n = root;
  for (const k of keys) n = n == null ? n : n[k];
  return n;
}
