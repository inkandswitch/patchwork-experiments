// The render manager (README.md, "Content"): what it builds, when, from
// what, and what it says of each object (./state.js), on the stage's time.
// Who builds among peers is ./lock.test.js's.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { FakeRepo, flush } from "../test/fake-repo.js";
import { CLAIM_MSG, createRenderManager as create, RETRY_BACKOFF_MS } from "./render-manager.js";
import { CLAIM_MS, LAPSE_MS } from "./lock.js";
import { DEPENDENCY_WAIT_MS } from "./render-manager.js";
import { manualTime } from "../stage/time.js";
import { newRenderDoc } from "../shared/datatype.js";
import { encodeGLB } from "../glb.js";
import { runBuild } from "./build.js";
import { pinnedRepo } from "../shared/versions.js";

/** The stage's time, stepped by the test: advance(ms) moves it at least a frame. */
function fakeTimers() {
  const time = manualTime({ frameMs: 50, yieldTo: () => new Promise((r) => setImmediate(r)) });
  return { time, now: time.now, advance: (ms) => time.advance(Math.max(ms, 1)) };
}
/** A manager on `timers`' time; it tracks a render doc as one its stage made (nobody to claim against) unless told otherwise. */
function createRenderManager({ timers, now: _now, ...o }) {
  const m = create({ ...o, time: timers.time });
  return { ...m, track: (id, spec) => m.track(id, { createdHere: true, ...spec }), state: (id) => m.said(id)?.state ?? null };
}
const signal = () => new AbortController().signal;
// (GLB hashing without WebCrypto: every step lands on the stepped time)
beforeAll(() => vi.stubGlobal("crypto", {}));
afterAll(() => vi.unstubAllGlobals());

const tinyGLB = (z = 0) => encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, z] }] });

function setup({ params = [{ key: "size", kind: "number", default: 1, cost: "cheap" }], build, fingerprint, pinned = false, peerId, readOnly = false } = {}) {
  const repo = new FakeRepo();
  if (peerId) repo.peerId = peerId;
  const timers = fakeTimers();
  const source = repo.add({ "@patchwork": { type: "thing" }, title: "Thing", size: 1 });
  const render = repo.add({ ...newRenderDoc({ title: "Thing", parent: source.url, providerId: "thing", params: { size: 1 } }), pinned });
  const impl = {
    // output depends on the size param, as a real provider's would
    build: vi.fn(build ?? (async ({ params: p }) => ({ kind: "glb", glb: tinyGLB(Number(p?.size) || 0), meta: { notes: "ok" } }))),
    ...(fingerprint ? { fingerprint } : {}),
  };
  const provider = { id: "thing", name: "Thing", params, module: impl };
  const states = [];
  const glbs = [];
  const mgr = createRenderManager({
    repo,
    loadProvider: async (id) => (id === "thing" ? provider : null),
    onState: (id, s) => states.push(s),
    onGLB: (id, bytes, url) => glbs.push(url),
    timers,
    now: timers.now,
    readOnly,
  });
  return { repo, timers, source, render, impl, provider, mgr, states, glbs };
}

