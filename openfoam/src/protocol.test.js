import { describe, it, expect } from "vitest";
import { newRun, packChunk, unpackChunks, encodeLayer, decodeLayer, requestFinish, stagesFor, runIdOf, markStopped, markInterrupted, shownRun, MACHINE_STOPPED, NOT_RESTARTED } from "./protocol.js";
import { defaultSetup } from "./setup.js";

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

describe("a run told to stop", () => {
  const solving = () => {
    const r = newRun({ caseUrl: "c", serverUrl: "s", setup: defaultSetup(), hull: {}, now: 1 });
    r.status = "solving";
    r.stages[0].status = "done";
    r.stages[1].status = "running";
    return r;
  };
  it("cancelled: says cancelled, and the stage it was on stopped", () => {
    const r = solving();
    markStopped(r, "cancelled", 9);
    expect([r.status, r.error, r.finishedAt]).toEqual(["cancelled", null, 9]);
    expect(r.stages.map((s) => s.status).slice(0, 3)).toEqual(["done", "failed", "pending"]);
    expect(r.stages[1].note).toBe("cancelled");
  });
  it("stopping (its machine is shutting down): failed, saying the machine stopped", () => {
    const r = solving();
    markStopped(r, "stopping", 9);
    expect([r.status, r.error]).toEqual(["failed", MACHINE_STOPPED]);
    expect(r.stages[1].note).toBe("stopped");
  });
  it("yielded: nothing written", () => {
    const r = solving();
    const before = JSON.stringify(r);
    markStopped(r, "yielded", 9);
    expect(JSON.stringify(r)).toBe(before);
  });
  it("a finished run keeps its status; only a volume being kept says it wasn't", () => {
    for (const reason of ["cancelled", "stopping"]) {
      const r = solving();
      r.status = "done";
      r.stages.find((s) => s.id === "solve").status = "done";
      r.stages[1].status = "done";
      r.volume = { status: "posting" };
      r.stages.push({ id: "volume", status: "running" });
      markStopped(r, reason, 9);
      expect(r.status).toBe("done");
      expect(r.volume.status).toBe("failed");
      expect(r.stages.at(-1).status).toBe("failed");
    }
  });
  it("taken up again after an interruption: failed, not solved again; an ending already written stands", () => {
    const r = solving();
    markInterrupted(r, 9);
    expect([r.status, r.error, r.stages[1].status]).toEqual(["failed", NOT_RESTARTED, "failed"]);
    const stopped = solving();
    markStopped(stopped, "stopping", 5);
    markInterrupted(stopped, 9);
    expect([stopped.status, stopped.error, stopped.finishedAt]).toEqual(["failed", MACHINE_STOPPED, 5]);
  });
});

describe("the status a person sees", () => {
  // every run doc status against every task state a reader can have
  const RUN = ["queued", "meshing", "solving", "post", "done", "failed", "cancelled"];
  const TASK = [null, "missing", "waiting", "running", "stalled", "stopping", "succeeded", "failed", "cancelled"];
  const shown = (status, state) => shownRun({ status, error: status === "failed" ? "the doc's error" : null }, state ? { state, error: state === "failed" ? "the task's error" : null } : null);
  it("is the run doc's once it has ended, whatever the task says", () => {
    for (const st of ["done", "failed", "cancelled"])
      for (const t of TASK) expect(shown(st, t)).toEqual({ status: st, error: st === "failed" ? "the doc's error" : null, note: null });
  });
  it("is the task's ending when the run doc can't say it (nobody wrote it)", () => {
    for (const st of ["queued", "meshing", "solving", "post"]) {
      expect(shown(st, "cancelled").status).toBe("cancelled");
      expect(shown(st, "failed")).toEqual({ status: "failed", error: "the task's error", note: null });
    }
    expect(shown("queued", "cancelled").note).toBe("cancelled before it started");
    expect(shown("solving", "cancelled").note).toBe(null);
  });
  it("is the run doc's while the task goes on, with a note when the task knows more", () => {
    const table = Object.fromEntries(TASK.filter((t) => !["failed", "cancelled"].includes(t)).map((t) => [t ?? "null", [shown("queued", t), shown("solving", t)].map((s) => `${s.status}${s.note ? ` (${s.note})` : ""}`)]));
    expect(table).toEqual({
      null: ["queued", "solving"],
      missing: ["queued", "solving"],
      waiting: ["queued", "solving (the machine running it stopped; it won't be solved again, so run it again)"],
      running: ["queued", "solving"],
      stalled: ["queued (the machine running it isn't heard from)", "solving (the machine running it isn't heard from)"],
      stopping: ["queued (cancelling…)", "solving (cancelling…)"],
      succeeded: ["queued", "solving"],
    });
  });
  it("covers every pair", () => {
    for (const st of RUN) for (const t of TASK) expect(RUN).toContain(shown(st, t).status);
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
