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

// a pair where the CONSUMER→PROVIDER direction is LATCHED (posts queue until
// flush) so a component edit can land AFTER the tool's doc has moved — the race
function latchedRecordingPair() {
  const queue = [], sent = [];
  const a = { onmessage: null, postMessage: (d) => { sent.push(d); queue.push(d); } };
  const b = { onmessage: null, postMessage: (d) => a.onmessage && a.onmessage({ data: d }) };
  const flush = () => { while (queue.length) { const d = queue.shift(); b.onmessage && b.onmessage({ data: d }); } };
  return [a, b, flush, sent];
}

describe("automergeDocOverPort races — basedOn + the consumer half of the dual (audit)", () => {
  it("tags its granular ops with basedOn, so the provider-side rebase can engage", () => {
    const [p1, p2, , sent] = latchedRecordingPair();
    const tool = new Opstream({ items: [{ id: "a" }] });
    const h = automergeDocOverPort(p1, "automerge:W");
    serveOpstreamOverPort(tool, p2);
    sent.length = 0;
    h.change((d) => { d.items[0].x = 1; });
    const op = sent.find((o) => o && o.range === "x");
    expect(typeof op.basedOn).toBe("number"); // previously absent — rebase never engaged
    expect(typeof op.seq).toBe("number"); // …and it's ack-correlatable
    h.free();
  });

  it("THE AUDIT CORRUPTION: a component edit of items[2] races a tool-side delete of items[0]", () => {
    // without basedOn the raw {path:["items",2]} put landed on the SHIFTED doc —
    // the wrong element (or off the end), silently PERSISTED. Now it rebases.
    const [p1, p2, flush] = latchedRecordingPair();
    const tool = new Opstream({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const h = automergeDocOverPort(p1, "automerge:V");
    serveOpstreamOverPort(tool, p2);
    h.change((d) => { d.items[2].x = 9; }); // component edits the LAST item — latched, in flight
    tool.apply({ path: ["items"], range: [0, 1], value: undefined }); // tool concurrently deletes item 0
    // consumer half: the incoming delete folds over the in-flight put, so the
    // REPLICA is already right (the put's path was rewritten to items[1])
    expect(h.doc().items).toEqual([{ id: "b" }, { id: "c", x: 9 }]);
    flush(); // the put reaches the tool with basedOn 1 < rev 2 → rebased to items[1]
    expect(tool.value.items).toEqual([{ id: "b" }, { id: "c", x: 9 }]); // the RIGHT element, both ends
    expect(h.doc().items).toEqual(tool.value.items); // converged — no persisted corruption
    h.free();
  });

  it("a component list-insert races a tool-side delete (the divergence shape) — both converge", () => {
    const [p1, p2, flush] = latchedRecordingPair();
    const tool = new Opstream({ items: [{ id: "a" }, { id: "b" }] });
    const h = automergeDocOverPort(p1, "automerge:U");
    serveOpstreamOverPort(tool, p2);
    h.change((d) => { d.items.splice(0, 0, { id: "X" }); }); // insert at 0, in flight
    tool.apply({ path: ["items"], range: [0, 1], value: undefined }); // concurrent delete of index 0
    expect(h.doc().items).toEqual([{ id: "X" }, { id: "b" }]); // the delete folded PAST the optimistic insert
    flush();
    expect(tool.value.items).toEqual([{ id: "X" }, { id: "b" }]);
    expect(h.doc().items).toEqual(tool.value.items);
    h.free();
  });
});
