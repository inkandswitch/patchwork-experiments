import { describe, it, expect } from "vitest";
import { portOpstream, serveOpstreamOverPort } from "../src/port-opstream.js";
import { Opstream } from "../src/opstreams.js";

// a synchronous fake MessagePort pair (relays each side's posts to the other's onmessage)
function fakePortPair() {
  const a = { onmessage: null, postMessage: (d) => b.onmessage && b.onmessage({ data: d }) };
  const b = { onmessage: null, postMessage: (d) => a.onmessage && a.onmessage({ data: d }) };
  return [a, b];
}
const splice = (from, to, value) => ({ path: [], range: [from, to], value });

// real flow: the CONSUMER subscribes (port ready) first, THEN the provider answers + serves.
describe("portOpstream — an opstream across a MessagePort", () => {
  it("delivers the provider's snapshot + subsequent ops to the consumer", () => {
    const [p1, p2] = fakePortPair();
    const source = new Opstream("hello");
    const remote = portOpstream(p1);            // consumer ready first
    const seen = [];
    remote.connect((op) => seen.push(op));
    serveOpstreamOverPort(source, p2);          // provider answers → posts the snapshot
    expect(remote.value).toBe("hello");          // got the initial snapshot
    source.apply(splice(5, 5, " world"));        // provider edits
    expect(remote.value).toBe("hello world");    // forwarded over the port
    expect(seen.at(-1)).toEqual(splice(5, 5, " world"));
  });

  it("the consumer can WRITE back — its apply reaches the provider's stream", () => {
    const [p1, p2] = fakePortPair();
    const source = new Opstream("abc");
    const remote = portOpstream(p1);
    serveOpstreamOverPort(source, p2);
    remote.apply(splice(3, 3, "DEF"));           // consumer edits
    expect(source.value).toBe("abcDEF");          // applied to the real (provider) stream
    expect(remote.value).toBe("abcDEF");          // and reflected locally (optimistic)
  });

  it("no echo storm: a consumer write doesn't bounce back and double-apply", () => {
    const [p1, p2] = fakePortPair();
    const source = new Opstream("");
    const remote = portOpstream(p1);
    serveOpstreamOverPort(source, p2);
    remote.apply(splice(0, 0, "x"));
    remote.apply(splice(1, 1, "y"));
    expect(source.value).toBe("xy");
    expect(remote.value).toBe("xy");             // not "xyxy" / "xxyy"
  });

  it("a PROVIDER edit and a CONSUMER edit both converge", () => {
    const [p1, p2] = fakePortPair();
    const source = new Opstream("a");
    const remote = portOpstream(p1);
    serveOpstreamOverPort(source, p2);
    source.apply(splice(1, 1, "b"));   // provider → "ab"
    remote.apply(splice(2, 2, "c"));   // consumer → "abc"
    expect(source.value).toBe("abc");
    expect(remote.value).toBe("abc");
  });

  it("ignores non-op messages", () => {
    const [p1, p2] = fakePortPair();
    const remote = portOpstream(p1);
    serveOpstreamOverPort(new Opstream(1), p2);
    p1.onmessage({ data: "garbage" });
    p1.onmessage({ data: { hello: "world" } });
    expect(remote.value).toBe(1);
  });
});

// a pair where the CONSUMER→PROVIDER direction is LATCHED: the consumer's posts queue up
// until flush() — so a stale op can land AFTER the provider has moved on (the actual race).
function latchedPortPair() {
  const queue = [];
  const a = { onmessage: null, postMessage: (d) => queue.push(d) };
  const b = { onmessage: null, postMessage: (d) => a.onmessage && a.onmessage({ data: d }) };
  const flush = () => { while (queue.length) { const d = queue.shift(); b.onmessage && b.onmessage({ data: d }); } };
  return [a, b, flush, queue];
}

