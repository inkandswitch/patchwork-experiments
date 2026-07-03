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
// RACES: ops are POSITIONAL, and each end's ops are computed against a view that can be
// stale — the served value can change (a remote automerge peer, another port, a local edit)
// between one end computing an op and the other receiving it. A MessagePort is a RELIABLE
// ORDERED channel, which confines the fix to this adapter: full TWO-SIDED Jupiter
// (client/server OT, à la ShareDB), both halves of the dual transform:
//
//   • the provider keeps a monotonic `rev` — the COUNT of op-shaped messages it has posted
//     down — plus a bounded buffer of them. That stream IS the totality of mutations the
//     consumer can have missed, because every change to the served value flows down the
//     port. The port being ordered+reliable means the rev needn't ride the wire: the
//     consumer's own count of op-shaped messages received IS the provider's rev.
//   • the consumer tags every op it sends up with `basedOn: <its count>` and a `seq`
//     (its own send counter), and keeps the op IN FLIGHT until acknowledged.
//   • PROVIDER side of the dual: an op arriving with `basedOn < rev` is folded through the
//     buffered ops it missed — the incoming op is rebased over each buffered op
//     (`transformOp`, the canonical "consumer op lands after"), AND each buffered op is
//     rewritten over the incoming one (`transformOp(…, "before")`), so buffer entries stay
//     expressed in a context that includes the consumer ops already applied — which is what
//     makes the NEXT stale consumer op fold correctly.
//   • the provider ACKS each applied consumer op (`{type:"opstream:ack", seq}` — not
//     op-shaped, so it is UNCOUNTED on both ends; the channel being ordered guarantees the
//     ack always finds the matching op at the head of the consumer's in-flight queue).
//   • CONSUMER side of the dual: an incoming provider op is folded over the in-flight queue
//     — the provider op is transformed with `"before"` (it is canonically FIRST; the
//     provider will apply ours after it), and each in-flight op is rewritten over it — then
//     applied to the local mirror. Ties therefore converge: a same-position insert-insert
//     race lands provider-first on BOTH ends.
//   • RESYNC / null transform outcomes keep the drop+snapshot escape hatch: the provider
//     drops the op and posts a fresh snapshot; a snapshot resets the consumer's mirror AND
//     clears its in-flight queue (the buffered snapshot then RESYNCs any straggler, so the
//     two ends can never wedge). A consumer-side RESYNC just drops the provider op and
//     waits: the same unreconcilable pair is, deterministically, about to make the provider
//     resync.
//
// The wire stays backwards compatible: `basedOn`/`seq` are ADDITIVE and adapter-internal
// (stripped before the op reaches the stream); an op without them (an old consumer) applies
// exactly as before (no transform, no ack); acks are ignored by anyone who doesn't know them.
import { apply } from "./opstreams.js";
import { snapshot, isSnapshot, isError, transformOp, RESYNC } from "./ops.js";

const ACK = "opstream:ack";
const opShaped = (x) => !!x && typeof x === "object" && (x.type === "snapshot" || "range" in x || "path" in x);

