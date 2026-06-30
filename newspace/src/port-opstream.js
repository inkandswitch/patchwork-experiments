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
import { apply } from "./opstreams.js";
import { snapshot, isSnapshot } from "./ops.js";

const opShaped = (x) => !!x && typeof x === "object" && (x.type === "snapshot" || "range" in x || "path" in x);

// CONSUMER: wrap a port as a bidirectional opstream. `value` seeds the local mirror until the
// first snapshot arrives from the provider.
export function portOpstream(port, { value } = {}) {
  let val = value;
  const subs = new Set();
  const fire = (op) => { for (const cb of [...subs]) cb(op); };
  port.onmessage = (e) => {
    const op = e.data; if (!opShaped(op)) return;
    val = isSnapshot(op) ? op.value : apply(val, op); // mirror the provider's state locally
    fire(op);
  };
  if (port.start) port.start();
  return {
    get value() { return val; },
    connect(cb) { subs.add(cb); cb(snapshot(val)); return () => subs.delete(cb); },
    apply(op) {
      // optimistic: update + notify local subscribers now, and send the op upstream
      val = isSnapshot(op) ? op.value : apply(val, op);
      fire(op);
      try { port.postMessage(op); } catch {}
    },
    close() { try { port.onmessage = null; port.close && port.close(); } catch {} },
  };
}

// PROVIDER: bridge a real opstream to a port. Forwards the stream's ops out to the port
// (starting with its current snapshot), and applies ops received from the port back into the
// stream. `fromPort` stops an applied op from being echoed straight back out.
export function serveOpstreamOverPort(stream, port) {
  if (!stream) return () => {};
  let fromPort = false;
  const off = stream.connect ? stream.connect((op) => { if (!fromPort) { try { port.postMessage(op); } catch {} } }) : null;
  port.onmessage = (e) => {
    const op = e.data; if (!opShaped(op) || typeof stream.apply !== "function") return;
    fromPort = true;
    try { stream.apply(op); } finally { fromPort = false; }
  };
  if (port.start) port.start();
  return () => { if (off) off(); try { port.onmessage = null; } catch {} };
}
