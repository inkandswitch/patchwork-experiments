import { describe, it, expect } from "vitest";
import { automergeDocOverPort } from "./sketchy-streams.js";
import { serveOpstreamOverPort } from "./port-opstream.js";
import { Opstream } from "./opstreams.js";

// a fake port pair that also RECORDS what the consumer (port1) sends upstream
function recordingPortPair() {
  const sent = [];
  const a = { onmessage: null, postMessage: (d) => { sent.push(d); b.onmessage && b.onmessage({ data: d }); } };
  const b = { onmessage: null, postMessage: (d) => a.onmessage && a.onmessage({ data: d }) };
  return [a, b, sent];
}

describe("automergeDocOverPort — GRANULAR writes over a port", () => {
  it("a push lands on the tool's doc via a granular op, not a whole-doc snapshot", () => {
    const [p1, p2, sent] = recordingPortPair();
    const tool = new Opstream({ items: [] });
    const h = automergeDocOverPort(p1, "automerge:X");   // consumer first (so it gets the snapshot)
    serveOpstreamOverPort(tool, p2);                     // tool side
    expect(h.doc()).toEqual({ items: [] });

    h.change((d) => d.items.push({ id: "a", x: 1 }));
    expect(tool.value.items).toEqual([{ id: "a", x: 1 }]); // landed on the tool's doc
    expect(h.doc().items).toEqual([{ id: "a", x: 1 }]);

    // what crossed the port was a GRANULAR insert (a splice op), NOT a snapshot
    const ups = sent.filter((o) => o && o.type !== "snapshot");
    expect(ups.length).toBeGreaterThan(0);
    expect(ups.some((o) => Array.isArray(o.range))).toBe(true);
    expect(ups.every((o) => o.type !== "snapshot")).toBe(true);
  });

  it("editing one item's field sends a per-field op (would NOT clobber a concurrent peer)", () => {
    const [p1, p2, sent] = recordingPortPair();
    const tool = new Opstream({ items: [{ id: "a", x: 1 }] });
    const h = automergeDocOverPort(p1, "automerge:Y");
    serveOpstreamOverPort(tool, p2);
    sent.length = 0;

    h.change((d) => { d.items[0].x = 9; });
    expect(tool.value.items[0].x).toBe(9);
    // a single granular PUT at items[0].x — the items array was not replaced wholesale
    const puts = sent.filter((o) => o && o.range === "x");
    expect(puts.length).toBe(1);
    expect(sent.every((o) => o.type !== "snapshot")).toBe(true);
  });

  it("a remote op on the tool's doc updates the local replica + fires change", () => {
    const [p1, p2] = recordingPortPair();
    const tool = new Opstream({ items: [] });
    const h = automergeDocOverPort(p1, "automerge:Z");
    serveOpstreamOverPort(tool, p2);
    let fired = 0; h.on("change", () => fired++);
    tool.apply({ path: ["items"], range: [0, 0], value: [{ id: "b" }] }); // tool edits
    expect(h.doc().items).toEqual([{ id: "b" }]);
    expect(fired).toBeGreaterThan(0);
    h.free();
  });
});