// ── the CONSUMER half of the protocol, extracted ─────────────────────────────
// Shared by portOpstream below and by sketchy-streams' automergeDocOverPort (the
// granular automerge-replica-over-port adapter) — one implementation of the
// in-flight queue, the rev/seq counters, and the consumer side of the dual
// transform. `receive(msg)` classifies a provider message and returns what to do:
//
//   { type: "snapshot", op }  — reset the mirror to op.value (in-flight cleared)
//   { type: "op", op }        — apply `op` (already folded over the in-flight queue)
//   { type: "error", op }     — deliver to subscribers; mutate nothing, count nothing
//   { type: "ack" }           — swallowed (in-flight head popped)
//   { type: "drop" }          — counted but unreconcilable here; the provider is
//                               about to resync (see the header) — hold position
//   { type: "ignore" }        — not part of the protocol
//
// `send(op)` tags an outgoing op with basedOn/seq and tracks it in flight
// (returning the wire form); errors pass through untagged and untracked.
export function createPortConsumerSync() {
  let lastRev = 0; // count of op-shaped provider messages seen — what our ops are based on
  let seq = 0; // our send counter — the ack correlates by it
  const inFlight = []; // { seq, op } sent-but-unacked, in order; op:null = subsumed, still awaiting its ack
  return {
    get rev() { return lastRev; },
    get inFlightCount() { return inFlight.length; },
    receive(msg) {
      if (!msg || typeof msg !== "object") return { type: "ignore" };
      if (isError(msg)) return { type: "error", op: msg }; // errors mutate nothing and are UNCOUNTED (the provider posts them outside the rev stream)
      if (msg.type === ACK) {
        // ordered channel ⇒ an ack always names the in-flight HEAD — unless a
        // snapshot already cleared the queue (a resync supersedes the acks of
        // everything it swallowed); a stray ack is simply ignored
        if (inFlight.length && inFlight[0].seq === msg.seq) inFlight.shift();
        return { type: "ack" };
      }
      if (!opShaped(msg)) return { type: "ignore" };
      lastRev++; // counts in step with the provider's rev (ordered reliable channel)
      if (isSnapshot(msg)) {
        inFlight.length = 0; // a snapshot is the resync escape hatch: it supersedes our optimism
        return { type: "snapshot", op: msg };
      }
      // the consumer half of the dual transform (see header): fold the incoming
      // provider op over our in-flight ops (it is canonically FIRST — "before"),
      // rewriting each in-flight op over it as we go. Commit the rewrites only
      // if the whole fold succeeds — a RESYNC means the provider is about to
      // snapshot us anyway (deterministically: it folds the same pairs).
      let incoming = msg;
      const rewrites = [];
      for (let i = 0; i < inFlight.length; i++) {
        const mine = inFlight[i].op;
        if (mine == null) continue; // already subsumed — transforms nothing
        const rebased = transformOp(incoming, mine, "before");
        const rewritten = transformOp(mine, incoming);
        if (rebased === RESYNC || rewritten === RESYNC) return { type: "drop" };
        rewrites.push([i, rewritten]);
        incoming = rebased;
        if (incoming == null) break; // subsumed by our own in-flight op — nothing left to apply
      }
      for (const [i, w] of rewrites) inFlight[i].op = w;
      return incoming == null ? { type: "drop" } : { type: "op", op: incoming };
    },
    send(op) {
      if (isError(op)) return op; // errors aren't positional: untagged, untracked
      seq++;
      inFlight.push({ seq, op });
      // a snapshot is absolute — no basedOn to be stale against (but it IS
      // tracked: incoming concurrent provider ops get dropped against it)
      return isSnapshot(op) ? { ...op, seq } : { ...op, basedOn: lastRev, seq };
    },
  };
}

// CONSUMER: wrap a port as a bidirectional opstream. `value` seeds the local mirror until the
// first snapshot arrives from the provider.
export function portOpstream(port, { value } = {}) {
  let val = value;
  const sync = createPortConsumerSync();
  const subs = new Set();
  const fire = (op) => { for (const cb of [...subs]) cb(op); };
  port.onmessage = (e) => {
    const r = sync.receive(e.data);
    if (r.type === "error") return fire(r.op); // delivered downstream; the value keeps its last good state
    if (r.type === "snapshot") { val = r.op.value; return fire(r.op); }
    if (r.type === "op") { val = apply(val, r.op); return fire(r.op); }
    // ack / drop / ignore: nothing to deliver
  };
  if (port.start) port.start();
  return {
    get value() { return val; },
    connect(cb) { subs.add(cb); cb(snapshot(val)); return () => subs.delete(cb); },
    apply(op) {
      // optimistic: update + notify local subscribers now, and send the op upstream —
      // tagged with what it was computed against and tracked in flight, so both ends
      // can run their half of the dual transform on a race
      val = isSnapshot(op) ? op.value : apply(val, op); // (apply() leaves the value alone for an error op)
      fire(op);
      try { port.postMessage(sync.send(op)); } catch {}
    },
    close() { try { port.onmessage = null; port.close && port.close(); } catch {} },
  };
}

