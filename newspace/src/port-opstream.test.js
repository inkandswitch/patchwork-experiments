import { describe, it, expect } from "vitest";
import { portOpstream, serveOpstreamOverPort } from "./port-opstream.js";
import { Opstream } from "./opstreams.js";

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
    expect(queue[0]).toEqual({ path: [], range: [4, 4], value: "e", basedOn: 2 });
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
