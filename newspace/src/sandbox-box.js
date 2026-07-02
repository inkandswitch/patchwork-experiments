// A SANDBOX box — a box that IS an iframe boundary. JavaScript arriving on the
// `code` inlet (wire it from codemirror's `text`, or an LLM node's code outlet)
// runs INSIDE a sandboxed iframe (`sandbox="allow-scripts"` ONLY — no same-origin,
// so a different realm AND an opaque origin) — never in the host realm. The code
// sees a tiny runtime:
//
//   input       — a live opstream MIRROR of the `in` inlet ({ value, connect,
//                 apply }), fed over a MessagePort by serveOpstreamOverPort
//                 (which rebases stale ops, so concurrent edits are safe);
//                 `input.apply(op)` writes back when `in` is editable
//   output(v)   — pushes a value to the node's `out` outlet (a snapshot over the port)
//   complement  — the `in` stream's complement ACROSS the boundary (boundary.js):
//                 plain data by value, capability functions as async stubs —
//                 `complement.save?.()` feature-detects exactly like on the host
//   dropped     — the complement fields that could NOT cross (live handles etc.)
//
// New code on the inlet TEARS DOWN the old iframe and boots a fresh one — a fresh
// realm, no leftover globals. Errors inside the iframe (syntax error, throw,
// unhandled rejection) surface on the out stream's ERROR channel (out.pushError,
// like js-node) instead of vanishing into the frame. The user code crosses via
// postMessage — it is never interpolated into the srcdoc, so there is no HTML
// escaping surface; the srcdoc is a constant bootstrap.
//
// Boot handshake: host appends the iframe (srcdoc = bootstrapSrc()) → on `load`
// it makes three MessageChannels and posts { type:"sandbox:init", code } with
// [inPort, boundaryPort, outPort] transferred. The guest wires its mirrors, waits
// for the boundary complement to cross, then runs the code as an AsyncFunction.
import { Source, apply as applyOp } from "./opstreams.js";
import { isSnapshot, isError, isOp } from "./ops.js";
import { serveOpstreamOverPort } from "./port-opstream.js";
import { serveBoundary } from "./boundary.js";

// ── the guest realm's op patcher ─────────────────────────────────────────────
// A SELF-CONTAINED mirror of opstreams.js `apply` (COW; `path` navigates to the
// container; `range` = [from,to] splice on string/bytes/list | key assign/delete;
// negative indices resolve against length). Self-contained because its SOURCE is
// inlined into the iframe bootstrap via toString() — it may not close over
// anything in this module. Exported so the mirror is testable against the real one.
export function guestApply(value, op) {
  const idx = (container, key) =>
    typeof key === "number" && key < 0 &&
    (Array.isArray(container) || typeof container === "string" || container instanceof Uint8Array)
      ? container.length + key
      : key;
  const setKey = (container, key, v) => {
    if (Array.isArray(container)) { const c = container.slice(); c[idx(c, key)] = v; return c; }
    const c = { ...(container || {}) }; c[key] = v; return c;
  };
  const patchHere = (container) => {
    if (Array.isArray(op.range)) {
      const [from = 0, to = from] = op.range;
      if (typeof container === "string" || (container == null && typeof op.value === "string")) {
        const base = typeof container === "string" ? container : "";
        return base.slice(0, from) + (op.value == null ? "" : op.value) + base.slice(to);
      }
      if (container instanceof Uint8Array) {
        const insert = op.value == null ? [] : Array.from(op.value);
        return Uint8Array.from([...container.slice(0, from), ...insert, ...container.slice(to)]);
      }
      const copy = (container || []).slice();
      copy.splice(from, to - from, ...(op.value == null ? [] : [].concat(op.value)));
      return copy;
    }
    const key = idx(container, op.range);
    if (op.value === undefined) {
      if (Array.isArray(container)) { const c = container.slice(); c.splice(key, 1); return c; }
      const c = { ...container }; delete c[key]; return c;
    }
    return setKey(container, key, op.value);
  };
  const patch = (node, path) => {
    if (path.length === 0) return patchHere(node);
    const h = idx(node, path[0]);
    return setKey(node, h, patch(node == null ? undefined : node[h], path.slice(1)));
  };
  return patch(value, op.path || []);
}