describe("rebase across the port — stale consumer ops (rev/basedOn)", () => {
  it("tags consumer ops with basedOn, and rev never leaks to subscribers", () => {
    const [a, b, , queue] = latchedPortPair();
    const source = new Opstream("abc");
    const remote = portOpstream(a);
    const seen = [];
    remote.connect((op) => seen.push(op));
    serveOpstreamOverPort(source, b); // snapshot = rev 1
    source.apply(splice(3, 3, "d")); // rev 2
    expect(remote.value).toBe("abcd");
    expect(seen.every((o) => !("rev" in o))).toBe(true); // adapter-internal, stripped
    remote.apply(splice(4, 4, "e"));
    expect(queue[0]).toEqual({ path: [], range: [4, 4], value: "e", basedOn: 2, seq: 1 }); // seq: the ack correlator (adapter-internal, stripped like basedOn)
  });

  it("THE RACE: a stale op is rebased over a concurrent splice at a lower index", () => {
    const [a, b, flush] = latchedPortPair();
    const source = new Opstream(["a", "b", "c"]);
    const remote = portOpstream(a);
    serveOpstreamOverPort(source, b);
    // the consumer replaces the LAST element, computed against ["a","b","c"] (rev 1)…
    remote.apply({ path: [], range: [2, 3], value: ["C"] });
    // …but before that arrives, the provider deletes element 0 (rev 2)
    source.apply({ path: [], range: [0, 1], value: undefined });
    flush(); // the stale op lands now, basedOn 1 < rev 2 → rebased to [1,2]
    expect(source.value).toEqual(["b", "C"]); // the RIGHT element got edited (not appended past the end)
    expect(remote.value).toEqual(["b", "C"]); // both sides converge
  });

  it("text race: a concurrent insert before the edit shifts the edit right", () => {
    const [a, b, flush] = latchedPortPair();
    const source = new Opstream("hello world");
    const remote = portOpstream(a);
    serveOpstreamOverPort(source, b);
    remote.apply(splice(6, 11, "there")); // replace "world", against rev 1
    source.apply(splice(0, 0, ">> ")); // provider prepends first (rev 2)
    flush();
    expect(source.value).toBe(">> hello there"); // rebased to [9,14], not clobbering "hel"
    expect(remote.value).toBe(">> hello there");
  });

  it("no concurrency: the op reaches the stream untransformed (basedOn stripped)", () => {
    const [p1, p2] = fakePortPair();
    const source = new Opstream("abc");
    const applied = [];
    const inner = source.apply.bind(source);
    source.apply = (op, agent) => { applied.push(op); inner(op, agent); };
    const remote = portOpstream(p1);
    serveOpstreamOverPort(source, p2);
    remote.apply(splice(0, 0, "x"));
    expect(applied.at(-1)).toEqual({ path: [], range: [0, 0], value: "x" }); // exactly the op, no basedOn
    expect(source.value).toBe("xabc");
  });

  it("resync: a basedOn older than the buffer window drops the op and snapshots the consumer", () => {
    const [a, b, flush] = latchedPortPair();
    const source = new Opstream(["x"]);
    const remote = portOpstream(a);
    const seen = [];
    remote.connect((op) => seen.push(op));
    serveOpstreamOverPort(source, b, { window: 2 }); // tiny buffer to force the miss
    remote.apply({ path: [], range: [1, 1], value: ["CLIENT"] }); // basedOn 1, latched
    source.apply({ path: [], range: [0, 0], value: ["h1"] }); // rev 2 — evicted below
    source.apply({ path: [], range: [0, 0], value: ["h2"] }); // rev 3
    source.apply({ path: [], range: [0, 0], value: ["h3"] }); // rev 4 — buffer holds only revs 3,4
    flush(); // basedOn 1 predates the buffer → DON'T guess: drop + snapshot
    expect(source.value).toEqual(["h3", "h2", "h1", "x"]); // the consumer's op never landed
    expect(remote.value).toEqual(source.value); // …and the snapshot resynced the mirror
    expect(seen.at(-1)).toEqual({ type: "snapshot", value: ["h3", "h2", "h1", "x"] });
  });

  it("orphaned op (its element was deleted) → dropped, consumer resynced by snapshot", () => {
    const [a, b, flush] = latchedPortPair();
    const source = new Opstream([{ id: "a" }, { id: "b" }]);
    const remote = portOpstream(a);
    const seen = [];
    remote.connect((op) => seen.push(op));
    serveOpstreamOverPort(source, b);
    remote.apply({ path: [0], range: "x", value: 9 }); // edit INSIDE element 0 (basedOn 1), latched
    source.apply({ path: [], range: [0, 1], value: undefined }); // provider deletes element 0 (rev 2)
    flush(); // the edit's target is gone — orphaned → dropped + resync
    expect(source.value).toEqual([{ id: "b" }]); // no stray x smeared onto the survivor
    expect(remote.value).toEqual([{ id: "b" }]);
    expect(seen.at(-1).type).toBe("snapshot"); // the resync escape hatch fired
  });

  it("old wire format: an op WITHOUT basedOn applies as-is, even after provider edits", () => {
    const [p1, p2] = fakePortPair();
    const source = new Opstream("abc");
    portOpstream(p1); // a consumer, so provider messages have somewhere to go
    serveOpstreamOverPort(source, p2);
    source.apply(splice(0, 0, ">")); // the provider has moved on (rev 2)
    p2.onmessage({ data: { path: [], range: [0, 0], value: "z" } }); // a legacy client: no basedOn
    expect(source.value).toBe("z>abc"); // untransformed — exactly today's behavior
  });
});