// PROVIDER: bridge a real opstream to a port. Forwards the stream's ops out to the port
// (starting with its current snapshot), counting them as revs into a bounded buffer;
// applies ops received from the port back into the stream, folding stale ones through the
// buffered ops they missed (and rewriting the buffer over them — the provider half of the
// dual transform), acking each applied op by seq. `fromPort` stops an applied op from being
// echoed straight back out. `window` bounds the rebase buffer (older ⇒ resync).
export function serveOpstreamOverPort(stream, port, { window: windowSize = 256 } = {}) {
  if (!stream) return () => {};
  let fromPort = false;
  let rev = 0; // monotonic, per served stream — the count of op-shaped messages posted
  const sent = []; // the last `windowSize` of them — contiguous revs (rev - sent.length, rev]; op:null = subsumed by a later consumer op/snapshot
  const post = (op) => {
    sent.push({ rev: ++rev, op });
    if (sent.length > windowSize) sent.shift();
    try { port.postMessage(op); } catch {}
  };
  const resync = () => post(snapshot(stream.value)); // the escape hatch — never guess
  const ack = (seq) => { if (seq !== undefined) try { port.postMessage({ type: ACK, seq }); } catch {} };
  const off = stream.connect ? stream.connect((op) => {
    if (fromPort) return;
    // only op-shaped messages count as revs — the consumer counts exactly these too
    // (an error op mutates nothing and isn't op-shaped; it passes through uncounted)
    if (!opShaped(op)) { try { port.postMessage(op); } catch {} return; }
    post(op);
  }) : null;
  port.onmessage = (e) => {
    const raw = e.data; if (!opShaped(raw) || typeof stream.apply !== "function") return;
    let op = raw, basedOn, seq;
    if (typeof raw.basedOn === "number" || typeof raw.seq === "number") ({ basedOn, seq, ...op } = raw); // adapter-internal — strip before the stream sees it
    if (isSnapshot(op)) {
      // absolute: apply raw. Every buffered op is subsumed by it — null them so
      // later stale consumer ops (computed on the snapshot value) don't get
      // folded over mutations the snapshot obliterated.
      for (const past of sent) past.op = null;
      fromPort = true;
      try { stream.apply(op); } finally { fromPort = false; }
      ack(seq);
      return;
    }
    if (basedOn !== undefined && basedOn < rev) {
      // the consumer hadn't seen everything we'd sent — the provider half of the
      // dual transform: fold the op forward, rewriting the buffer over it as we
      // go (commit the rewrites only if the whole fold lands)
      if (basedOn < rev - sent.length) { resync(); return; } // predates the buffer: drop the op, don't guess
      const rewrites = [];
      for (const past of sent) {
        if (past.rev <= basedOn || past.op == null) continue;
        const rebased = transformOp(op, past.op); // the consumer op is canonically AFTER
        const rewritten = transformOp(past.op, op, "before"); // the buffered op keeps its priority
        // untransformable/orphaned (RESYNC, either direction) or collapsed to a
        // no-op (null): drop the op and resync — a snapshot resets the consumer's
        // mirror and clears its in-flight queue, so both ends restart aligned
        if (rebased === RESYNC || rebased == null || rewritten === RESYNC) { resync(); return; }
        rewrites.push([past, rewritten]);
        op = rebased;
      }
      for (const [past, w] of rewrites) past.op = w;
    }
    fromPort = true;
    try { stream.apply(op); } finally { fromPort = false; }
    ack(seq);
  };
  if (port.start) port.start();
  return () => { if (off) off(); try { port.onmessage = null; } catch {} };
}
