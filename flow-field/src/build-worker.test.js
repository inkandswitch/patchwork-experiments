// The scene builds off the main thread: the worker's message handler makes
// the same bytes as the old main-thread build, and build-runner.js (driven
// here through a fake Worker that runs that handler) pools workers, falls
// back to the main thread when one can't start, reports a crash as an error,
// and supersedes an older build of the same flow with an AbortError.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildSlice } from "./build-slice.js";
import { buildStreamlines } from "./build-streamlines.js";
import { handleMessage, makeJob, plain, runJob } from "./build-job.js";
import { resetRunner, runSuperseding, startJob, workersAvailable } from "./build-runner.js";
import { bodySectionFor } from "./section.js";
import { normalizeBodySpec } from "./body.js";
import { FlowFieldDatatype } from "./datatype.js";
import { presetFlow } from "./presets.js";
import sliceSource from "./scene-slice.js";
import streamSource from "./scene-streamlines.js";
import { prismGLB, transomWaterline } from "./test/hull-fixtures.js";

const RENDER = "automerge:rend111111111111111111111";
const GLB = "automerge:g1b1111111111111111111111";
const FLOW = "automerge:f1ow111111111111111111111";

const handle = (url, doc) => ({ url, doc: () => doc, heads: () => ["a"] });
const repoWithRender = () => {
  const handles = {
    [RENDER]: handle(RENDER, {
      "@patchwork": { type: "scene-render" },
      title: "Hull",
      parent: "automerge:hu11111111111111111111111",
      providerId: "test-hull-surface",
      params: {},
      glbUrl: GLB,
      builtFrom: { heads: ["a"], fingerprint: null, paramsKey: "{}" },
      status: "idle",
      error: null,
    }),
    [GLB]: handle(GLB, { "@patchwork": { type: "file" }, name: "Hull.glb", extension: "glb", content: prismGLB(transomWaterline()) }),
  };
  return {
    async find(url) {
      if (!handles[url]) throw new Error(`unavailable: ${url}`);
      return handles[url];
    },
  };
};

const seedDoc = (extra = {}) => {
  const d = {};
  FlowFieldDatatype.init(d);
  return Object.assign(d, extra);
};
const linkedDoc = (model, elements = {}) =>
  seedDoc({
    freestream: { speed: 2, headingDeg: 180 },
    elements,
    domain: { min: [-5, -6, -2], max: [20, 6, 1] },
    body: { url: RENDER, plane: { kind: "waterline" }, model, panels: 80 },
  });

const CASES = [
  ["rankine seed", () => seedDoc()],
  ["spinning preset (vortex line)", () => seedDoc(presetFlow("spinning"))],
  ["catamaran preset", () => seedDoc(presetFlow("catamaran"))],
  ["linked waterplane body", () => linkedDoc("waterplane-2d")],
  // point elements with a panel body: the panels are re-solved per height
  ["linked waterplane body + a source", () => linkedDoc("waterplane-2d", { s: { kind: "source", position: [-2, 3, -0.5], strength: 1 } })],
  ["linked slender body", () => linkedDoc("slender-body-3d")],
];
const PARAMS = {
  slice: [{ resolution: 40 }, { resolution: 30, colorBy: "speed", fade: 0.8, height: -0.3 }],
  streamlines: [{ seedCount: 6, rakeRows: 2 }, { tubes: false, seedCount: 5, colorBy: "cp", hugLines: 2 }],
};
const DIRECT = { slice: buildSlice, streamlines: buildStreamlines };
const SOURCE = { slice: sliceSource, streamlines: streamSource };

/** A Worker stand-in that runs build-worker.js's handler, asynchronously and on cloned messages. */
class FakeWorker {
  static made = 0;
  static mode = "ok"; // "ok" | "throw" (constructor) | "load-error" (never ready) | "crash" (error mid-job)
  constructor(url, opts) {
    FakeWorker.made++;
    if (FakeWorker.mode === "throw") throw new Error("Workers are blocked here");
    this.url = String(url);
    this.opts = opts;
    this.terminated = false;
    setTimeout(() => {
      if (this.terminated) return;
      if (FakeWorker.mode === "load-error") this.onerror?.({ message: "failed to load the module", preventDefault() {} });
      else this.onmessage?.({ data: { type: "ready" } });
    }, 1);
  }
  postMessage(data) {
    const copy = structuredClone(data);
    setTimeout(() => {
      if (this.terminated) return;
      if (FakeWorker.mode === "crash") return this.onerror?.({ message: "out of memory", preventDefault() {} });
      const { message, transfer } = handleMessage(copy);
      this.onmessage?.({ data: structuredClone(message, { transfer }) });
    }, 2);
  }
  terminate() {
    this.terminated = true;
  }
}