// ── the TWO-SIDED half: the consumer must also transform (audit findings) ─────
// One-sided Jupiter diverged: the consumer applied incoming provider ops RAW
// onto a mirror still carrying its own in-flight (unacked) ops, and never
// learned the rebased fate of its own op. These pin the dual transform +
// ack protocol end to end — BOTH ends must converge to the same value.

describe("two-sided convergence — provider ops fold over the consumer's in-flight ops", () => {
  it("THE AUDIT DIVERGENCE: consumer inserts at 0 while the provider deletes index 0", () => {
    // one-sided: the raw incoming delete killed the consumer's optimistic X
    // (consumer → ["a","b","c"]) while the provider kept it (["X","b","c"]) —
    // permanent divergence, no ack, no snapshot. Now: the consumer rebases the
    // delete PAST its in-flight insert; the provider transforms the insert.
    const [a, b, flush] = latchedPortPair();
    const source = new Opstream(["a", "b", "c"]);
    const remote = portOpstream(a);
    serveOpstreamOverPort(source, b);
    remote.apply({ path: [], range: [0, 0], value: ["X"] }); // in flight (basedOn 1)
    source.apply({ path: [], range: [0, 1], value: undefined }); // concurrent provider delete (rev 2)
    expect(remote.value).toEqual(["X", "b", "c"]); // the delete landed at [1,2) — X survived
    flush(); // the insert reaches the provider, transforms (position 0 still right)
    expect(source.value).toEqual(["X", "b", "c"]);
    expect(remote.value).toEqual(source.value); // CONVERGED

    // …and the ack popped the in-flight op, so life continues cleanly after
    source.apply({ path: [], range: [3, 3], value: ["d"] });
    remote.apply({ path: [], range: [0, 1], value: undefined });
    flush();
    expect(source.value).toEqual(["b", "c", "d"]);
    expect(remote.value).toEqual(source.value);
  });

  it("insert-insert at the SAME position: both ends agree the provider goes first", () => {
    const [a, b, flush] = latchedPortPair();
    const source = new Opstream(["m"]);
    const remote = portOpstream(a);
    serveOpstreamOverPort(source, b);
    remote.apply({ path: [], range: [0, 0], value: ["C"] }); // consumer insert at 0, in flight
    source.apply({ path: [], range: [0, 0], value: ["P"] }); // provider insert at 0, concurrent
    // consumer side of the dual: the provider op is canonically FIRST — it keeps
    // position 0 and the in-flight C is rewritten past it
    expect(remote.value).toEqual(["P", "C", "m"]);
    flush(); // provider transforms C to land AFTER its own P
    expect(source.value).toEqual(["P", "C", "m"]);
    expect(remote.value).toEqual(source.value);
  });

  it("a text-splice race that does NOT commute: same-point inserts converge provider-first", () => {
    const [a, b, flush] = latchedPortPair();
    const source = new Opstream("ab");
    const remote = portOpstream(a);
    serveOpstreamOverPort(source, b);
    remote.apply(splice(1, 1, "X")); // consumer: "aXb", in flight
    source.apply(splice(1, 1, "Y")); // provider: "aYb" — apply order matters here
    expect(remote.value).toBe("aYXb"); // NOT "aXYb": the incoming Y holds its spot, X shifts
    flush();
    expect(source.value).toBe("aYXb");
    expect(remote.value).toBe(source.value);
  });
});

describe("error ops cross the port (uncounted, unmutating)", () => {
  it("a provider pushError reaches consumer subscribers without touching the mirror or the revs", async () => {
    const { Source } = await import("../src/opstreams.js");
    const [p1, p2] = fakePortPair();
    const src = new Source("v");
    const remote = portOpstream(p1);
    const seen = [];
    remote.connect((op) => seen.push(op));
    serveOpstreamOverPort(src, p2);
    src.pushError(new Error("boom"));
    expect(seen.at(-1)).toEqual({ type: "error", error: "boom" }); // delivered (it used to be dropped on the floor)
    expect(remote.value).toBe("v"); // the last good value survives
    src.push("w"); // an op-shaped message after the error — the rev counters stayed in step
    expect(remote.value).toBe("w");
    expect(seen.at(-1)).toEqual({ type: "snapshot", value: "w" });
  });
});
