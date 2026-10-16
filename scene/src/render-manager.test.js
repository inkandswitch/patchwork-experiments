import { describe, it, expect, vi } from "vitest";
import { FakeRepo, fakeTimers, flush } from "./test/fake-repo.js";
import { createRenderManager, DEP_WAIT_MS, PEER_STAGGER_MS, RETRY_BACKOFF_MS } from "./render-manager.js";
import { newRenderDoc } from "./datatype.js";
import { encodeGLB } from "./glb.js";
import { runBuild } from "./build.js";

const tinyGLB = (z = 0) => encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, z] }] });

function setup({ params = [{ key: "size", kind: "number", default: 1, cost: "cheap" }], build, fingerprint, pinned = false, peerId } = {}) {
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
  });
  return { repo, timers, source, render, impl, provider, mgr, states, glbs };
}

describe("render manager", () => {
  it("builds immediately when never built, stores a new GLB file doc, and loads it", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    const r = t.render.doc();
    expect(r.status).toBe("idle");
    expect(r.glbUrl).toBe(t.repo.created[0].url);
    expect(r.builtFrom.heads).toEqual(t.source.heads());
    expect(r.builtFrom.paramsKey).toBe('{"size":1}');
    const file = t.repo.created[0].doc();
    expect(file).toMatchObject({ "@patchwork": { type: "file" }, name: "Thing.glb", extension: "glb", mimeType: "model/gltf-binary" });
    expect(file.content).toBeInstanceOf(Uint8Array);
    expect(t.glbs).toEqual([r.glbUrl]);
    expect(t.states.at(-1)).toMatchObject({ phase: "ready", stale: false, building: false, notes: "ok" });
  });

  it("never writes the source doc", async () => {
    const t = setup();
    const before = t.source.heads();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(1000);
    expect(t.source.heads()).toEqual(before);
  });

  it("debounces cheap param edits at 150ms and repoints glbUrl", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    const firstGlb = t.render.doc().glbUrl;
    t.render.change((d) => (d.params.size = 2));
    t.render.change((d) => (d.params.size = 3));
    expect(t.timers.pendingDelays()).toEqual([150]);
    await t.timers.advance(149);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    await t.timers.advance(1);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.impl.build.mock.calls[1][0].params).toEqual({ size: 3 });
    expect(t.render.doc().glbUrl).not.toBe(firstGlb);
    expect(t.repo.created.length).toBe(2); // old GLB orphaned, not rewritten
  });

  it("debounces source edits as expensive by default", async () => {
    const t = setup({ params: [{ key: "size", kind: "number", default: 1 }] });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.source.change((d) => (d.size = 5));
    expect(t.timers.pendingDelays()).toEqual([800]);
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
    expect(t.render.doc().builtFrom.fingerprint).toBe("9");
  });

  it("does not auto-rebuild when pinned, but rebuild() forces it", async () => {
    const t = setup({ pinned: true });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(5000);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(t.states.at(-1)).toMatchObject({ stale: true, pinned: true });
    t.mgr.rebuild("o1");
    await flush();
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().builtFrom).not.toBeNull();
  });

  it("records errors and does not retry the same inputs at once", async () => {
    const t = setup({ build: async () => { throw new Error("boom"); } });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(4000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc()).toMatchObject({ status: "error", error: "boom", glbUrl: null });
    t.render.change((d) => (d.params.size = 4));
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(2); // new inputs → one more try
  });

  it("retries a failed build with backoff, then gives up until the inputs change", async () => {
    let fail = true;
    const t = setup({ build: async () => { if (fail) throw new Error("flaky"); return { kind: "glb", glb: tinyGLB() }; } });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.mgr.state("o1").retryAt).toBeGreaterThan(t.timers.now());
    for (const wait of RETRY_BACKOFF_MS) await t.timers.advance(wait + 900);
    expect(t.impl.build).toHaveBeenCalledTimes(1 + RETRY_BACKOFF_MS.length);
    await t.timers.advance(10 * 60_000);
    expect(t.impl.build).toHaveBeenCalledTimes(1 + RETRY_BACKOFF_MS.length); // out of retries
    fail = false;
    t.render.change((d) => (d.params.size = 2));
    await t.timers.advance(1000);
    expect(t.render.doc()).toMatchObject({ status: "idle", error: null });
    expect(t.mgr.state("o1").retryAt).toBeNull();
  });

  it("a transient failure recovers on the first retry", async () => {
    let calls = 0;
    const t = setup({ build: async () => { if (calls++ === 0) throw new Error("cdn"); return { kind: "glb", glb: tinyGLB() }; } });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    await t.timers.advance(RETRY_BACKOFF_MS[0] + 900);
    expect(t.render.doc()).toMatchObject({ status: "idle", error: null });
    expect(t.render.doc().glbUrl).toBeTruthy();
  });

  it("rebuilds when the installed provider is newer than the build, never when it is older", async () => {
    const t = setup();
    t.provider.version = 2;
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.render.doc().builtFrom.providerVersion).toBe(2);
    t.mgr.dispose();

    // a peer still running version 1 leaves the newer build alone
    const older = createRenderManager({
      repo: t.repo, timers: t.timers, now: t.timers.now,
      loadProvider: async () => ({ ...t.provider, version: 1 }),
    });
    await older.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(older.state("o1")).toMatchObject({ stale: false });
    older.dispose();

    // version 3 rebuilds it once
    const newer = createRenderManager({
      repo: t.repo, timers: t.timers, now: t.timers.now,
      loadProvider: async () => ({ ...t.provider, version: 3 }),
    });
    await newer.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().builtFrom.providerVersion).toBe(3);
    newer.dispose();
  });

  it("keys a scene-render dependency by its glbUrl: status writes don't rebuild downstream", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const upstream = repo.add({ ...newRenderDoc({ title: "Hull", parent: "automerge:x", providerId: "hull", params: {} }), glbUrl: "automerge:glb1" });
    const source = repo.add({ "@patchwork": { type: "flow" }, body: upstream.url });
    const render = repo.add(newRenderDoc({ title: "Flow", parent: source.url, providerId: "flow", params: {} }));
    let n = 0;
    const impl = { build: vi.fn(async () => ({ kind: "glb", glb: tinyGLB(n++) })), dependencies: (doc) => [doc.body] };
    const mgr = createRenderManager({ repo, timers, now: timers.now, loadProvider: async () => ({ id: "flow", name: "Flow", params: [], module: impl }) });
    await mgr.track("o", { sourceUrl: source.url, renderUrl: render.url });
    for (let i = 0; i < 3; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(1);
    expect(render.doc().builtFrom.deps).toEqual({ [upstream.url]: ["fp:render:automerge:glb1"] });

    upstream.change((d) => (d.status = "building"));
    upstream.change((d) => (d.status = "idle"));
    for (let i = 0; i < 6; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(1);

    upstream.change((d) => (d.glbUrl = "automerge:glb2"));
    for (let i = 0; i < 6; i++) await timers.advance(1000);
    expect(impl.build).toHaveBeenCalledTimes(2);
    expect(render.doc().builtFrom.deps).toEqual({ [upstream.url]: ["fp:render:automerge:glb2"] });
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

  it("rebuilds after a build that raced with an edit", async () => {
    let release;
    const t = setup({
      build: vi.fn(() => new Promise((r) => (release = () => r({ kind: "glb", glb: tinyGLB() })))),
    });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.render.doc().status).toBe("building");
    t.render.change((d) => (d.params.size = 7)); // during the build
    release();
    await flush();
    expect(t.render.doc().builtFrom.paramsKey).toBe('{"size":1}');
    await t.timers.advance(150);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect(t.render.doc().builtFrom.paramsKey).toBe('{"size":7}');
  });

  it("waits for a peer that announced it is building the same inputs", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.render.emit("ephemeral-message", { message: { type: "scene-render:building", key: '{"size":2}|h:' + t.source.heads()[0] } });
    t.render.change((d) => (d.params.size = 2));
    expect(t.timers.pendingDelays()[0]).toBeGreaterThan(10_000);
  });

  it("staggers automatic rebuilds behind a builder it has heard with a lower peer id", async () => {
    const t = setup({ peerId: "peer-b" });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.render.emit("ephemeral-message", { senderId: "peer-a", message: { type: "scene-render:building", key: "something-else" } });
    t.render.change((d) => (d.params.size = 2));
    expect(t.timers.pendingDelays()).toEqual([150 + PEER_STAGGER_MS]);
  });

  it("does not stagger behind a builder with a higher peer id, nor a forced rebuild", async () => {
    const t = setup({ peerId: "peer-a" });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.render.emit("ephemeral-message", { senderId: "peer-b", message: { type: "scene-render:building", key: "something-else" } });
    t.render.change((d) => (d.params.size = 2));
    expect(t.timers.pendingDelays()).toEqual([150]);
  });

  it("an announcement that arrives during the debounce reschedules the pending build", async () => {
    const t = setup({ peerId: "peer-b" });
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.render.change((d) => (d.params.size = 2));
    expect(t.timers.pendingDelays()).toEqual([150]);
    t.render.emit("ephemeral-message", { senderId: "peer-a", message: { type: "scene-render:building", key: '{"size":2}|h:' + t.source.heads()[0] } });
    expect(t.timers.pendingDelays()[0]).toBeGreaterThan(10_000);
    await t.timers.advance(200);
    expect(t.impl.build).toHaveBeenCalledTimes(1); // only the initial build; the peer's is awaited
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
    expect(states.at(-1).phase).toBe("no-provider");
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
    expect(t.timers.pendingDelays()).toEqual([]);
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
    expect(render.doc().builtFrom.fingerprint).toMatch(/:2$/);
    // The peer that was overridden reports it, and a manual rebuild still works.
    const loser = [a, b].find((m) => m.state("o").stale);
    expect(loser.state("o")).toMatchObject({ stale: true, reason: "fingerprint", contested: true, olderHost: false });
    loser.rebuild("o");
    await flush();
    expect(repo.created.length - before).toBeLessThanOrEqual(3);
  });

  it("says when the build it won't fight came from a scene host older than dependencies", async () => {
    const repo = new FakeRepo();
    const timers = fakeTimers();
    const source = repo.add({ "@patchwork": { type: "hull" }, hull: 1 });
    const render = repo.add(newRenderDoc({ title: "Hull", parent: source.url, providerId: "p", params: {} }));
    const mgr = createRenderManager({
      repo,
      timers,
      now: timers.now,
      loadProvider: async () => ({ id: "p", name: "p", params: [], module: { fingerprint: (d) => `p/3:${d.hull}`, build: async () => ({ kind: "glb", glb: tinyGLB() }) } }),
    });
    await mgr.track("o", { sourceUrl: source.url, renderUrl: render.url });
    for (let i = 0; i < 5; i++) await timers.advance(1000);
    expect(render.doc().builtFrom.deps).toEqual({});
    // an old host (provider v2) builds over it, recording no deps at all
    render.change((d) => {
      d.builtFrom = { heads: [...d.builtFrom.heads], fingerprint: "p/2:1", paramsKey: d.builtFrom.paramsKey };
    });
    for (let i = 0; i < 5; i++) await timers.advance(1000);
    expect(mgr.state("o")).toMatchObject({ stale: true, reason: "fingerprint", contested: true, olderHost: true });
    expect(render.doc().builtFrom.fingerprint).toBe("p/2:1"); // left alone: no ping-pong
    mgr.dispose();
  });

  it("a provider upgrade still rebuilds a render built by the old version", async () => {
    const t = setup({ fingerprint: (d) => `v2:${d.size}` });
    t.render.change((d) => (d.builtFrom = { heads: t.source.heads(), fingerprint: "v1:1", paramsKey: '{"size":1}' }));
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(1000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().builtFrom.fingerprint).toBe("v2:1");
  });

  it("clears a stale error when an edit puts the source back to what was built", async () => {
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
    expect(t.render.doc()).toMatchObject({ status: "error", error: "syntax error" });
    t.source.change((d) => (d.size = 1));
    await t.timers.advance(0);
    expect(t.render.doc()).toMatchObject({ status: "idle", error: null });
    expect(t.impl.build).toHaveBeenCalledTimes(2); // no rebuild needed
    expect(t.states.at(-1)).toMatchObject({ status: "idle", stale: false });
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
    expect(t.render.doc().builtFrom.paramsKey).toBe('{"size":7}');
  });

  it("treats a 'building' status it finds on a new object as a peer's announcement", async () => {
    const t = setup();
    t.render.change((d) => (d.status = "building")); // a peer started before we subscribed
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    expect(t.impl.build).not.toHaveBeenCalled();
    // The peer finishes: nothing for us to do.
    t.render.change((d) => {
      d.builtFrom = { heads: t.source.heads(), fingerprint: null, paramsKey: '{"size":1}' };
      d.status = "idle";
    });
    await t.timers.advance(30_000);
    expect(t.impl.build).not.toHaveBeenCalled();
  });

  it("builds after the grace if the announced build never lands", async () => {
    const t = setup();
    t.render.change((d) => (d.status = "building"));
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(19_000);
    expect(t.impl.build).not.toHaveBeenCalled();
    await t.timers.advance(1_000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().status).toBe("idle");
  });

  it("resets a 'building' status left behind on an up-to-date render", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    t.render.change((d) => (d.status = "building")); // a peer's forced rebuild; then its tab closed
    await t.timers.advance(59_000);
    expect(t.render.doc().status).toBe("building");
    await t.timers.advance(1_000);
    expect(t.render.doc().status).toBe("idle");
    expect(t.impl.build).toHaveBeenCalledTimes(1);
  });

  it("retries loading a GLB file doc that wasn't available yet", async () => {
    const t = setup();
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(0);
    const url = "automerge:notsyncedyet";
    t.render.change((d) => (d.glbUrl = url)); // a peer's build, file doc not here yet
    await flush();
    expect(t.states.at(-1).glbError).toMatch(/Could not load GLB/);
    t.repo.add({ "@patchwork": { type: "file" }, extension: "glb", content: tinyGLB() }, url);
    await t.timers.advance(1_000);
    expect(t.glbs.at(-1)).toBe(url);
    expect(t.states.at(-1).glbError).toBeNull();
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
    expect(t.render.doc().builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
    expect(t.hull.listenerCount("change")).toBe(1);
    expect(t.states.at(-1)).toMatchObject({ stale: false, deps: [t.hull.url] });
  });

  it("rebuilds after a dependency edit, debounced like a source edit", async () => {
    const t = depSetup();
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    t.hull.change((d) => (d.length = 11));
    t.hull.change((d) => (d.length = 12));
    expect(t.states.at(-1)).toMatchObject({ stale: true, reason: "deps" });
    expect(t.timers.pendingDelays()).toEqual([800]);
    await t.timers.advance(799);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    await t.timers.advance(1);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().builtFrom.deps[t.hull.url]).toEqual(t.hull.heads());
    expect(t.states.at(-1).stale).toBe(false);
    expect(t.hull.heads()).toEqual(t.render.doc().builtFrom.deps[t.hull.url]); // never written
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
    await t.timers.advance(800);
    expect(Object.keys(t.render.doc().builtFrom.deps)).toEqual([t.other.url]);
    // edits to the old dependency no longer matter
    const builds = t.impl.build.mock.calls.length;
    t.hull.change((d) => (d.length = 99));
    await t.timers.advance(2000);
    expect(t.impl.build).toHaveBeenCalledTimes(builds);
    // unlinking drops the subscription and records no deps
    t.source.change((d) => (d.body = null));
    await t.timers.advance(800);
    expect(t.other.listenerCount("change")).toBe(0);
    expect(t.render.doc().builtFrom.deps).toEqual({});
  });

  it("rebuilds an old render (no deps recorded) once when its provider now reports some", async () => {
    const t = depSetup({ fingerprint: (d) => String(d.body) });
    t.render.change((d) => (d.builtFrom = { heads: t.source.heads(), fingerprint: String(t.source.doc().body), paramsKey: "{}" }));
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush();
    await t.timers.advance(1000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    await t.timers.advance(5000);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
  });

  it("an unloadable dependency doesn't block the build; it is retried and rebuilds when it arrives", async () => {
    const t = depSetup();
    const missing = "automerge:nothereyet";
    t.source.change((d) => (d.body = missing));
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await flush(); // dependency finds resolve
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().builtFrom.deps).toEqual({ [missing]: [] });
    expect(t.render.doc().status).toBe("idle");
    const late = t.repo.add({ "@patchwork": { type: "hull" }, length: 3 }, missing);
    await t.timers.advance(1000); // retry finds it
    expect(late.listenerCount("change")).toBe(1);
    await t.timers.advance(800);
    expect(t.impl.build).toHaveBeenCalledTimes(2);
    expect(t.render.doc().builtFrom.deps).toEqual({ [missing]: late.heads() });
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
    expect(t.timers.pendingDelays()).toEqual([DEP_WAIT_MS]);
    release();
    await flush();
    await t.timers.advance(0);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
  });

  it("gives up waiting after DEP_WAIT_MS", async () => {
    const repo = new FakeRepo();
    const t = depSetup({ repo });
    const find = repo.find.bind(repo);
    repo.find = (url) => (url === t.hull.url ? new Promise(() => {}) : find(url));
    t.impl.build.mockImplementation(async () => ({ kind: "glb", glb: tinyGLB() })); // doesn't wait for it either
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(DEP_WAIT_MS - 1);
    expect(t.impl.build).not.toHaveBeenCalled();
    await t.timers.advance(1);
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    expect(t.render.doc().builtFrom.deps).toEqual({ [t.hull.url]: [] });
  });

  it("doesn't flag a render stale just because its dependencies haven't loaded yet", async () => {
    const repo = new FakeRepo();
    const t = depSetup({ repo });
    t.render.change((d) => (d.builtFrom = { heads: t.source.heads(), fingerprint: null, paramsKey: "{}", deps: { [t.hull.url]: t.hull.heads() } }));
    let release;
    const gate = new Promise((r) => (release = r));
    const find = repo.find.bind(repo);
    repo.find = async (url) => {
      if (url === t.hull.url) await gate;
      return find(url);
    };
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    expect(t.states.at(-1)).toMatchObject({ phase: "ready", stale: false });
    release();
    await t.timers.advance(10_000);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(t.states.at(-1)).toMatchObject({ stale: false });
  });

  it("never rebuilds over a recorded dependency that is slow to load, however long it takes", async () => {
    const repo = new FakeRepo();
    const t = depSetup({ repo });
    t.render.change((d) => (d.builtFrom = { heads: t.source.heads(), fingerprint: null, paramsKey: "{}", deps: { [t.hull.url]: t.hull.heads() } }));
    let release;
    const gate = new Promise((r) => (release = r));
    const find = repo.find.bind(repo);
    repo.find = async (url) => {
      if (url === t.hull.url) await gate;
      return find(url);
    };
    await t.mgr.track("o", { sourceUrl: t.source.url, renderUrl: t.render.url });
    await t.timers.advance(DEP_WAIT_MS * 4);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(t.states.at(-1)).toMatchObject({ stale: false });
    release();
    await t.timers.advance(10_000);
    expect(t.impl.build).not.toHaveBeenCalled();
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
    await t.timers.advance(DEP_WAIT_MS); // gives up waiting; build() awaits the same find
    expect(t.impl.build).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(t.render.doc().builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
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
    expect(t.render.doc().builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
    expect(b.state("o")).toMatchObject({ stale: true, reason: "deps", depsUnavailable: [t.hull.url] });
    // a real edit to the hull is still picked up by the peer that can read it
    const before = t.repo.created.length;
    t.hull.change((d) => (d.length = 11));
    for (let i = 0; i < 60; i++) await t.timers.advance(1000);
    expect(t.repo.created.length - before).toBe(1);
    expect(t.render.doc().builtFrom.deps).toEqual({ [t.hull.url]: t.hull.heads() });
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
    const loser = [a, b].find((m) => m.state("o").stale);
    expect(loser.state("o")).toMatchObject({ reason: "deps", contested: true });
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
    expect(t.render.doc().builtFrom.deps).toEqual({});
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
    expect(t.timers.pendingDelays()).toEqual([]);
  });
});

