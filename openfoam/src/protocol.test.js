import { describe, it, expect } from "vitest";
import { newRun, packChunk, unpackChunks, encodeLayer, decodeLayer, requestFinish, stagesFor, runIdOf, markStopped, markInterrupted } from "./protocol.js";
import { defaultSetup } from "./setup.js";
import { standInTasks } from "./test/tasks-stand-in.js";

describe("a run", () => {
  it("starts queued with every stage pending", () => {
    const r = newRun({ caseUrl: "c", serverUrl: "s", setup: defaultSetup(), hull: { stl: new Uint8Array(4) }, now: 1 });
    expect(r.status).toBe("queued");
    expect(r.stages.map((s) => s.id)).toEqual(stagesFor("double-body").map((s) => s.id));
    expect(r.stages.every((s) => s.status === "pending")).toBe(true);
    expect(stagesFor("free-surface").map((s) => s.id)).toContain("setFields");
  });
  it("asks to finish by control only, and names no task until one is asked", () => {
    const r = newRun({ caseUrl: "c", serverUrl: "s", setup: defaultSetup(), hull: {}, now: 1 });
    expect(r.task).toBe(null);
    requestFinish(r);
    expect(r.control).toEqual({ finish: true });
    expect(r.status).toBe("queued");
  });
  it("is named by its document id", () => expect(runIdOf("automerge:abc")).toBe("abc"));
});

// What a stopped or interrupted run writes is the task client's (a stand-in
// here, which marks what it was asked); this package adds what its flow
// volume says.
describe("a run told to stop", () => {
  const tasks = standInTasks();
  const solving = () => {
    const r = newRun({ caseUrl: "c", serverUrl: "s", setup: defaultSetup(), hull: {}, now: 1 });
    r.status = "solving";
    r.stages[0].status = "done";
    r.stages[1].status = "running";
    return r;
  };
  it("a run going on: the task client's write", () => {
    const r = solving();
    markStopped(tasks, r, "cancelled", 9);
    expect([r.status, r.stoppedFor]).toEqual(["solving", "cancelled"]);
  });
  it("a finished run keeps its status; only a volume being kept says it wasn't; yielded is the task client's", () => {
    for (const reason of tasks.STOP_REASONS) {
      const r = solving();
      r.status = "done";
      r.stages.find((s) => s.id === "solve").status = "done";
      r.stages[1].status = "done";
      r.volume = { status: "posting" };
      r.stages.push({ id: "volume", status: "running" });
      markStopped(tasks, r, reason, 9);
      expect(r.status).toBe("done");
      expect([r.volume.status, r.stages.at(-1).status, r.stoppedFor]).toEqual(reason === "yielded" ? ["posting", "running", "yielded"] : ["failed", "failed", undefined]);
    }
  });
  it("taken up again after an interruption: the task client's write for a run going on; a finished run keeping its volume says it wasn't kept", () => {
    const r = solving();
    markInterrupted(tasks, r, 9);
    expect(r.interrupted).toBe(true);
    const keeping = { ...solving(), status: "done", volume: { status: "posting" } };
    markInterrupted(tasks, keeping, 9);
    expect([keeping.status, keeping.volume.status, keeping.interrupted]).toEqual(["done", "failed", undefined]);
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
