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