describe("render manager", () => {
  // A pinned or refusing stage's (STAGE.md, "Views, stages and links"): it shows what is built,
  // and over every reason a render could be rebuilt it builds nothing and
  // writes no render doc.
  for (const why of ["never built", "params", "source", "a build that failed", "rebuild()"]) {
    it(`read-only: ${why}: builds nothing, writes nothing, still shows what is built`, async () => {
      const built = setup();
      await built.mgr.track("o1", { sourceUrl: built.source.url, renderUrl: built.render.url });
      await built.timers.advance(0);
      const t = setup({ readOnly: true });
      if (why !== "never built") {
        // the same render, built as the writable manager built it
        t.render.change((d) => Object.assign(d, JSON.parse(JSON.stringify(built.render.doc()))));
        if (why === "params") t.render.change((d) => (d.params.size = 7));
        if (why === "source") t.source.change((d) => (d.size = 9));
        if (why === "a build that failed") t.render.change((d) => (d.failure = { error: "boom", inputs: '{"size":1}|h:x' }));
      }
      const glb = t.repo.add({ "@patchwork": { type: "file" }, name: "x.glb", extension: "glb", mimeType: "model/gltf-binary", content: tinyGLB() });
      t.render.change((d) => (d.result = { ...JSON.parse(JSON.stringify(d.result ?? { builtFrom: null, bounds: null, builtAt: null })), glbUrl: glb.url }));
      const heads = t.render.heads();
      const calls = [];
      const change = t.render.change.bind(t.render);
      t.render.change = (...a) => (calls.push("change"), change(...a));
      t.render.broadcast = () => calls.push("broadcast");
      await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
      if (why === "rebuild()") t.mgr.rebuild("o1");
      await t.timers.advance(10 * 60_000);
      expect(t.impl.build).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
      expect(t.render.heads()).toEqual(heads);
      expect(t.repo.created).toEqual([]);
      expect(t.glbs).toEqual([glb.url]);
    });
  }

  // C3 (README.md, "Content", "Who builds"): what a reader shows of a build
  it("a reader says a build is in progress only while it hears a builder", async () => {
    const t = setup({ readOnly: true });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.mgr.state("o1")).toEqual({ state: "stale", reason: "never-built", hold: null });
    const hear = (n, phase) => t.render.emit("ephemeral-message", { message: { type: CLAIM_MSG, from: "a-peer:1", n, key: "k", phase } });
    hear(1, "build");
    expect(t.mgr.state("o1")).toEqual({ state: "building", by: "a-peer:1" });
    hear(2, "done");
    expect(t.mgr.state("o1")).toMatchObject({ state: "stale" });
    // a builder that goes quiet without a word is believed for LAPSE_MS, no longer
    hear(3, "build");
    await t.timers.advance(LAPSE_MS - 100);
    expect(t.mgr.state("o1")).toMatchObject({ state: "building" });
    await t.timers.advance(200);
    expect(t.mgr.state("o1")).toMatchObject({ state: "stale" });
  });

  it("builds immediately when never built, stores a new GLB file doc, and loads it", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    const r = t.render.doc().result;
    expect(Object.keys(r).sort()).toEqual(["bounds", "builtAt", "builtFrom", "glbUrl"]);
    expect(t.render.doc().failure).toBeNull();
    expect(r.glbUrl).toBe(t.repo.created[0].url);
    expect(r.builtFrom.heads).toEqual(t.source.heads());
    expect(r.builtFrom.paramsKey).toBe('{"size":1}');
    const file = t.repo.created[0].doc();
    expect(file).toMatchObject({ "@patchwork": { type: "file" }, name: "Thing.glb", extension: "glb", mimeType: "model/gltf-binary" });
    expect(file.content).toBeInstanceOf(Uint8Array);
    expect(t.glbs).toEqual([r.glbUrl]);
    expect(t.states.at(-1)).toMatchObject({ state: { state: "fresh" }, notes: "ok" });
  });

  it("never writes the source doc", async () => {
    const t = setup();
    const before = t.source.heads();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(1000);
    expect(t.source.heads()).toEqual(before);
  });

  it("coalesces quick param edits into one build of the last, and repoints glbUrl", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    const firstGlb = t.render.doc().result?.glbUrl;
    t.render.change((d) => (d.params.size = 2));
    t.render.change((d) => (d.params.size = 3));
    await t.timers.advance(1000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.impl.build.mock.calls[1][0].params).toEqual({ size: 3 });
    expect(t.render.doc().result?.glbUrl).not.toBe(firstGlb);
    expect(t.repo.created.length).toBe(2); // old GLB orphaned, not rewritten
  });


  it("uses the fingerprint instead of heads when the provider has one", async () => {
    const t = setup({ fingerprint: (doc) => String(doc.size) });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.source.change((d) => (d.title = "Renamed")); // not read by build
    await t.timers.advance(2000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    t.source.change((d) => (d.size = 9));
    await t.timers.advance(2000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().result?.builtFrom.fingerprint).toBe("9");
  });

  it("does not auto-rebuild when pinned, but rebuild() forces it", async () => {
    const t = setup({ pinned: true });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(5000);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(t.states.at(-1)).toMatchObject({ state: { state: "stale", hold: "pinned" }, pinned: true });
    t.mgr.rebuild("o1");
    await flush();
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().result?.builtFrom).not.toBeNull();
  });


  it("retries a failed build with backoff, then gives up until the inputs change", async () => {
    let fail = true;
    const t = setup({ build: async () => { if (fail) throw new Error("flaky"); return { kind: "glb", glb: tinyGLB() }; } });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.mgr.state("o1")).toEqual({ state: "failed", in: "build", error: "flaky", retrying: true });
    for (const wait of RETRY_BACKOFF_MS) await t.timers.advance(wait + 900);
    expect(t.impl.build).toHaveBeenCalledTimes(1 + RETRY_BACKOFF_MS.length);
    await t.timers.advance(10 * 60_000);
    expect(t.impl.build).toHaveBeenCalledTimes(1 + RETRY_BACKOFF_MS.length); // out of retries
    expect(t.mgr.state("o1")).toMatchObject({ state: "failed", retrying: false });
    fail = false;
    expect(t.render.doc().failure).toEqual({ error: "flaky", inputs: expect.stringContaining('{"size":1}') });
    t.render.change((d) => (d.params.size = 2));
    await t.timers.advance(2000);
    expect(t.render.doc().failure).toBeNull();
    expect(t.mgr.state("o1")).toEqual({ state: "fresh" });
  });

  it("a build the provider aborts (AbortError) is not an error and is tried again", async () => {
    let calls = 0;
    const t = setup({
      build: async () => {
        if (calls++ === 0) throw Object.assign(new Error("superseded"), { name: "AbortError" });
        return { kind: "glb", glb: tinyGLB() };
      },
    });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(1000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().failure).toBeNull();
    expect(t.render.doc().result?.glbUrl).toBeTruthy();
  });

  it("a transient failure recovers on the first retry", async () => {
    let calls = 0;
    const t = setup({ build: async () => { if (calls++ === 0) throw new Error("cdn"); return { kind: "glb", glb: tinyGLB() }; } });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    await t.timers.advance(RETRY_BACKOFF_MS[0] + 900);
    expect(t.render.doc().failure).toBeNull();
    expect(t.render.doc().result?.glbUrl).toBeTruthy();
  });

  it("rebuilds when the installed provider is newer than the build, never when it is older", async () => {
    const t = setup();
    t.provider.version = 2;
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.render.doc().result?.builtFrom.providerVersion).toBe(2);
    t.mgr.dispose();

    // a peer still running version 1 leaves the newer build alone
    const older = createRenderManager({
      repo: t.repo, timers: t.timers, now: t.timers.now,
      loadProvider: async () => ({ ...t.provider, version: 1 }),
    });
    await older.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(older.state("o1")).toEqual({ state: "fresh" });
    older.dispose();

    // version 3 rebuilds it once
    const newer = createRenderManager({
      repo: t.repo, timers: t.timers, now: t.timers.now,
      loadProvider: async () => ({ ...t.provider, version: 3 }),
    });
    await newer.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().result?.builtFrom.providerVersion).toBe(3);
    newer.dispose();
  });

  it("keys a scene-render dependency by its GLB: a failure written beside it doesn't rebuild downstream", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const result = (glbUrl) => ({ glbUrl, builtFrom: { heads: ["x"], fingerprint: null, paramsKey: "{}", deps: {} }, bounds: null, builtAt: 1 });
    const upstream = repo.add({ ...newRenderDoc({ title: "Hull", parent: "automerge:x", providerId: "hull", params: {} }), result: result("automerge:glb1") });
    const source = repo.add({ "@patchwork": { type: "flow" }, body: upstream.url });
    const render = repo.add(newRenderDoc({ title: "Flow", parent: source.url, providerId: "flow", params: {} }));
    let n = 0;
    const impl = { build: vi.fn(async () => ({ kind: "glb", glb: tinyGLB(n++) })), dependencies: (doc) => [doc.body] };
    const mgr = createRenderManager({ repo, timers, now: timers.now, loadProvider: async () => ({ id: "flow", name: "Flow", params: [], module: impl }) });
    await mgr.track("o", { sourceUrl: source.url, renderUrl: render.url });
    for (let i = 0; i < 3; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(1);
    expect(render.doc().result?.builtFrom.deps).toEqual({ [upstream.url]: ["fp:render:automerge:glb1"] });

    upstream.change((d) => (d.failure = { error: "boom", inputs: "{}|h:y" }));
    for (let i = 0; i < 6; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(1);

    upstream.change((d) => (d.result = result("automerge:glb2")));
    for (let i = 0; i < 6; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(2);
    expect(render.doc().result?.builtFrom.deps).toEqual({ [upstream.url]: ["fp:render:automerge:glb2"] });
    mgr.dispose();
  });

  it("uses the provider's fingerprintDependency when it has one", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const hull = repo.add({ "@patchwork": { type: "hull" }, length: 10, title: "Hull" });
    const source = repo.add({ "@patchwork": { type: "flow" }, body: hull.url });
    const render = repo.add(newRenderDoc({ title: "Flow", parent: source.url, providerId: "flow", params: {} }));
    let n = 0;
    const impl = {
      build: vi.fn(async () => ({ kind: "glb", glb: tinyGLB(n++) })),
      dependencies: (doc) => [doc.body],
      fingerprintDependency: (url, doc) => `len:${doc.length}`,
    };
    const mgr = createRenderManager({ repo, timers, now: timers.now, loadProvider: async () => ({ id: "flow", name: "Flow", params: [], module: impl }) });
    await mgr.track("o", { sourceUrl: source.url, renderUrl: render.url });
    for (let i = 0; i < 3; i++) await timers.advance(1000);
    hull.change((d) => (d.title = "Renamed hull"));
    for (let i = 0; i < 6; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(1);
    hull.change((d) => (d.length = 11));
    for (let i = 0; i < 6; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(2);
    mgr.dispose();
  });

  it("doesn't rebuild a render it opened as never-built if its result arrives while it claims (CLAIM_MS)", async () => {
    const t = setup();
    const mgr = create({ repo: t.repo, time: t.timers.time, loadProvider: async () => t.provider });
    await mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.impl.build).not.toHaveBeenCalled();
    // the rest of its history syncs in: a peer built it
    t.render.change((d) => {
      d.result = { glbUrl: "automerge:theirs", builtFrom: { heads: t.source.heads(), fingerprint: null, paramsKey: '{"size":1}', deps: {} }, bounds: null, builtAt: 1 };
    });
    await t.timers.advance(CLAIM_MS + 1000);
    expect(t.impl.build).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it("builds a render that really is never-built once its claim has stood CLAIM_MS", async () => {
    const t = setup();
    const mgr = create({ repo: t.repo, time: t.timers.time, loadProvider: async () => t.provider });
    await mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(CLAIM_MS - 100);
    expect(t.impl.build).not.toHaveBeenCalled();
    await t.timers.advance(200);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it("builds a render doc this scene just created at once", async () => {
    const t = setup();
    const mgr = create({ repo: t.repo, time: t.timers.time, loadProvider: async () => t.provider });
    await mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, createdHere: true });
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it("doesn't rebuild over a build made from source changes it hasn't synced yet", async () => {
    const t = setup({ fingerprint: (doc) => `fp:${doc.size}` });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    // a peer that is one edit ahead (size 7) rebuilds; we see its build, not yet its edit
    t.render.change((d) => {
      d.result = { ...JSON.parse(JSON.stringify(d.result)), builtFrom: { ...JSON.parse(JSON.stringify(d.result.builtFrom)), heads: ["a-change-we-have-not-synced"], fingerprint: "fp:7" } };
    });
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.mgr.state("o1")).toEqual({ state: "fresh", behind: true });
    // the peer's edit syncs in: now we have what it built from, and it is fresh
    t.source._history.set("a-change-we-have-not-synced", {});
    t.source.change((d) => (d.size = 7));
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.mgr.state("o1")).toEqual({ state: "fresh" });
  });

  it("still rebuilds a build made from an older version it has", async () => {
    const t = setup({ fingerprint: (doc) => `fp:${doc.size}` });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    const builtHeads = t.source.heads();
    t.source.change((d) => (d.size = 2));
    // a lagging peer writes a build from the version before that edit
    t.render.change((d) => {
      d.result = { ...JSON.parse(JSON.stringify(d.result)), builtFrom: { ...JSON.parse(JSON.stringify(d.result.builtFrom)), heads: builtHeads, fingerprint: "fp:1" } };
    });
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().result?.builtFrom.fingerprint).toBe("fp:2");
  });

  // the signal (README.md, "Writing a provider"): aborted when the build's result is no longer wanted
  it("an edit during a build cancels it (its signal aborts, nothing is written) and the newer inputs are built", async () => {
    let release;
    const signals = [];
    const t = setup({
      build: vi.fn(({ signal: s }) => (signals.push(s), new Promise((r) => (release = () => r({ kind: "glb", glb: tinyGLB() }))))),
    });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.mgr.state("o1")).toEqual({ state: "building", by: "here" });
    t.render.change((d) => (d.params.size = 7)); // during the build
    await t.timers.advance(200);
    expect(signals[0].aborted).toBe(true);
    release(); // (a provider that ignores its signal: what it makes is dropped)
    await t.timers.advance(1000);
    expect(t.render.doc().result).toBeNull();
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    release();
    await t.timers.advance(100);
    expect(t.render.doc().result?.builtFrom.paramsKey).toBe('{"size":7}');
    expect(signals[1].aborted).toBe(false);
  });

  it("an object untracked (removed) or a manager disposed (its stage closed) mid-build aborts the build's signal and leaves no build in progress", async () => {
    for (const end of ["untrack", "dispose"]) {
      const signals = [];
      const t = setup({ build: vi.fn(({ signal: s }) => (signals.push(s), new Promise(() => {}))) });
      await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
      await t.timers.advance(0);
      expect(t.mgr.state("o1")).toEqual({ state: "building", by: "here" });
      if (end === "untrack") t.mgr.untrack("o1");
      else t.mgr.dispose();
      await t.timers.advance(0);
      expect(signals[0].aborted).toBe(true);
    }
  });

  it("reports a missing provider and picks it up when it registers", async () => {
    const t = setup();
    let available = false;
    const states = [];
    const mgr = createRenderManager({
      repo: t.repo,
      loadProvider: async () => (available ? t.provider : null),
      onState: (id, s) => states.push(s),
      onGLB: () => {},
      timers: t.timers,
      now: t.timers.now,
    });
    await mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    expect(states.at(-1).state).toEqual({ state: "no-provider", providerId: "thing" });
    available = true;
    await mgr.providersChanged();
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
  });

  it("cleans up listeners and timers", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.render.change((d) => (d.params.size = 2));
    t.mgr.dispose();
    expect(t.render.listenerCount("change")).toBe(0);
    expect(t.source.listenerCount("change")).toBe(0);
  });
});