describe("worker path == main-thread path, byte for byte", () => {
  for (const [label, makeDoc] of CASES) {
    for (const kind of ["slice", "streamlines"]) {
      it(`${kind}: ${label}`, async () => {
        const doc = makeDoc();
        const repo = repoWithRender();
        for (const params of PARAMS[kind]) {
          // the build as it ran before workers: raw doc, raw params, the whole acquisition result
          const ctx = await bodySectionFor(doc, normalizeBodySpec(doc.body), { repo, url: FLOW });
          const before = DIRECT[kind](doc, params, ctx);
          // the worker's handler, on a structured-cloned job
          const job = makeJob(kind, doc, params, ctx);
          const { message, transfer } = handleMessage(structuredClone({ id: 7, job }));
          expect(message).toMatchObject({ id: 7, type: "done", ok: true });
          expect(transfer).toEqual([message.glb.buffer]);
          // the provider (no Worker in happy-dom: the main-thread fallback)
          const provided = await SOURCE[kind].build({ doc, params, repo, url: FLOW });
          expect(Buffer.from(message.glb).equals(Buffer.from(before.glb))).toBe(true);
          expect(Buffer.from(provided.glb).equals(Buffer.from(before.glb))).toBe(true);
          expect(message.meta).toEqual(before.meta);
          expect(provided.meta).toEqual(before.meta);
          if (doc.body) expect(before.meta.notes).toMatch(/body:/);
        }
      });
    }
  }

  it("makeJob is plain data: an automerge-like doc, −0 kept, functions and handles dropped", () => {
    const doc = seedDoc();
    doc.elements.bow.position = [-0, 0, 0];
    const job = makeJob("slice", { ...doc, extra: () => 1, title: { toJSON: () => "T" } }, { resolution: 20, junk: 1 }, {
      section: { plane: { kind: "z", z: 0 }, loops: [], key: "k", meta: { fn() {} } },
      result: { ok: true, path: "render", providerName: "Hull", handle: { doc() {} }, doc: {} },
    });
    expect(() => structuredClone(job)).not.toThrow();
    expect(Object.is(job.doc.elements.bow.position[0], -0)).toBe(true);
    expect(job.doc.title).toBe("T");
    expect(job.doc.extra).toBeUndefined();
    expect(job.params.junk).toBeUndefined();
    expect(job.params.resolution).toBe(20);
    expect(job.result).toEqual({ ok: true, path: "render", providerName: "Hull" });
    expect(job.section.meta).toEqual({});
    expect(plain([undefined, 1])).toEqual([null, 1]);
  });

  it("a build that throws comes back as an error message", () => {
    const { message } = handleMessage({ id: 1, job: { kind: "nope" } });
    expect(message).toMatchObject({ id: 1, ok: false });
    expect(message.error).toMatch(/unknown flow-field build/);
  });
});

describe("build-runner", () => {
  beforeEach(() => {
    resetRunner();
    FakeWorker.made = 0;
    FakeWorker.mode = "ok";
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    resetRunner();
    vi.unstubAllGlobals();
  });

  const job = (count = 15) => makeJob("streamlines", seedDoc({ seeds: { count } }), { seedCount: 3, rakeRows: 1 });

  it("runs jobs in a module worker resolved against the module, and reuses an idle one", async () => {
    expect(workersAvailable()).toBe(true);
    const j = job();
    const a = await startJob(j).promise;
    expect(Buffer.from(a.glb).equals(Buffer.from(runJob(j).glb))).toBe(true);
    expect(FakeWorker.made).toBe(1);
    await startJob(job(4)).promise;
    expect(FakeWorker.made).toBe(1); // the idle worker took it
    // two at once need two workers
    await Promise.all([startJob(job(5)).promise, startJob(job(6)).promise]);
    expect(FakeWorker.made).toBe(2);
  });

  it("falls back to the main thread when a worker can't start, and stays there", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeWorker.mode = "throw";
    const j = job();
    const r = await startJob(j).promise;
    expect(Buffer.from(r.glb).equals(Buffer.from(runJob(j).glb))).toBe(true);
    expect(workersAvailable()).toBe(false);
    await startJob(job(4)).promise;
    expect(FakeWorker.made).toBe(1);
    resetRunner();
    FakeWorker.mode = "load-error"; // constructed, but never ready
    const r2 = await startJob(j).promise;
    expect(r2.meta).toEqual(runJob(j).meta);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("a worker that crashes after starting is an error, not a fallback", async () => {
    FakeWorker.mode = "crash";
    await expect(startJob(job()).promise).rejects.toThrow(/build worker crashed \(out of memory\)/);
    expect(workersAvailable()).toBe(true);
  });

  it("a newer build of the same flow supersedes an older one with an AbortError; same inputs don't", async () => {
    const old = runSuperseding(job(3), { url: FLOW, identity: "v1" });
    const twin = runSuperseding(job(3), { url: FLOW, identity: "v1" });
    const other = runSuperseding(job(3), { url: "automerge:other", identity: "v0" });
    const newer = runSuperseding(job(4), { url: FLOW, identity: "v2" });
    const err = await old.catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect((await twin.catch((e) => e)).name).toBe("AbortError");
    await expect(newer).resolves.toMatchObject({ meta: expect.any(Object) });
    await expect(other).resolves.toMatchObject({ meta: expect.any(Object) });
  });

  it("a build that read an older doc than one already running cancels itself", async () => {
    const newer = runSuperseding(job(4), { url: FLOW, identity: "v2", ticket: 10 });
    const stale = runSuperseding(job(3), { url: FLOW, identity: "v1", ticket: 9 });
    expect((await stale.catch((e) => e)).name).toBe("AbortError");
    await expect(newer).resolves.toBeTruthy();
  });

  it("the providers build in the worker and supersede across edits", async () => {
    const d1 = seedDoc();
    const d2 = seedDoc({ freestream: { speed: 3, headingDeg: 0 } });
    const first = sliceSource.build({ doc: d1, params: { resolution: 20 }, url: FLOW });
    const second = streamSource.build({ doc: d2, params: { seedCount: 3 }, url: FLOW });
    expect((await first.catch((e) => e)).name).toBe("AbortError");
    const r = await second;
    expect(r.kind).toBe("glb");
    expect(FakeWorker.made).toBeGreaterThan(0);
    const direct = buildStreamlines(d2, { seedCount: 3 });
    expect(Buffer.from(r.glb).equals(Buffer.from(direct.glb))).toBe(true);
  });
});
