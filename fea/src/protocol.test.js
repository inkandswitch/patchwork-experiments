import {
  newRun, runTitle, encodeLayer, decodeLayer, initStudy,
  runIdOf, STAGES, RUN_TYPE, LAYER_TYPE, PROTOCOL_VERSION,
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
});

describe("studies", () => {
  it("a new study has no part, no server, no runs", () => {
    const doc = {};
    const setup = defaultSetup();
    initStudy(doc, setup);
    expect(doc).toEqual({ title: "FEA study", part: null, setup, server: null, runs: [], selected: null });
  });
});

// What a stopped or interrupted run writes, the status a person sees, and
// which statuses end a run, are the Tasks package's client's, tested there.

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