describe("render manager: convergence and recovery", () => {
  it("two peers whose provider versions fingerprint differently stop rebuilding each other", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const source = repo.add({ "@patchwork": { type: "hull" }, hull: 1 });
    const render = repo.add(newRenderDoc({ title: "Hull", parent: source.url, providerId: "p", params: {} }));
    const peer = (ver) =>
      createRenderManager({
        repo,
        timers,
        now: timers.now,
        loadProvider: async () => ({ id: "p", name: "p", params: [], module: { fingerprint: (d) => `p/${ver}:${d.hull}`, build: async () => ({ kind: "glb", glb: tinyGLB() }) } }),
      });
    const a = peer(1);
    const b = peer(2);
    await a.track("o", { sourceUrl: source.url, renderUrl: render.url });
    await b.track("o", { sourceUrl: source.url, renderUrl: render.url });
    for (let i = 0; i < 60; i++) await timers.advance(1000);
    expect(repo.created.length).toBeLessThanOrEqual(2);
    // An edit still rebuilds; the disagreement costs at most one extra build.
    const before = repo.created.length;
    source.change((d) => (d.hull = 2));
    for (let i = 0; i < 60; i++) await timers.advance(1000);
    expect(repo.created.length - before).toBeLessThanOrEqual(2);
    expect(render.doc().result?.builtFrom.fingerprint).toMatch(/:2$/);
    // The peer that was overridden reports it, and a manual rebuild still works.
    const loser = [a, b].find((m) => m.state("o").state === "stale");
    expect(loser.state("o")).toEqual({ state: "stale", reason: "fingerprint", hold: "contested" });
    loser.rebuild("o");
    await flush();
    expect(repo.created.length - before).toBeLessThanOrEqual(3);
  });


  it("doesn't say a superseded failure once an edit puts the source back to what was built", async () => {
    const t = setup({
      fingerprint: (d) => String(d.size),
      build: async ({ doc }) => {
        if (doc.size === 2) throw new Error("syntax error");
        return { kind: "glb", glb: tinyGLB() };
      },
    });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.source.change((d) => (d.size = 2));
    await t.timers.advance(1000);
    expect(t.render.doc().failure).toEqual({ error: "syntax error", inputs: expect.stringContaining("fp:2") });
    expect(t.mgr.state("o1")).toMatchObject({ state: "failed", error: "syntax error" });
    t.source.change((d) => (d.size = 1));
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(2); // no rebuild needed
    expect(t.mgr.state("o1")).toEqual({ state: "fresh" });
  });

  it("runs a rebuild requested while another build is in flight", async () => {
    let release;
    const t = setup({
      pinned: true,
      build: vi.fn(() => new Promise((r) => (release = () => r({ kind: "glb", glb: tinyGLB() })))),
    });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    t.mgr.rebuild("o1");
    await flush();
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    t.render.change((d) => (d.params.size = 7));
    t.mgr.rebuild("o1"); // pressed while building
    release();
    await flush();
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect(t.render.doc().result?.builtFrom.paramsKey).toBe('{"size":7}');
  });




  it("retries loading a GLB file doc that wasn't available yet", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    const url = "automerge:notsyncedyet";
    t.render.change((d) => (d.result = { ...JSON.parse(JSON.stringify(d.result)), glbUrl: url })); // a peer's build, file doc not here yet
    await t.timers.advance(0);
    expect(t.mgr.state("o1")).toMatchObject({ state: "failed", in: "load", error: expect.stringMatching(/Could not load GLB/) });
    t.repo.add({ "@patchwork": { type: "file" }, extension: "glb", content: tinyGLB() }, url);
    await t.timers.advance(1_000);
    expect(t.glbs.at(-1)).toBe(url);
    expect(t.mgr.state("o1")).toEqual({ state: "fresh" });
  });
});

