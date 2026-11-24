// What a render manager tells the host it shows (./stage/announce.js), and a
// render doc pinned from outside (a history checkpoint) shown, never rebuilt.
//
// Announcing: a live object's source and render are announced while it's
// tracked, a fixed object's aren't (it keeps its own version), and every
// announcement is retracted — whatever the order of track, fix, let go and
// untrack. The dependency watcher does the same for what a build reads.
// Checked over every sequence of up to four steps on one object.

import { describe, expect, it, vi } from "vitest";
import { FakeRepo } from "../test/fake-repo.js";
import { manualTime } from "../stage/time.js";
import { createRenderManager } from "./render-manager.js";
import { createDependencyWatcher } from "./deps.js";
import { newRenderDoc } from "../datatype.js";
import { encodeGLB } from "../glb.js";

/** An announcer that keeps counts, as ./stage/announce.js does, and checks it is never released below zero. */
function counter() {
  const counts = new Map();
  return {
    hold(url) {
      counts.set(url, (counts.get(url) ?? 0) + 1);
    },
    release(url) {
      const n = counts.get(url) ?? 0;
      if (n <= 0) throw new Error(`released ${url} more than it was held`);
      if (n === 1) counts.delete(url);
      else counts.set(url, n - 1);
    },
    held: () => [...counts.keys()].sort(),
    counts,
  };
}

function setup({ announce = counter() } = {}) {
  const repo = new FakeRepo();
  const time = manualTime({ frameMs: 50, yieldTo: () => new Promise((r) => setImmediate(r)) });
  const timers = { advance: (ms) => time.advance(Math.max(1, ms)) };
  const source = repo.add({ "@patchwork": { type: "thing" }, title: "Thing", size: 1 });
  const render = repo.add(newRenderDoc({ title: "Thing", parent: source.url, providerId: "thing", params: { size: 1 } }));
  const impl = { build: vi.fn(async () => ({ kind: "glb", glb: encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }] }), meta: {} })) };
  const provider = { id: "thing", name: "Thing", params: [{ key: "size", kind: "number", default: 1, cost: "cheap" }], module: impl };
  const mgr = createRenderManager({
    repo,
    loadProvider: async (id) => (id === "thing" ? provider : null),
    onState: () => {},
    onGLB: () => {},
    time,
    announce,
  });
  return { repo, timers, source, render, impl, mgr, announce };
}

const STEPS = ["live", "fixed", "untrack", "dispose"];
function* sequences(n) {
  if (n === 0) return yield [];
  for (const rest of sequences(n - 1)) for (const s of STEPS) yield [...rest, s];
}

describe("render manager announcing", () => {
  it("holds a tracked live object's source and render, and nothing else, after every sequence", async () => {
    for (let n = 0; n <= 4; n++)
      for (const seq of sequences(n)) {
        const t = setup();
        const at = { heads: t.source.heads() };
        // the model: is the object tracked, and is it fixed
        let tracked = false;
        let fixed = false;
        let disposed = false;
        for (const step of seq) {
          if (disposed) break;
          if (step === "live" || step === "fixed") {
            await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, at: step === "fixed" ? at : null });
            tracked = true;
            fixed = step === "fixed";
          } else if (step === "untrack") {
            t.mgr.untrack("o1");
            tracked = false;
          } else {
            t.mgr.dispose();
            tracked = false;
            disposed = true;
          }
          const want = tracked && !fixed ? [t.source.url, t.render.url].sort() : [];
          expect(t.announce.held(), JSON.stringify(seq)).toEqual(want);
        }
      }
  });

  it("builds nothing into a render doc that refuses writes, and builds once it takes them again", async () => {
    const t = setup();
    // pinned from outside, as at a history checkpoint: the handle says so
    let pinned = true;
    t.render.isReadOnly = () => pinned;
    const before = JSON.stringify(t.render.doc());
    await t.mgr.track("o1", { sourceUrl: t.source.url, renderUrl: t.render.url, createdHere: true });
    await t.timers.advance(0);
    t.source.change((d) => (d.size = 2));
    await t.timers.advance(10_000);
    expect(t.impl.build).not.toHaveBeenCalled();
    expect(JSON.stringify(t.render.doc())).toBe(before);
    // back to the present: the next change is built as usual
    pinned = false;
    t.source.change((d) => (d.size = 3));
    await t.timers.advance(10_000);
    expect(t.impl.build).toHaveBeenCalled();
  });
});

describe("dependency watcher announcing", () => {
  it("holds the live dependencies it watches, not the fixed ones, and retracts all", async () => {
    const repo = new FakeRepo();
    const a = repo.add({ x: 1 });
    const b = repo.add({ x: 2 });
    const fixedUrls = new Set();
    const announce = counter();
    const w = createDependencyWatcher({ repo, time: manualTime(), onChange: () => {}, fixedHeadsOf: (url) => (fixedUrls.has(url) ? repo.handles[url]?.heads?.() ?? ["h"] : null), announce });
    w.set([a.url, b.url]);
    expect(announce.held()).toEqual([a.url, b.url].sort());
    // b fixed at a version: it keeps its own, so is no longer announced
    fixedUrls.add(b.url);
    w.reannounce();
    expect(announce.held()).toEqual([a.url]);
    // and let go again
    fixedUrls.delete(b.url);
    w.reannounce();
    expect(announce.held()).toEqual([a.url, b.url].sort());
    // dropped from the list: retracted
    w.set([b.url]);
    expect(announce.held()).toEqual([b.url]);
    w.dispose();
    expect(announce.held()).toEqual([]);
    // a fixed dependency added later is never announced
    const w2 = createDependencyWatcher({ repo, time: manualTime(), onChange: () => {}, fixedHeadsOf: () => ["h"], announce });
    w2.set([a.url]);
    expect(announce.held()).toEqual([]);
    w2.dispose();
    expect(announce.held()).toEqual([]);
  });
});
