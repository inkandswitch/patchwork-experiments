import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source, { createMeshCache, meshCache, onMainThread, runJob, workerTimeouts } from "./scene-source.js";
import { parseGLB } from "./mesh/glb.js";
import { DEFAULT_BOUNDS, fingerprintDoc } from "./doc.js";
import { finishMesh, meshJob, meshSurface } from "./mesh/job.js";
import { drain } from "./mesh/surface-nets.js";

const doc = {
  "@patchwork": { type: "implicit-surface" },
  title: "Test ball",
  source: "sphere(0.2)",
  bounds: { min: [-0.3, -0.3, -0.3], max: [0.3, 0.3, 0.3] },
  notes: "",
};

beforeEach(() => meshCache.clear());

describe("implicit-mesh provider", () => {
  it("fingerprints exactly what build() reads", () => {
    const fp = source.fingerprint(doc);
    expect(fp).toBe(fingerprintDoc({ ...doc }));
    expect(source.fingerprint({ ...doc, notes: "changed" })).toBe(fp);
    expect(source.fingerprint({ ...doc, source: "sphere(0.21)" })).not.toBe(fp);
    expect(source.fingerprint({ ...doc, bounds: { min: [-0.3, -0.3, -0.3], max: [0.3, 0.3, 0.31] } })).not.toBe(fp);
    // the mesh has a fixed name, so a rename is not a rebuild
    expect(source.fingerprint({ ...doc, title: "Renamed" })).toBe(fp);
    expect(source.fingerprint({})).toMatch(/^v1:[0-9a-f]{14}$/);
  });

  it("never fingerprints invalid bounds like the default box", () => {
    const valid = source.fingerprint({ ...doc, bounds: structuredClone(DEFAULT_BOUNDS) });
    const missing = source.fingerprint({ ...doc, bounds: null });
    const inverted = source.fingerprint({ ...doc, bounds: { min: [0.5, 0.5, 0.5], max: [-0.5, -0.5, -0.5] } });
    const nan = source.fingerprint({ ...doc, bounds: { min: [NaN, 0, 0], max: [1, 1, 1] } });
    const inf = source.fingerprint({ ...doc, bounds: { min: [Infinity, 0, 0], max: [1, 1, 1] } });
    expect(new Set([valid, missing, inverted, nan, inf]).size).toBe(5);
    // the same invalid bounds fingerprint the same way (no rebuild loop)
    expect(source.fingerprint({ ...doc, bounds: null })).toBe(missing);
  });

  it("builds a GLB (main-thread fallback when there is no Worker)", async () => {
    const r = await source.build({ doc, params: { resolution: 24, smoothNormals: true } });
    expect(r.kind).toBe("glb");
    expect(r.glb).toBeInstanceOf(Uint8Array);
    const { json } = parseGLB(r.glb);
    expect(json.meshes[0].name).toBe("Implicit surface"); // fixed, never the title
    expect(r.meta.bounds.max[1]).toBeCloseTo(0.2, 1);
    expect(r.meta.notes).toMatch(/triangles/);
  });

  it("writes the surface finish as a PBR material, and none for matte", async () => {
    const matte = parseGLB((await source.build({ doc, params: { resolution: 16 } })).glb).json;
    expect(matte.materials).toBeUndefined();
    const metal = parseGLB((await source.build({ doc, params: { resolution: 16, finish: "metal" } })).glb).json;
    const m = metal.materials[metal.meshes[0].primitives[0].material].pbrMetallicRoughness;
    expect(m.metallicFactor).toBe(1);
    expect(m.roughnessFactor).toBeLessThan(0.5);
    expect(m.baseColorFactor).toEqual([1, 1, 1, 1]); // white, so the scene's colour tints it
    const satin = parseGLB((await source.build({ doc, params: { resolution: 16, finish: "satin" } })).glb).json;
    expect(satin.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    // an unknown finish is matte, not an error
    const odd = parseGLB((await source.build({ doc, params: { resolution: 16, finish: "velvet" } })).glb).json;
    expect(odd.materials).toBeUndefined();
  });

  it("uses defaults for missing params and does not mutate the doc", async () => {
    const frozen = structuredClone(doc);
    Object.freeze(frozen.bounds.min);
    Object.freeze(frozen.bounds.max);
    Object.freeze(frozen.bounds);
    Object.freeze(frozen);
    const r = await runJob(
      { source: frozen.source, bounds: frozen.bounds, resolution: 16, name: frozen.title },
      { useWorker: false },
    );
    expect(r.stats.resolution).toBe(16);
    await expect(source.build({ doc: frozen, params: {} })).resolves.toMatchObject({ kind: "glb" });
  });

  it("rejects with a positioned message for a broken source", async () => {
    await expect(onMainThread({ source: "sphere(1", bounds: doc.bounds })).rejects.toThrow(/line 1, col 7/);
  });

  it("falls back to the main thread when the worker cannot start", async () => {
    const saved = globalThis.Worker;
    globalThis.Worker = class {
      constructor() {
        throw new Error("blocked by CSP");
      }
    };
    try {
      const r = await runJob({ source: "sphere(0.1)", bounds: doc.bounds, resolution: 12 });
      expect(r.stats.triangles).toBeGreaterThan(0);
    } finally {
      globalThis.Worker = saved;
    }
  });
});

describe("mesh cache", () => {
  const params = { resolution: 24 };

  it("refinishes the cached surface on a finish or smoothNormals change instead of remeshing", async () => {
    const first = await source.build({ doc, params });
    expect(first.meta.notes).not.toMatch(/mesh reused/);
    expect(meshCache.size).toBe(1);
    const metal = await source.build({ doc, params: { ...params, finish: "metal" } });
    expect(metal.meta.notes).toMatch(/mesh reused/);
    const flat = await source.build({ doc, params: { ...params, smoothNormals: false, finish: "satin" } });
    expect(flat.meta.notes).toMatch(/mesh reused/);
    expect(meshCache.size).toBe(1);
    // and gives exactly the bytes a fresh mesh would
    const fresh = drain(meshJob({ source: doc.source, bounds: doc.bounds, resolution: 24, smoothNormals: false, finish: "satin" }));
    expect(flat.glb).toEqual(fresh.glb);
    expect(parseGLB(flat.glb).json.meshes[0].primitives[0].indices).toBeUndefined();
    expect(parseGLB(metal.glb).json.materials[0].pbrMetallicRoughness.metallicFactor).toBe(1);
  });

  it("does not mutate the cached surface while finishing", async () => {
    await source.build({ doc, params });
    const [key] = meshCache.keys();
    const s = meshCache.get(key);
    const before = [s.positions.slice(), s.indices.slice(), s.normals.slice(), s.curvature.slice()];
    await source.build({ doc, params: { ...params, smoothNormals: false } });
    expect([s.positions, s.indices, s.normals, s.curvature]).toEqual(before);
  });

  it("hits on a rename, and remeshes on a source, bounds or resolution change", async () => {
    await source.build({ doc, params });
    expect((await source.build({ doc: { ...doc, title: "Renamed" }, params })).meta.notes).toMatch(/mesh reused/);
    expect((await source.build({ doc, params: { resolution: 32 } })).meta.notes).not.toMatch(/mesh reused/);
    expect((await source.build({ doc: { ...doc, source: "sphere(0.15)" }, params })).meta.notes).not.toMatch(/mesh reused/);
    expect(meshCache.size).toBe(3);
    await source.build({ doc: { ...doc, bounds: { min: [-0.4, -0.4, -0.4], max: [0.4, 0.4, 0.4] } }, params });
    expect(meshCache.size).toBe(3); // the oldest was evicted
  });

  it("does not cache a failed build", async () => {
    await expect(source.build({ doc: { ...doc, source: "sphere(" }, params })).rejects.toThrow(/line 1/);
    await expect(source.build({ doc: { ...doc, bounds: null }, params })).rejects.toThrow(/Bounds are missing/);
    expect(meshCache.size).toBe(0);
  });

  it("is an LRU bounded by entries and bytes, always keeping the newest", () => {
    const surf = (n) => ({ positions: new Float32Array(n), indices: new Uint32Array(0), normals: new Float32Array(0), curvature: new Float32Array(0) });
    const c = createMeshCache({ entries: 2, bytes: 1000 });
    c.set("a", surf(10));
    c.set("b", surf(10));
    c.get("a"); // a is now the most recent
    c.set("c", surf(10));
    expect(c.keys()).toEqual(["a", "c"]);
    c.set("big", surf(400)); // 1600 bytes: over budget alone, but kept
    expect(c.keys()).toEqual(["big"]);
    expect(c.bytes).toBe(1600);
  });
});

describe("worker lifecycle", () => {
  let made;
  let warn;
  const saved = { ...workerTimeouts };

  /** Install a fake Worker; `script(worker, index)` runs a tick after it is created. */
  function fakeWorkers(script) {
    made = [];
    class FakeWorker {
      constructor(url, opts) {
        this.url = url;
        this.opts = opts;
        this.terminated = false;
        const index = made.push(this) - 1;
        setTimeout(() => script(this, index), 0);
      }
      postMessage(m) {
        this.message = m;
      }
      terminate() {
        this.terminated = true;
      }
      emit(data) {
        if (!this.terminated) this.onmessage?.({ data });
      }
      fail(message) {
        if (!this.terminated) this.onerror?.({ message, preventDefault() {} });
      }
      runForReal() {
        if (this.terminated) return;
        const { id, job } = this.message;
        const surface = drain(meshSurface(job));
        const result = drain(finishMesh(surface, job));
        this.emit({ id, type: "done", ok: true, surface, result });
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
  }
  const ready = (w) => w.emit({ type: "ready" });
  const works = (w) => {
    ready(w);
    w.runForReal();
  };

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
    Object.assign(workerTimeouts, saved);
  });

  const small = { source: "sphere(0.1)", bounds: doc.bounds, resolution: 16 };

  it("starts the worker from a blob URL when the bundle is cross-origin", async () => {
    const urls = [];
    fakeWorkers(works);
    const Real = globalThis.Worker;
    vi.stubGlobal("Worker", class extends Real {
      constructor(url, opts) {
        urls.push(String(url));
        if (!String(url).startsWith("blob:")) throw new DOMException("cross-origin", "SecurityError");
        super(url, opts);
      }
    });
    vi.stubGlobal("location", { origin: "https://elsewhere.example" });
    vi.stubGlobal("fetch", async () => ({ ok: true, text: async () => "self.postMessage({ type: 'ready' })" }));
    const r = await runJob(small);
    expect(r.stats.triangles).toBeGreaterThan(0);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(/^blob:/);
    expect(warn).not.toHaveBeenCalled(); // no main-thread fallback
  });

  it("meshes in a module worker and posts it the job", async () => {
    fakeWorkers(works);
    const r = await runJob(small);
    expect(r.stats.triangles).toBeGreaterThan(0);
    expect(made).toHaveLength(1);
    expect(made[0].opts).toMatchObject({ type: "module" });
    expect(made[0].message.job).toMatchObject({ source: "sphere(0.1)", resolution: 16 });
    expect(made[0].terminated).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the main thread when the worker fails to load", async () => {
    fakeWorkers((w) => w.fail("404 Not Found"));
    const r = await runJob(small);
    expect(r.stats.triangles).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/main thread/), expect.stringMatching(/404/));
  });

  it("falls back when the worker never says it is ready", async () => {
    workerTimeouts.readyMs = 30;
    fakeWorkers(() => {});
    const r = await runJob(small);
    expect(r.stats.triangles).toBeGreaterThan(0);
    expect(made[0].terminated).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/main thread/), expect.stringMatching(/did not start/));
  });

  it("rejects, and does not rerun on the main thread, when the worker crashes mid-job", async () => {
    fakeWorkers((w) => {
      ready(w);
      w.fail("Out of memory");
    });
    await expect(runJob({ ...small, resolution: 160 })).rejects.toThrow(/crashed at resolution 160 \(Out of memory\).*lower resolution/);
    expect(made[0].terminated).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects when a started worker goes quiet", async () => {
    workerTimeouts.stallMs = 30;
    fakeWorkers(ready);
    await expect(runJob(small)).rejects.toThrow(/stopped responding/);
    expect(made[0].terminated).toBe(true);
  });

  it("keeps a worker alive while it reports progress", async () => {
    workerTimeouts.stallMs = 60;
    fakeWorkers((w) => {
      ready(w);
      let n = 0;
      const tick = setInterval(() => {
        if (++n < 6) return w.emit({ id: w.message.id, type: "progress", step: { layer: n } });
        clearInterval(tick);
        w.runForReal();
      }, 20);
    });
    await expect(runJob(small)).resolves.toMatchObject({ stats: { resolution: 16 } });
  });

  it("passes a job error through as is", async () => {
    fakeWorkers((w) => {
      ready(w);
      w.emit({ id: w.message.id, type: "done", ok: false, error: "line 1, col 7: nope" });
    });
    await expect(runJob(small)).rejects.toThrow(/^line 1, col 7: nope$/);
  });

  it("supersedes a running build of the same url: terminates its worker and rejects it", async () => {
    fakeWorkers((w, i) => (i === 0 ? ready(w) : works(w)));
    const first = source.build({ doc, url: "automerge:a", params: { resolution: 16 } });
    await new Promise((r) => setTimeout(r, 5));
    const second = source.build({ doc: { ...doc, source: "sphere(0.15)" }, url: "automerge:a", params: { resolution: 16 } });
    await expect(first).rejects.toThrow(/superseded/);
    expect(made[0].terminated).toBe(true);
    await expect(second).resolves.toMatchObject({ kind: "glb" });
    expect(meshCache.size).toBe(1);
  });

  it("joins a running build of the same mesh instead of starting another", async () => {
    fakeWorkers(works);
    const a = source.build({ doc, url: "automerge:a", params: { resolution: 16 } });
    const b = source.build({ doc, url: "automerge:a", params: { resolution: 16, finish: "metal" } });
    const [ra, rb] = await Promise.all([a, b]);
    expect(made).toHaveLength(1);
    expect(parseGLB(ra.glb).json.materials).toBeUndefined();
    expect(parseGLB(rb.glb).json.materials).toHaveLength(1);
  });

  it("does not supersede across urls, or across resolutions of the same doc", async () => {
    fakeWorkers(works);
    const results = await Promise.all([
      source.build({ doc, url: "automerge:a", params: { resolution: 16 } }),
      source.build({ doc: { ...doc, source: "sphere(0.15)" }, url: "automerge:b", params: { resolution: 16 } }),
      source.build({ doc, url: "automerge:a", params: { resolution: 24 } }),
    ]);
    expect(results.map((r) => r.kind)).toEqual(["glb", "glb", "glb"]);
    expect(made).toHaveLength(3);
  });

  it("supersedes on the main thread too", async () => {
    vi.stubGlobal("Worker", undefined);
    const first = source.build({ doc: { ...doc, source: "gyroid(40mm, 4mm)" }, url: "automerge:a", params: { resolution: 64 } });
    const second = source.build({ doc, url: "automerge:a", params: { resolution: 16 } });
    await expect(first).rejects.toThrow(/superseded/);
    await expect(second).resolves.toMatchObject({ kind: "glb" });
    expect(meshCache.size).toBe(1);
  });
});