describe("render manager: provider dependencies", () => {
  function depSetup({ repo = new FakeRepo(), fingerprint } = {}) {
    const timers = fakeTimers();
    const hull = repo.add({ "@patchwork": { type: "hull" }, length: 10 });
    const other = repo.add({ "@patchwork": { type: "hull" }, length: 5 });
    const source = repo.add({ "@patchwork": { type: "flow" }, body: hull.url });
    const render = repo.add(newRenderDoc({ title: "Flow", parent: source.url, providerId: "flow", params: {} }));
    const impl = {
      dependencies: vi.fn((doc) => (doc.body ? [doc.body, doc.body, source.url] : [])),
      build: vi.fn(async ({ repo: r, doc }) => {
        if (doc.body) {
          try {
            await r.find(doc.body);
          } catch {
            // build() decides; this one just builds without it
          }
        }
        return { kind: "glb", glb: tinyGLB() };
      }),
      ...(fingerprint ? { fingerprint } : {}),
    };
    const provider = { id: "flow", name: "Flow", params: [], module: impl };
    const states = [];
    const mgr = createRenderManager({ repo, loadProvider: async () => provider, onState: (id, s) => states.push(s), timers, now: timers.now });
    return { repo, timers, hull, other, source, render, impl, mgr, states };
  }

  it("records the heads of each dependency as read for the build", async () => {
    const t = depSetup();
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    // deduplicated, and the source itself is not its own dependency
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
    expect(t.hull.listenerCount("change")).toBe(1);
    expect(t.states.at(-1).state).toEqual({ state: "fresh" });
  });

  it("rebuilds after a dependency edit, debounced like a source edit", async () => {
    const t = depSetup();
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    t.hull.change((d) => (d.length = 11));
    t.hull.change((d) => (d.length = 12));
    expect(t.states.at(-1).state).toEqual({ state: "stale", reason: "deps", hold: null });
    await t.timers.advance(700);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    await t.timers.advance(1000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().result?.builtFrom.deps[t.hull.url]).toEqual(t.hull.heads());
    expect(t.states.at(-1).state).toEqual({ state: "fresh" });
    expect(t.hull.heads()).toEqual(t.render.doc().result?.builtFrom.deps[t.hull.url]); // never written
  });

  it("follows the dependency list as the source changes it", async () => {
    const t = depSetup();
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    t.source.change((d) => (d.body = t.other.url));
    await flush();
    expect(t.hull.listenerCount("change")).toBe(0);
    expect(t.other.listenerCount("change")).toBe(1);
    await t.timers.advance(3000);
    expect(Object.keys(t.render.doc().result?.builtFrom.deps)).toEqual([t.other.url]);
    // edits to the old dependency no longer matter
    const builds = t.impl.build.mock.calls.length;
    t.hull.change((d) => (d.length = 99));
    await t.timers.advance(2000);
    expect(t.impl.build).toHaveBeenCalledTimes(builds);
    // unlinking drops the subscription and records no deps
    t.source.change((d) => (d.body = null));
    await t.timers.advance(3000);
    expect(t.other.listenerCount("change")).toBe(0);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({});
  });


  it("an unloadable dependency doesn't block the build; it is retried and rebuilds when it arrives", async () => {
    const t = depSetup();
    const missing = "automerge:nothereyet";
    t.source.change((d) => (d.body = missing));
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [missing]: [] });
    expect(t.render.doc().failure).toBeNull();
    const late = t.repo.add({ "@patchwork": { type: "hull" }, length: 3 }, missing);
    await t.timers.advance(1000); // retry finds it
    expect(late.listenerCount("change")).toBe(1);
    await t.timers.advance(1500);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [missing]: late.heads() });
  });

  it("waits (a while) for a dependency still loading before the first build", async () => {
    const repo = new FakeRepo();
    let release;
    const gate = new Promise((r) => (release = r));
    const find = repo.find.bind(repo);
    let slow = null;
    repo.find = async (url) => {
      if (url === slow) await gate;
      return find(url);
    };
    const t = depSetup({ repo });
    slow = t.hull.url;
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    expect(t.impl.build).not.toHaveBeenCalled();
    release();
    await flush();
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
  });

  it("gives up waiting for a dependency after DEPENDENCY_WAIT_MS", async () => {
    const repo = new FakeRepo();
    const t = depSetup({ repo });
    const find = repo.find.bind(repo);
    repo.find = (url) => (url === t.hull.url ? new Promise(() => {}) : find(url));
    t.impl.build.mockImplementation(async () => ({ kind: "glb", glb: tinyGLB() })); // doesn't wait for it either
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(DEPENDENCY_WAIT_MS - 100);
    expect(t.impl.build).not.toHaveBeenCalled();
    await t.timers.advance(200);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: [] });
  });

  it("waits, never rebuilding, while a dependency it was built from is still loading, however long; fresh once it has", async () => {
    const repo = new FakeRepo();
    const t = depSetup({ repo });
    t.render.change((d) => (d.result = { glbUrl: null, builtFrom: { heads: t.source.heads(), fingerprint: null, paramsKey: "{}", deps: { [t.hull.url]: t.hull.heads() } }, bounds: null, builtAt: 1 }));
    let release;
    const gate = new Promise((r) => (release = r));
    const find = repo.find.bind(repo);
    repo.find = async (url) => {
      if (url === t.hull.url) await gate;
      return find(url);
    };
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(DEPENDENCY_WAIT_MS * 4);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(t.states.at(-1).state).toEqual({ state: "waiting", on: [t.hull.url] });
    release();
    await t.timers.advance(10_000);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(t.states.at(-1).state).toEqual({ state: "fresh" });
  });

  it("records a dependency that finished loading during the build as read, so it doesn't build twice", async () => {
    const repo = new FakeRepo();
    const t = depSetup({ repo });
    let release;
    const gate = new Promise((r) => (release = r));
    const find = repo.find.bind(repo);
    repo.find = async (url) => {
      if (url === t.hull.url) await gate;
      return find(url);
    };
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(DEPENDENCY_WAIT_MS); // gives up waiting; build() awaits the same find
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
    await t.timers.advance(10_000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
  });

  function depPeers({ canLoad = () => true, lists = () => true } = {}) {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const hull = repo.add({ "@patchwork": { type: "hull" }, length: 10 });
    const source = repo.add({ "@patchwork": { type: "flow" }, body: hull.url });
    const render = repo.add(newRenderDoc({ title: "Flow", parent: source.url, providerId: "flow", params: {} }));
    const peer = (name) => {
      const view = {
        peerId: name,
        find: (url) => (url === hull.url && !canLoad(name) ? Promise.reject(new Error("unavailable")) : repo.find(url)),
        create2: (d) => repo.create2(d),
      };
      const impl = {
        build: async ({ repo: r, doc }) => {
          let length = 0;
          try {
            length = (await r.find(doc.body)).doc().length;
          } catch {
            // builds without the body
          }
          return { kind: "glb", glb: tinyGLB(length) };
        },
        ...(lists(name) ? { dependencies: (doc) => (doc.body ? [doc.body] : []) } : {}),
      };
      return createRenderManager({ repo: view, timers, now: timers.now, loadProvider: async () => ({ id: "flow", name: "Flow", params: [], module: impl }) });
    };
    return { repo, timers, hull, source, render, peer };
  }

  it("a peer that can't load a dependency doesn't fight one that can", async () => {
    const t = depPeers({ canLoad: (name) => name === "a" });
    const a = t.peer("a");
    const b = t.peer("b");
    await a.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await b.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    for (let i = 0; i < 60; i++) await t.timers.advance(1000);
    expect(t.repo.created.length).toBeLessThanOrEqual(2);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
    expect(b.state("o")).toEqual({ state: "stale", reason: "deps", hold: "unavailable" });
    // a real edit to the hull is still picked up by the peer that can read it
    const before = t.repo.created.length;
    t.hull.change((d) => (d.length = 11));
    for (let i = 0; i < 60; i++) await t.timers.advance(1000);
    expect(t.repo.created.length - before).toBe(1);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
  });

  it("a peer whose provider lists no dependencies doesn't fight one whose provider does", async () => {
    const t = depPeers({ lists: (name) => name === "a" });
    const a = t.peer("a");
    const b = t.peer("b");
    await a.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await b.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    for (let i = 0; i < 60; i++) await t.timers.advance(1000);
    expect(t.repo.created.length).toBeLessThanOrEqual(3);
    const settled = t.repo.created.length;
    for (let i = 0; i < 60; i++) await t.timers.advance(1000);
    expect(t.repo.created.length).toBe(settled);
    const loser = [a, b].find((m) => m.state("o").state === "stale");
    expect(loser.state("o")).toEqual({ state: "stale", reason: "deps", hold: "contested" });
  });

  it("a provider whose dependencies() throws builds as if it had none", async () => {
    const t = depSetup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    t.impl.dependencies.mockImplementation(() => {
      throw new Error("nope");
    });
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({});
    vi.restoreAllMocks();
  });

  it("unsubscribes from dependencies on untrack and dispose", async () => {
    const t = depSetup();
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    expect(t.hull.listenerCount("change")).toBe(1);
    t.mgr.untrack("o");
    expect(t.hull.listenerCount("change")).toBe(0);
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    expect(t.hull.listenerCount("change")).toBe(1);
    t.hull.change((d) => (d.length = 1));
    t.mgr.dispose();
    expect(t.hull.listenerCount("change")).toBe(0);
  });
});

