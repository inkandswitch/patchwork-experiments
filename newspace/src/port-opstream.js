// An OPSTREAM over a MessagePort — how an opstream crosses a tool↔component (or iframe)
// boundary. This is *exactly* what the op vocabulary was designed for: an op is plain JSON
// (`{ path, range, value }`) or a snapshot (`{ type:"snapshot", value }`), and a `Uint8Array`
// value rides postMessage as a transferable. So ops cross the port natively, both ways — no
// serialization layer, no "values only". You "create an opstream from the port".
//
//   portOpstream(port)         — the CONSUMER face: an opstream whose reads come from the
//                                port and whose writes (apply) post back over it.
//   serveOpstreamOverPort(s,p) — the PROVIDER side: bridge a real opstream `s` to port `p`
//                                (forward its ops out; apply incoming ops back into it).
//
// Echo is avoided by direction: the consumer's `apply` posts but doesn't loop; the provider
// doesn't re-post an op that just arrived from the port (and an automerge stream's own
// applyingLocally guard stops the doc round-trip from echoing either).
//
// RACES: ops are POSITIONAL, and a consumer op is computed against the consumer's mirror,
// which can be stale — the served value can change (a remote automerge peer, another port, a
// local edit) between the consumer computing an op and the provider receiving it, so its
// indices would splice the wrong elements. A MessagePort is a RELIABLE ORDERED channel, which
// confines the fix to this adapter, Jupiter/ShareDB-style:
//
//   • the provider keeps a monotonic `rev` — the COUNT of op-shaped messages it has posted
//     down — plus a bounded buffer of them. That stream IS the totality of mutations the
//     consumer can have missed, because every change to the served value flows down the port.
//     The port being ordered+reliable means the rev needn't ride the wire: the consumer's
//     own count of op-shaped messages received IS the provider's rev at that moment, so the
//     downward wire stays byte-identical to before.
//   • the consumer tags every op it sends up with `basedOn: <its count>`.
//   • an op arriving with `basedOn < rev` is rebased through the buffered ops it missed
//     (transformOp, ops.js) before applying; if it's untransformable, orphaned, or predates
//     the buffer window, the provider DROPS it and sends a fresh snapshot (resync — a
//     snapshot resets the consumer's mirror, and it's counted so the revs stay in step)
//
// The wire change is ADDITIVE and upstream-only: `basedOn` rides on the consumer's op
// objects; an op without it (an old consumer) behaves exactly as before (no transform).
// `basedOn` is adapter-internal — stripped before the op reaches the stream.
import { apply } from "./opstreams.js";
import { snapshot, isSnapshot, transformOp, RESYNC } from "./ops.js";

const opShaped = (x) => !!x && typeof x === "object" && (x.type === "snapshot" || "range" in x || "path" in x);

// CONSUMER: wrap a port as a bidirectional opstream. `value` seeds the local mirror until the
// first snapshot arrives from the provider.
export function portOpstream(port, { value } = {}) {
  let val = value;
  let lastRev = 0; // how many provider messages we've seen — what our ops are based on
  const subs = new Set();
  const fire = (op) => { for (const cb of [...subs]) cb(op); };
  port.onmessage = (e) => {
    const op = e.data; if (!opShaped(op)) return;
    lastRev++; // counts in step with the provider's rev (ordered reliable channel)
    val = isSnapshot(op) ? op.value : apply(val, op); // mirror the provider's state locally (a snapshot also resets a resynced mirror)
    fire(op);
  };
  if (port.start) port.start();
  return {
    get value() { return val; },
    connect(cb) { subs.add(cb); cb(snapshot(val)); return () => subs.delete(cb); },
    apply(op) {
      // optimistic: update + notify local subscribers now, and send the op upstream —
      // tagged with what it was computed against, so the provider can rebase it if stale
      val = isSnapshot(op) ? op.value : apply(val, op);
      fire(op);
      const out = isSnapshot(op) ? op : { ...op, basedOn: lastRev };
      try { port.postMessage(out); } catch {}
    },
    close() { try { port.onmessage = null; port.close && port.close(); } catch {} },
  };
}

// PROVIDER: bridge a real opstream to a port. Forwards the stream's ops out to the port
// (starting with its current snapshot), counting them as revs into a bounded buffer;
// applies ops received from the port back into the stream, rebasing stale ones through the
// buffered ops they missed. `fromPort` stops an applied op from being echoed straight back
// out. `window` bounds the rebase buffer (older ⇒ resync).
export function serveOpstreamOverPort(stream, port, { window: windowSize = 256 } = {}) {
  if (!stream) return () => {};
  let fromPort = false;
  let rev = 0; // monotonic, per served stream — the count of op-shaped messages posted
  const sent = []; // the last `windowSize` of them — contiguous revs (rev - sent.length, rev]
  const post = (op) => {
    sent.push({ rev: ++rev, op });
    if (sent.length > windowSize) sent.shift();
    try { port.postMessage(op); } catch {}
  };
  const resync = () => post(snapshot(stream.value)); // the escape hatch — never guess
  const off = stream.connect ? stream.connect((op) => {
    if (fromPort) return;
    // only op-shaped messages count as revs — the consumer counts exactly these too
    // (an error op mutates nothing and isn't op-shaped; it passes through uncounted)
    if (!opShaped(op)) { try { port.postMessage(op); } catch {} return; }
    post(op);
  }) : null;
  port.onmessage = (e) => {
    const raw = e.data; if (!opShaped(raw) || typeof stream.apply !== "function") return;
    let op = raw, basedOn;
    if (typeof raw.basedOn === "number") ({ basedOn, ...op } = raw); // basedOn is adapter-internal — strip it
    if (basedOn !== undefined && !isSnapshot(op) && basedOn < rev) {
      // the consumer hadn't seen everything we'd sent — rebase through what it missed
      if (basedOn < rev - sent.length) { resync(); return; } // predates the buffer: drop the op, don't guess
      for (const past of sent) {
        if (past.rev <= basedOn) continue;
        op = transformOp(op, past.op);
        // untransformable/orphaned (RESYNC) or collapsed to a no-op (null): drop the op —
        // and resync, because the consumer's optimistic mirror is now materially wrong
        if (op === RESYNC || op == null) { resync(); return; }
      }
    }
    fromPort = true;
    try { stream.apply(op); } finally { fromPort = false; }
  };
  if (port.start) port.start();
  return () => { if (off) off(); try { port.onmessage = null; } catch {} };
}