describe("runBuild", () => {
  it("rejects a provider result that isn't a GLB", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ parent: source.url, providerId: "p" }));
    const res = await runBuild({
      repo,
      renderHandle: render,
      sourceHandle: source,
      provider: { id: "p", module: { build: async () => ({ kind: "glb", glb: new Uint8Array(8) }) } },
    });
    expect(res.ok).toBe(false);
    expect(render.doc().status).toBe("error");
    expect(repo.created).toEqual([]);
  });

  it("keeps a peer's result when the peer committed the same inputs while this build ran", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: { size: 1 } }));
    const theirGlb = "automerge:peerglb";
    const build = async () => {
      // Mid-build, a peer that started at the same moment lands its result for the same inputs.
      render.change((d) => {
        d.glbUrl = theirGlb;
        d.builtFrom = { heads: [...source.heads()], fingerprint: null, paramsKey: '{"size":1}' };
        d.status = "building"; // our own "building" write won the concurrent merge
      });
      return { kind: "glb", glb: tinyGLB() };
    };
    const res = await runBuild({ repo, renderHandle: render, sourceHandle: source, provider: { id: "p", params: [], module: { build } } });
    expect(res).toMatchObject({ ok: true, superseded: true, glbUrl: theirGlb });
    expect(repo.created).toEqual([]); // no orphan GLB doc
    expect(render.doc()).toMatchObject({ glbUrl: theirGlb, status: "idle", error: null });
  });

  it("still commits when a peer's concurrent result was built from different inputs", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: { size: 1 } }));
    const build = async () => {
      render.change((d) => {
        d.glbUrl = "automerge:older";
        d.builtFrom = { heads: ["someoldhead"], fingerprint: null, paramsKey: '{"size":1}' };
      });
      return { kind: "glb", glb: tinyGLB() };
    };
    const res = await runBuild({ repo, renderHandle: render, sourceHandle: source, provider: { id: "p", params: [], module: { build } } });
    expect(res.ok).toBe(true);
    expect(res.superseded).toBeUndefined();
    expect(repo.created).toHaveLength(1);
    expect(render.doc().glbUrl).toBe(repo.created[0].url);
  });

  it("a forced rebuild of an already-fresh render still builds, and makes a new GLB if the bytes differ", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: { size: 1 } }));
    let z = 0;
    const provider = { id: "p", params: [], module: { build: async () => ({ kind: "glb", glb: tinyGLB(z++) }) } };
    await runBuild({ repo, renderHandle: render, sourceHandle: source, provider });
    const first = render.doc().glbUrl;
    const res = await runBuild({ repo, renderHandle: render, sourceHandle: source, provider });
    expect(res.superseded).toBeUndefined();
    expect(res.reused).toBe(false);
    expect(repo.created).toHaveLength(2);
    expect(render.doc().glbUrl).not.toBe(first);
  });

  it("keeps the current GLB file doc when a rebuild produces the same bytes", async () => {
    const repo = new FakeRepo();
    const source = repo.add({ title: "s" });
    const render = repo.add(newRenderDoc({ title: "s", parent: source.url, providerId: "p", params: {} }));
    const provider = { id: "p", params: [], module: { build: async () => ({ kind: "glb", glb: tinyGLB() }) } };
    await runBuild({ repo, renderHandle: render, sourceHandle: source, provider });
    const first = render.doc().glbUrl;
    const hash = render.doc().builtFrom.glbHash;
    expect(hash).toMatch(/^(sha256|c53):/);
    source.change((d) => (d.title = "renamed"));
    const res = await runBuild({ repo, renderHandle: render, sourceHandle: source, provider });
    expect(res.reused).toBe(true);
    expect(repo.created).toHaveLength(1);
    expect(render.doc().glbUrl).toBe(first);
    expect(render.doc().builtFrom.heads).toEqual(source.heads());
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
    await runBuild({ repo, renderHandle: render, sourceHandle: source, provider: { id: "p", params, version: 3, module: { build } } });
    expect(build.mock.calls[0][0].params).toEqual({ n: 10, k: "a" });
    expect(render.doc().builtFrom.paramsKey).toBe('{"k":"nope","n":999}'); // the stored values, as written
    expect(render.doc().builtFrom.providerVersion).toBe(3);
    expect(render.doc().bounds).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
  });
});