describe("runBuild", () => {
  it("rejects a provider result that isn't a GLB", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ parent: source.url, providerId: "p" }));
    const res = await runBuild({ signal: signal(), now: () => 1, 
      repo,
      renderHandle: render,
      sourceHandle: source,
      provider: { id: "p", module: { build: async () => ({ kind: "glb", glb: new Uint8Array(8) }) } },
    });
    expect(res.ok).toBe(false);
    expect(render.doc().failure).toEqual({ error: expect.any(String), inputs: null });
    expect(repo.created).toEqual([]);
  });

  // C4: compare-and-set
  it("never writes over a result committed while it ran, the same inputs or others", async () => {
    for (const theirs of [{ heads: "same" }, { heads: ["someoldhead"] }]) {
      const repo = new FakeRepo();
      const source = repo.add({ title: "s" });
      const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: { size: 1 } }));
      const build = async () => {
        if (theirs)
          render.change((d) => {
            d.result = { glbUrl: "automerge:theirs", builtFrom: { heads: theirs.heads === "same" ? [...source.heads()] : theirs.heads, fingerprint: null, paramsKey: '{"size":1}' }, bounds: null, builtAt: 1 };
          });
        return { kind: "glb", glb: tinyGLB() };
      };
      const res = await runBuild({ signal: signal(), now: () => 1, repo, renderHandle: render, sourceHandle: source, provider: { id: "p", params: [], module: { build } } });
      expect(res).toMatchObject({ ok: false, fenced: true });
      expect(repo.created).toEqual([]); // no orphan GLB doc
      expect(render.doc().result.glbUrl).toBe("automerge:theirs");
    }
  });

  it("a forced rebuild of an already-fresh render still builds, and makes a new GLB if the bytes differ", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: { size: 1 } }));
    let z = 0;
    const provider = { id: "p", params: [], module: { build: async () => ({ kind: "glb", glb: tinyGLB(z++) }) } };
    await runBuild({ signal: signal(), now: () => 1,  repo, renderHandle: render, sourceHandle: source, provider });
    const first = render.doc().result?.glbUrl;
    const res = await runBuild({ signal: signal(), now: () => 1,  repo, renderHandle: render, sourceHandle: source, provider });
    expect(res.superseded).toBeUndefined();
    expect(res.reused).toBe(false);
    expect(repo.created).toHaveLength(2);
    expect(render.doc().result?.glbUrl).not.toBe(first);
  });

  it("keeps the current GLB file doc when a rebuild produces the same bytes", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: {} }));
    const provider = { id: "p", params: [], module: { build: async () => ({ kind: "glb", glb: tinyGLB() }) } };
    await runBuild({ signal: signal(), now: () => 1,  repo, renderHandle: render, sourceHandle: source, provider });
    const first = render.doc().result?.glbUrl;
    const hash = render.doc().result?.builtFrom.glbHash;
    expect(hash).toMatch(/^(sha256|c53):/);
    source.change((d) => (d.title = "renamed"));
    const res = await runBuild({ signal: signal(), now: () => 1,  repo, renderHandle: render, sourceHandle: source, provider });
    expect(res.reused).toBe(true);
    expect(repo.created).toHaveLength(1);
    expect(render.doc().result?.glbUrl).toBe(first);
    expect(render.doc().result?.builtFrom.heads).toEqual(source.heads());
  });

  it("hands build() params clamped to their specs, records the provider version and meta.bounds", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: { n: 999, k: "nope" } }));
    const build = vi.fn(async () => ({ kind: "glb", glb: tinyGLB(), meta: { bounds: { min: [0, 0, 0], max: [1, 2, 3] } } }));
    const params = [
      { key: "n", kind: "integer", default: 4, min: 1, max: 10 },
      { key: "k", kind: "enum", default: "a", options: [{ value: "a" }, { value: "b" }] },
    ];
    await runBuild({ signal: signal(), now: () => 1,  repo, renderHandle: render, sourceHandle: source, provider: { id: "p", params, version: 3, module: { build } } });
    expect(build.mock.calls[0][0].params).toEqual({ n: 10, k: "a" });
    expect(render.doc().result?.builtFrom.paramsKey).toBe('{"k":"nope","n":999}'); // the stored values, as written
    expect(render.doc().result?.builtFrom.providerVersion).toBe(3);
    expect(render.doc().result?.bounds).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
  });
});

