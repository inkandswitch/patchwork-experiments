import {
  newRun, runTitle, encodeLayer, decodeLayer, initStudy, markStopped, markInterrupted, shownRun,
  runIdOf, isTerminal, STAGES, STATUSES, STOP_REASONS, MACHINE_STOPPED, NOT_RESTARTED, RUN_TYPE, LAYER_TYPE, PROTOCOL_VERSION,
} from "./protocol.js";
import { defaultSetup, normalizeSetup } from "./setup.js";

describe("runs", () => {
  const setup = normalizeSetup({ mesh: { size: { value: 2, unit: "mm" }, order: 2 } });
  const part = { title: "Bracket", stl: new Uint8Array([1, 2, 3]) };
  const run = newRun({ studyUrl: "automerge:study", serverUrl: "automerge:server", setup, part, by: "Ada", now: 1234, made: { tool: "fea", version: "0.1.0" } });

  it("holds what it is given, as it was", () => {
    expect(run["@patchwork"]).toEqual({ type: RUN_TYPE });
    expect(run.protocol).toBe(PROTOCOL_VERSION);
    expect(run.study).toBe("automerge:study");
    expect(run.server).toBe("automerge:server");
    expect(run.requestedAt).toBe(1234);
    expect(run.requestedBy).toBe("Ada");
    expect(run.setup).toEqual(setup);
    expect(run.part).toEqual(part);
    expect(run.made).toEqual({ tool: "fea", version: "0.1.0" });
  });

  it("starts queued, every stage pending, no task yet, nothing yet from the run's code", () => {
    expect(run.status).toBe("queued");
    expect(run.task).toBeNull();
    expect("control" in run).toBe(false);
    expect(run.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
    for (const s of run.stages) expect(s).toEqual({ id: s.id, label: STAGES.find((x) => x.id === s.id).label, status: "pending", startedAt: null, endedAt: null, note: null, tail: null });
    expect([run.daemon, run.mesh, run.summary, run.recipe, run.error, run.startedAt, run.finishedAt]).toEqual([null, null, null, null, null, null, null]);
    expect(run.layers).toEqual({});
    expect(run.notes).toEqual([]);
  });

  it("each run's stages are its own", () => {
    const other = newRun({ studyUrl: "s", serverUrl: "v", setup, part, now: 1 });
    other.stages[0].status = "done";
    expect(run.stages[0].status).toBe("pending");
    expect(other.requestedBy).toBeNull();
    expect(other.made).toBeNull();
  });

  it("its title says the part, the analysis, the material and the mesh size", () => {
    expect(run.title).toBe("Bracket · static · Aluminium 6061-T6 · 2 mm");
    expect(runTitle(defaultSetup(), null)).toBe("static · Aluminium 6061-T6 · coarse");
    expect(runTitle({ ...defaultSetup(), analysis: "modal" }, "P")).toBe("P · modal · Aluminium 6061-T6 · coarse");
    expect(newRun({ studyUrl: "s", serverUrl: "v", setup, part, now: 1, title: "Mine" }).title).toBe("Mine");
  });

  it("a run's id is its document id", () => {
    expect(runIdOf("automerge:abc123")).toBe("abc123");
    expect(runIdOf("abc123")).toBe("abc123");
  });

  it("the terminal statuses", () => {
    expect(STATUSES.filter(isTerminal)).toEqual(["done", "failed", "cancelled"]);
    for (const s of STAGES) expect(STATUSES).toContain(s.status);
  });
});

describe("studies", () => {
  it("a new study has no part, no server, no runs", () => {
    const doc = {};
    const setup = defaultSetup();
    initStudy(doc, setup);
    expect(doc).toEqual({ title: "FEA study", part: null, setup, server: null, runs: [], selected: null });
  });
});

// ---------------------------------------------------------------- stopping

/** A run doc partway through: meshing, its first stage done and its second running. */
function going() {
  const r = newRun({ studyUrl: "s", serverUrl: "q", setup: normalizeSetup(null), part: {}, now: 1 });
  r.status = "meshing";
  r.startedAt = 2;
  r.stages[0].status = "done";
  r.stages[1].status = "running";
  return r;
}

describe("markStopped: what the run's code writes when its task's signal stops it", () => {
  it("cancelled: the run says cancelled, and the running stage says it was cancelled", () => {
    const r = going();
    markStopped(r, "cancelled", 9);
    expect([r.status, r.error, r.finishedAt]).toEqual(["cancelled", null, 9]);
    expect(r.stages.map((s) => s.status)).toEqual(["done", "failed", "pending", "pending", "pending"]);
    expect(r.stages[1]).toMatchObject({ endedAt: 9, note: "cancelled" });
  });
  it("stopping: the run failed because its machine stopped, and the running stage says stopped", () => {
    const r = going();
    markStopped(r, "stopping", 9);
    expect([r.status, r.error, r.finishedAt]).toEqual(["failed", MACHINE_STOPPED, 9]);
    expect(r.stages[1]).toMatchObject({ status: "failed", endedAt: 9, note: "stopped" });
  });
  it("yielded: nothing is written (another run of the task has it)", () => {
    const r = going();
    const before = structuredClone(r);
    markStopped(r, "yielded", 9);
    expect(r).toEqual(before);
  });
  it("a run doc that already says how it ended keeps it, whatever the reason", () => {
    for (const end of ["done", "failed", "cancelled"])
      for (const reason of STOP_REASONS) {
        const r = { ...going(), status: end, error: end === "failed" ? "its own" : null, finishedAt: 5 };
        const before = structuredClone(r);
        markStopped(r, reason, 9);
        expect(r).toEqual(before);
      }
  });
});

describe("markInterrupted: a run taken up again after its machine stopped mid-run", () => {
  it("is failed, not solved again, and says so", () => {
    const r = going();
    markInterrupted(r, 9);
    expect([r.status, r.error, r.finishedAt]).toEqual(["failed", NOT_RESTARTED, 9]);
    expect(r.stages[1].status).toBe("failed");
  });
  it("a queued run doc (its machine stopped before it wrote anything) says the same", () => {
    const r = newRun({ studyUrl: "s", serverUrl: "q", setup: normalizeSetup(null), part: {}, now: 1 });
    markInterrupted(r, 9);
    expect([r.status, r.error]).toEqual(["failed", NOT_RESTARTED]);
  });
  it("one that already says how it ended keeps it (the machine-stopped sentence stays)", () => {
    const r = going();
    markStopped(r, "stopping", 5);
    markInterrupted(r, 9);
    expect([r.status, r.error, r.finishedAt]).toEqual(["failed", MACHINE_STOPPED, 5]);
  });
});

// Every run status against every state a task can be read in (and none
// known yet). Written out whole, row by row: what a person sees for each.
describe("shownRun: the status a person sees, from the run doc and its task", () => {
  const TASK_STATES = [null, "waiting", "running", "stalled", "stopping", "succeeded", "failed", "cancelled"];
  const doc = (status) => ({ status, error: status === "failed" ? "the run's own error" : null });
  const task = (state) => (state === null ? null : { state, error: state === "failed" ? "the task's error" : null });
  const as = (status, error = null, note = null) => ({ status, error, note });
  const CANCELLING = "cancelling…";
  const UNHEARD = "the machine running it isn't heard from";
  const STOPPED = "the machine running it stopped; it won't be solved again, so run it again";
  // [run status] → the shown value for each task state, in TASK_STATES' order
  const TABLE = {
    queued: [as("queued"), as("queued"), as("queued"), as("queued", null, UNHEARD), as("queued", null, CANCELLING), as("queued"), as("failed", "the task's error"), as("cancelled", null, "cancelled before it started")],
    meshing: [as("meshing"), as("meshing", null, STOPPED), as("meshing"), as("meshing", null, UNHEARD), as("meshing", null, CANCELLING), as("meshing"), as("failed", "the task's error"), as("cancelled")],
    solving: [as("solving"), as("solving", null, STOPPED), as("solving"), as("solving", null, UNHEARD), as("solving", null, CANCELLING), as("solving"), as("failed", "the task's error"), as("cancelled")],
    post: [as("post"), as("post", null, STOPPED), as("post"), as("post", null, UNHEARD), as("post", null, CANCELLING), as("post"), as("failed", "the task's error"), as("cancelled")],
    // a run doc that says how it ended is the answer, whatever its task says
    done: TASK_STATES.map(() => as("done")),
    failed: TASK_STATES.map(() => as("failed", "the run's own error")),
    cancelled: TASK_STATES.map(() => as("cancelled")),
  };
  it("covers every run status", () => {
    expect(Object.keys(TABLE)).toEqual([...STATUSES]);
  });
  for (const status of STATUSES)
    for (const [i, state] of TASK_STATES.entries())
      it(`a ${status} run doc, its task ${state ?? "not known yet"}`, () => {
        expect(shownRun(doc(status), task(state))).toEqual(TABLE[status][i]);
      });
  it("a failed task with no reason says it failed; a run doc not here yet reads queued", () => {
    expect(shownRun(doc("solving"), { state: "failed" })).toEqual(as("failed", "it failed"));
    expect(shownRun(undefined, null)).toEqual(as("queued"));
  });
});

describe("encodeLayer and decodeLayer", () => {
  const layer = {
    name: "skin",
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    faces: Uint32Array.from([4, 0xffffffff]),
    fields: { vm: Float32Array.from([1, -2, 3.5, NaN]), ux: [0.25, 0.5, 0.75, 1], empty: Float32Array.from([NaN, NaN, NaN, NaN]) },
  };

  it("arrays travel as bytes, with a range for each field and its counts", () => {
    const doc = encodeLayer(layer);
    expect(doc["@patchwork"]).toEqual({ type: LAYER_TYPE });
    expect([doc.name, doc.title, doc.points, doc.triangles]).toEqual(["skin", "skin", 4, 2]);
    expect(doc.positions).toBeInstanceOf(Uint8Array);
    expect(doc.positions.byteLength).toBe(48);
    expect(doc.ranges).toEqual({ vm: [-2, 3.5], ux: [0.25, 1], empty: null });
  });

  it("round-trips the arrays, faces and ranges", () => {
    const back = decodeLayer(encodeLayer(layer));
    expect(back.name).toBe("skin");
    expect(Array.from(back.positions)).toEqual(Array.from(layer.positions));
    expect(Array.from(back.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(back.faces)).toEqual([4, 0xffffffff]);
    expect(Array.from(back.fields.vm)).toEqual([1, -2, 3.5, NaN]);
    expect(Array.from(back.fields.ux)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(back.ranges).toEqual({ vm: [-2, 3.5], ux: [0.25, 1], empty: null });
    expect(back.positions).toBeInstanceOf(Float32Array);
    expect(back.indices).toBeInstanceOf(Uint32Array);
  });

  it("reads bytes that arrive at an odd offset in a bigger buffer, or as plain arrays", () => {
    const doc = encodeLayer(layer);
    const shifted = (bytes) => {
      const big = new Uint8Array(bytes.byteLength + 5);
      big.set(bytes, 1);
      return big.subarray(1, 1 + bytes.byteLength);
    };
    const odd = { ...doc, positions: shifted(doc.positions), indices: shifted(doc.indices), faces: shifted(doc.faces), fields: { vm: shifted(doc.fields.vm), ux: Array.from(doc.fields.ux) } };
    expect(odd.positions.byteOffset).toBe(1);
    const back = decodeLayer(odd);
    expect(Array.from(back.positions)).toEqual(Array.from(layer.positions));
    expect(Array.from(back.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(back.faces)).toEqual([4, 0xffffffff]);
    expect(Array.from(back.fields.vm)).toEqual([1, -2, 3.5, NaN]);
    expect(Array.from(back.fields.ux)).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("encodes typed arrays that are views into bigger buffers by their own bytes only", () => {
    const big = new Float32Array(20).fill(7);
    big.set([1, 2, 3, 4, 5, 6], 5);
    const doc = encodeLayer({ name: "v", positions: big.subarray(5, 11), indices: [0, 1, 0] });
    expect(Array.from(decodeLayer(doc).positions)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("no faces: none; no positions: not a layer", () => {
    const doc = encodeLayer({ name: "n", positions: [0, 0, 0], indices: [0, 0, 0] });
    expect("faces" in doc).toBe(false);
    expect(decodeLayer(doc).faces).toBeNull();
    expect(decodeLayer({})).toBeNull();
    expect(decodeLayer(null)).toBeNull();
  });
});
