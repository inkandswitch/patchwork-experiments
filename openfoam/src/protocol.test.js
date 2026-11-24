import { describe, it, expect } from "vitest";
import { newRun, newServer, enqueue, pendingRequests, queueView, daemonOnline, packChunk, unpackChunks, encodeLayer, decodeLayer, requestStop, stagesFor, requestIdOf, ONLINE_MS } from "./protocol.js";
import { defaultSetup } from "./setup.js";

describe("the inbox", () => {
  const server = () => newServer({ title: "t", daemon: { heartbeat: 1000 } });
  it("hands out requests oldest first, ties by id", () => {
    const s = server();
    enqueue(s, "automerge:B", { now: 5 });
    enqueue(s, "automerge:A", { now: 5 });
    enqueue(s, "automerge:C", { now: 1 });
    expect(pendingRequests(s).map((r) => r.id)).toEqual(["C", "A", "B"]);
  });
  it("never hands out a request twice once handled", () => {
    const s = server();
    enqueue(s, "automerge:A", { now: 1 });
    enqueue(s, "automerge:B", { now: 2 });
    s.handled.A = { at: 3, status: "done" };
    expect(pendingRequests(s).map((r) => r.id)).toEqual(["B"]);
    // asking again for a handled run doesn't bring it back
    enqueue(s, "automerge:A", { now: 4 });
    expect(pendingRequests(s).map((r) => r.id)).toEqual(["B"]);
  });
  it("shows the running runs apart from what waits", () => {
    const s = server();
    enqueue(s, "automerge:A", { now: 1 });
    enqueue(s, "automerge:B", { now: 2 });
    enqueue(s, "automerge:C", { now: 3 });
    s.active.A = { run: "automerge:A", since: 5 };
    s.active.C = { run: "automerge:C", since: 6 };
    const q = queueView(s);
    expect(q.active.map((r) => r.id).sort()).toEqual(["A", "C"]);
    expect(q.waiting.map((r) => r.id)).toEqual(["B"]);
  });
  it("reads a malformed running map as nothing running", () => {
    expect(queueView({ requests: {}, active: { request: "A" } }).active).toEqual([]);
    expect(queueView({ requests: {}, active: null }).active).toEqual([]);
  });
  it("is online only while it beats", () => {
    const s = server();
    expect(daemonOnline(s, 1000 + ONLINE_MS - 1)).toBe(true);
    expect(daemonOnline(s, 1000 + ONLINE_MS)).toBe(false);
    expect(daemonOnline({}, 0)).toBe(false);
  });
  it("keys a request by its run's document id", () => expect(requestIdOf("automerge:abc")).toBe("abc"));
});

describe("a run", () => {
  it("starts queued with every stage pending", () => {
    const r = newRun({ caseUrl: "c", serverUrl: "s", setup: defaultSetup(), hull: { stl: new Uint8Array(4) }, now: 1 });
    expect(r.status).toBe("queued");
    expect(r.stages.map((s) => s.id)).toEqual(stagesFor("double-body").map((s) => s.id));
    expect(r.stages.every((s) => s.status === "pending")).toBe(true);
    expect(stagesFor("free-surface").map((s) => s.id)).toContain("setFields");
  });
  it("asks to stop by control only", () => {
    const r = newRun({ caseUrl: "c", serverUrl: "s", setup: defaultSetup(), hull: {}, now: 1 });
    requestStop(r, { keep: true });
    expect(r.control).toEqual({ cancel: false, finish: true });
    requestStop(r, { keep: false });
    expect(r.control).toEqual({ cancel: true, finish: true });
    expect(r.status).toBe("queued");
  });
});

describe("progress chunks", () => {
  it("pack and unpack in order, across chunks", () => {
    const a = packChunk(["iter", "Rt"], [[1, 10], [2, 20]]);
    const b = packChunk(["iter", "Rt"], [[3, 30]]);
    expect(unpackChunks([a, b])).toEqual({ cols: ["iter", "Rt"], rows: [[1, 10], [2, 20], [3, 30]] });
  });
  it("read bytes at any alignment", () => {
    const a = packChunk(["x"], [[1.5], [2.5]]);
    const shifted = new Uint8Array(a.data.length + 1).subarray(1);
    shifted.set(a.data);
    expect(unpackChunks([{ ...a, data: shifted }]).rows).toEqual([[1.5], [2.5]]);
  });
  it("skip a chunk with other columns", () => {
    expect(unpackChunks([packChunk(["a"], [[1]]), packChunk(["b"], [[2]])]).rows).toEqual([[1]]);
  });
});

describe("layers", () => {
  it("round-trip with their ranges", () => {
    const enc = encodeLayer({ name: "w", kind: "triangles", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], fields: { Cp: [-1, 0, 2] }, half: true });
    expect(enc.ranges.Cp).toEqual([-1, 2]);
    const dec = decodeLayer(enc);
    expect(Array.from(dec.indices)).toEqual([0, 1, 2]);
    expect(Array.from(dec.fields.Cp)).toEqual([-1, 0, 2]);
    expect(dec.half).toBe(true);
  });
});