describe("pinnedRepo", () => {

  it("finds listed docs at their heads, everything else live, and passes the rest of the repo through", async () => {
    const repo = new FakeRepo();
    const a = repo.add({ v: "a1" });
    const b = repo.add({ v: "b1" });
    const a1 = a.heads();
    a.change((d) => (d.v = "a2"));
    b.change((d) => (d.v = "b2"));
    const r = pinnedRepo(repo, { [a.url]: a1 });
    expect((await r.find(a.url)).doc()).toEqual({ v: "a1" });
    expect((await r.find(a.url)).isReadOnly()).toBe(true);
    expect((await r.find(b.url)).doc()).toEqual({ v: "b2" });
    const made = await r.create2({ x: 1 });
    expect(repo.created).toContain(made);
    expect(pinnedRepo(repo, {})).toBe(repo);
    expect(pinnedRepo(repo, null)).toBe(repo);
  });
});

describe("render manager: fixed versions (at)", () => {
  it("builds from the source at the fixed heads, through a read-only view", async () => {
    const t = setup();
    const h1 = t.source.heads();
    t.source.change((d) => (d.size = 7));
    const seen = [];
    t.impl.build.mockImplementation(async ({ doc, handle, url }) => {
      seen.push({ size: doc.size, readOnly: handle.isReadOnly(), url });
      return { kind: "glb", glb: tinyGLB(doc.size) };
    });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, at: { heads: h1 } });
    await t.timers.advance(0);
    expect(seen).toEqual([{ size: 1, readOnly: true, url: `${t.source.url}#${h1[0]}` }]);
    expect(t.render.doc().result?.builtFrom.heads).toEqual(h1);
    expect(t.states.at(-1)).toMatchObject({ state: { state: "fresh" }, at: { heads: h1 }, builtHeads: h1 });
  });

  it("never goes stale from source edits; a params edit rebuilds at the fixed heads", async () => {
    const t = setup();
    const h1 = t.source.heads();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, at: { heads: h1 } });
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    t.source.change((d) => (d.size = 9));
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.states.at(-1).state).toEqual({ state: "fresh" });
    t.render.change((d) => (d.params.size = 2));
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.impl.build.mock.calls[1][0].doc.size).toBe(1);
    expect(t.render.doc().result?.builtFrom).toMatchObject({ heads: h1, paramsKey: '{"size":2}' });
  });

  it("a newer provider version still rebuilds a fixed object", async () => {
    const t = setup();
    const h1 = t.source.heads();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, at: { heads: h1 } });
    await t.timers.advance(0);
    t.provider.version = 2;
    t.render.change((d) => (d.title = "poke")); // anything that re-evaluates
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().result?.builtFrom).toMatchObject({ heads: h1, providerVersion: 2 });
  });

  it("fixing at fixPoint() changes nothing; following the latest again catches up", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    const glb = t.render.doc().result?.glbUrl;
    const at = t.mgr.fixPoint("o1");
    expect(at).toEqual({ heads: t.source.heads(), deps: {} });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, at });
    t.source.change((d) => (d.size = 4));
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().result?.glbUrl).toBe(glb);
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, at: null });
    expect(t.states.at(-1)).toMatchObject({ state: { state: "stale", reason: "heads", hold: null }, at: null });
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().result?.builtFrom.heads).toEqual(t.source.heads());
  });

  it("fixPoint is null before the first build", async () => {
    const t = setup({ pinned: true });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    expect(t.mgr.fixPoint("o1")).toBeNull();
    expect(t.mgr.fixPoint("nope")).toBeNull();
  });

  it("waits, without building, for fixed heads this replica doesn't have", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, at: { heads: ["not-here-yet"] } });
    await t.timers.advance(5000);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(t.states.at(-1)).toMatchObject({ state: { state: "loading", version: true }, at: { heads: ["not-here-yet"] } });
  });
});