// ── the bootstrap srcdoc ─────────────────────────────────────────────────────
// A CONSTANT page (no user code in it). It installs a message listener, and on
// `sandbox:init` builds the runtime: an input mirror on the in-port (counting
// revs and tagging its upstream ops `basedOn`, portOpstream's consumer face, so
// the host can rebase stale writes), the boundary client on the cap-port, and
// `output` on the out-port. Errors post error ops out. Then it runs the code.
export function bootstrapSrc() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent}</style></head><body><script>
"use strict";
const guestApply = ${guestApply.toString()};
addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.type !== "sandbox:init" || !e.ports || e.ports.length < 3) return;
  const [inPort, capPort, outPort] = e.ports;
  // ── out: output(value) posts a snapshot; every failure posts an error op ──
  const output = (value) => outPort.postMessage({ type: "snapshot", value });
  const fail = (err) => { try { outPort.postMessage({ type: "error", error: err && err.message ? err.message : String(err) }); } catch {} };
  addEventListener("error", (ev) => fail(ev.error || ev.message));
  addEventListener("unhandledrejection", (ev) => fail(ev.reason));
  // ── input: a live mirror of the host's in-stream (the portOpstream consumer face) ──
  let val, rev = 0;
  const subs = new Set();
  const isSnap = (x) => !!x && x.type === "snapshot";
  const opShaped = (x) => !!x && typeof x === "object" && (x.type === "snapshot" || "range" in x || "path" in x);
  const fire = (op) => { for (const cb of [...subs]) { try { cb(op); } catch (err) { fail(err); } } };
  inPort.onmessage = (ev) => {
    const op = ev.data; if (!opShaped(op)) return;
    rev++; // counts in step with the host's rev (the port is ordered + reliable)
    val = isSnap(op) ? op.value : guestApply(val, op);
    fire(op);
  };
  inPort.start && inPort.start();
  const input = {
    get value() { return val; },
    connect(cb) { subs.add(cb); try { cb({ type: "snapshot", value: val }); } catch (err) { fail(err); } return () => subs.delete(cb); },
    apply(op) {
      val = isSnap(op) ? op.value : guestApply(val, op); // optimistic
      fire(op);
      try { inPort.postMessage(isSnap(op) ? op : { ...op, basedOn: rev }); } catch (err) { fail(err); } // basedOn ⇒ the host can rebase a stale op
    },
  };
  // ── complement: the boundary client — data + async capability stubs ──
  let call = 0;
  const pending = new Map();
  capPort.onmessage = (ev) => {
    const b = ev.data; if (!b || typeof b !== "object") return;
    if (b.type === "boundary:result") {
      const p = pending.get(b.id); if (!p) return; pending.delete(b.id);
      if (b.error !== undefined) p.reject(new Error(b.error)); else p.resolve(b.value);
    } else if (b.type === "boundary:complement") {
      const complement = { ...(b.data || {}) };
      for (const cap of b.capabilities || []) {
        complement[cap.name] = (...args) => new Promise((resolve, reject) => {
          const id = ++call;
          pending.set(id, { resolve, reject });
          try { capPort.postMessage({ type: "boundary:call", id, name: cap.name, args }); }
          catch (err) { pending.delete(id); reject(err); } // non-clonable args refuse locally
        });
      }
      run(complement, b.dropped || []);
    } else if (b.type === "boundary:close") {
      for (const p of pending.values()) p.reject(new Error("boundary closed"));
      pending.clear();
    }
  };
  capPort.start && capPort.start();
  // ── run the user code once the complement has crossed (so it's a value, not a promise) ──
  const run = (complement, dropped) => {
    try {
      const AsyncFunction = (async () => {}).constructor;
      const fn = new AsyncFunction("input", "output", "complement", "dropped", m.code);
      Promise.resolve(fn(input, output, complement, dropped)).catch(fail);
    } catch (err) { fail(err); } // a syntax error surfaces on the host's error channel
  };
});
<\/script></body></html>`;
}

// ── the host side of the out-port ────────────────────────────────────────────
// The guest's messages ARE the op vocabulary: a snapshot sets the outlet, an
// error op surfaces on the outlet's error channel (red wire + status), and a
// fine-grained op patches the outlet's last value. Pure-ish (a message handler
// over a Source) so it's testable without an iframe.
export function makeOutSink(out, setStatus = () => {}) {
  return (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (isError(msg)) { out.pushError(msg.error); setStatus(`⚠ ${msg.error}`); return; }
    if (isSnapshot(msg)) { out.push(msg.value); setStatus("running"); return; }
    if (isOp(msg)) { out.push(applyOp(out.value, msg)); setStatus("running"); }
  };
}

// ── the node mount ───────────────────────────────────────────────────────────
export function mountSandbox({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const out = new Source(undefined);
  if (setOutlet) setOutlet("out", out);

  const root = document.createElement("div");
  root.className = "ns-sandbox ns-source";
  root.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;";
  const frameHost = document.createElement("div");
  frameHost.className = "ns-sandbox-frame";
  frameHost.style.cssText = "flex:1 1 auto;min-height:0;";
  const status = document.createElement("div");
  status.className = "ns-source-status";
  root.append(frameHost, status);
  element.append(root);
  const setStatus = (t) => { status.textContent = t; };

  // one world at a time: the current iframe + everything serving into it
  let booted = null; // { frame, stops }
  let bootedCode = null;
  const teardown = () => {
    if (!booted) return;
    for (const stop of booted.stops) { try { stop(); } catch {} }
    booted.frame.remove();
    booted = null;
    bootedCode = null;
  };

  const boot = (code) => {
    teardown();
    bootedCode = code;
    setStatus("booting…");
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts"); // scripts yes, same-origin NO — a real boundary
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent;";
    frame.srcdoc = bootstrapSrc(); // constant bootstrap — the code crosses via postMessage below
    const stops = [];
    frame.addEventListener("load", () => {
      if (!booted || booted.frame !== frame) return; // superseded before it loaded
      const src = inlets.in;
      const inCh = new MessageChannel(), capCh = new MessageChannel(), outCh = new MessageChannel();
      // `in` crosses as a real opstream (op-rebased); its complement crosses the boundary
      if (src && src.connect) stops.push(serveOpstreamOverPort(src, inCh.port1));
      stops.push(serveBoundary((src && src.complement) || {}, capCh.port1));
      const sink = makeOutSink(out, setStatus);
      outCh.port1.onmessage = (e) => sink(e.data);
      if (outCh.port1.start) outCh.port1.start();
      stops.push(() => { try { outCh.port1.onmessage = null; } catch {} });
      for (const ch of [inCh, capCh, outCh])
        stops.push(() => { try { ch.port1.close && ch.port1.close(); } catch {} });
      try {
        frame.contentWindow.postMessage({ type: "sandbox:init", code }, "*", [inCh.port2, capCh.port2, outCh.port2]);
        setStatus("running");
      } catch (e) { out.pushError(e); setStatus(`⚠ ${e.message}`); }
    }, { once: true });
    frameHost.append(frame);
    booted = { frame, stops };
  };

  // code: the inlet when it carries a string, else the doc-cached copy (so a
  // refresh still runs even if the upstream source isn't producing yet)
  const codeStream = inlets.code;
  let cached = typeof config.code === "string" ? config.code : ""; // last known code (doc-persisted)
  const onCode = () => {
    const v = codeStream ? codeStream.value : undefined;
    if (typeof v === "string" && v !== cached) { cached = v; if (setConfig) setConfig({ code: v }); }
    const code = typeof v === "string" ? v : cached;
    if (!code.trim()) { teardown(); setStatus("no code"); return; }
    if (code === bootedCode) return; // same code ⇒ same world (no reboot storm on echoes)
    boot(code); // NEW code ⇒ tear the old world down, boot a fresh realm
  };
  const offCode = codeStream && codeStream.connect ? codeStream.connect(onCode) : null;
  if (!codeStream) onCode(); // unwired ⇒ boot from the cache (or report "no code")

  return () => {
    if (offCode) offCode();
    teardown();
    root.remove();
  };
}