describe("render manager: fixed dependencies", () => {
  function setupDeps() {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const hull = repo.add({ length: 10 });
    const source = repo.add({ body: hull.url, size: 1 });
    const render = repo.add(newRenderDoc({ title: "Flow", parent: source.url, providerId: "flow", params: {} }));
    const read = [];
    const impl = {
      dependencies: (doc) => [doc.body],
      build: vi.fn(async ({ repo: r, doc }) => {
        const h = await r.find(doc.body);
        read.push({ size: doc.size, length: h.doc().length });
        return { kind: "glb", glb: tinyGLB(h.doc().length) };
      }),
    };
    const provider = { id: "flow", name: "Flow", params: [], module: impl };
    const states = [];
    const mgr = createRenderManager({ repo, loadProvider: async () => provider, onState: (id, s) => states.push(s), timers, now: timers.now });
    return { repo, timers, hull, source, render, impl, mgr, states, read };
  }

  it("reads a listed dependency at its fixed heads and ignores edits to it; unlisted ones read live", async () => {
    const t = setupDeps();
    const at = { heads: t.source.heads(), deps: { [t.hull.url]: t.hull.heads() } };
    t.hull.change((d) => (d.length = 11));
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url, at });
    await flush();
    await t.timers.advance(0);
    expect(t.read).toEqual([{ size: 1, length: 10 }]);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: at.deps[t.hull.url] });
    t.hull.change((d) => (d.length = 12));
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.states.at(-1).state).toEqual({ state: "fresh" });

    // fixed source, dependency not listed: it reads live, and its edits rebuild
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url, at: { heads: at.heads } });
    await t.timers.advance(5000);
    expect(t.read.at(-1)).toEqual({ size: 1, length: 12 });
    t.hull.change((d) => (d.length = 13));
    await t.timers.advance(5000);
    expect(t.read.at(-1)).toEqual({ size: 1, length: 13 });
  });

  it("fixPoint lists the dependencies the build read, at the heads it read them", async () => {
    const t = setupDeps();
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush();
    await t.timers.advance(0);
    expect(t.mgr.fixPoint("o")).toEqual({ heads: t.source.heads(), deps: { [t.hull.url]: t.hull.heads() } });
  });

  it("fixPoint fixes a keyed dependency at its current heads while its key is the one built from", async () => {
    const t = setupDeps();
    t.impl.fingerprintDependency = (url, doc) => `len:${doc.length}`;
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush();
    await t.timers.advance(0);
    expect(t.render.doc().result?.builtFrom.deps).toEqual({ [t.hull.url]: ["fp:len:10"] });
    const at = t.mgr.fixPoint("o");
    expect(at.deps).toEqual({ [t.hull.url]: t.hull.heads() });
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url, at });
    t.hull.change((d) => (d.length = 20));
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1); // still fresh: the view keys as len:10
    expect(t.states.at(-1).state).toEqual({ state: "fresh" });
  });
});
