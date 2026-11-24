// A render's result is one value under one key (README.md, "Content"), so
// two builds written without seeing each other merge to one writer's whole
// result, never a mix of the two. Checked on real Automerge docs, each written
// by runBuild as a peer writes it, merged both ways, with each actor order.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as Automerge from "@automerge/automerge";
import { runBuild } from "./build.js";
import { newRenderDoc } from "../datatype.js";
import { encodeGLB } from "../glb.js";

/** A handle on a local Automerge doc: what runBuild reads and writes. */
function handle(doc) {
  const h = { doc: () => h.am, change: (fn) => (h.am = Automerge.change(h.am, fn)), am: doc };
  return h;
}
const source = (heads) => ({ url: "automerge:src", doc: () => ({ size: heads[0] }), heads: () => heads });
const repo = () => {
  let n = 0;
  return { create2: async () => ({ url: `automerge:glb-${++n}-${Math.random().toString(36).slice(2, 6)}` }) };
};
const glb = (z) => encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, z] }] });
const provider = (z, bounds) => ({ id: "p", params: [], module: { build: async () => ({ kind: "glb", glb: glb(z), meta: bounds ? { bounds } : undefined }) } });

beforeAll(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterAll(() => vi.restoreAllMocks());

describe("a render's result under a merge", () => {
  it("two results written without seeing each other merge, either way round and with either actor first, to one writer's whole result", async () => {
    const winners = new Set();
    for (const [first, second] of [["aa", "bb"], ["bb", "aa"]]) {
      // the render as both peers have it: built once (its GLB is glb(0))
      let base = Automerge.from(newRenderDoc({ title: "Thing", parent: "automerge:src", providerId: "p", params: {} }), { actor: "00".repeat(16) });
      const seeded = handle(base);
      await runBuild({ repo: repo(), renderHandle: seeded, sourceHandle: source(["h0"]), provider: provider(0), signal: new AbortController().signal, now: () => 1 });
      base = seeded.am;
      const a = handle(Automerge.clone(base, { actor: first.repeat(16) }));
      const b = handle(Automerge.clone(base, { actor: second.repeat(16) }));
      // a's bytes are the GLB it has (so it keeps that file doc), from newer inputs; b's are new bytes with bounds
      const ra = await runBuild({ repo: repo(), renderHandle: a, sourceHandle: source(["h2"]), provider: provider(0), signal: new AbortController().signal, now: () => 2 });
      const rb = await runBuild({ repo: repo(), renderHandle: b, sourceHandle: source(["h1"]), provider: provider(1, { min: [0, 0, 0], max: [1, 1, 1] }), signal: new AbortController().signal, now: () => 3 });
      expect([ra.ok, ra.reused, rb.ok, rb.reused]).toEqual([true, true, true, false]);
      const written = [a.am.result, b.am.result].map((r) => JSON.parse(JSON.stringify(r)));
      const ab = Automerge.merge(Automerge.clone(a.am), Automerge.clone(b.am));
      const ba = Automerge.merge(Automerge.clone(b.am), Automerge.clone(a.am));
      const merged = JSON.parse(JSON.stringify(ab.result));
      expect(JSON.parse(JSON.stringify(ba.result))).toEqual(merged);
      expect(written).toContainEqual(merged);
      expect(ab.failure).toBeNull();
      winners.add(merged.builtFrom.heads[0]);
    }
    // which one wins follows the actors, not the order the writes were made in
    expect([...winners].sort()).toEqual(["h1", "h2"]);
  });

  it("a failure written beside a result that crossed it stays with its own inputs", async () => {
    const base = Automerge.from(newRenderDoc({ title: "Thing", parent: "automerge:src", providerId: "p", params: {} }), { actor: "00".repeat(16) });
    const a = handle(Automerge.clone(base, { actor: "aa".repeat(16) }));
    const b = handle(Automerge.clone(base, { actor: "bb".repeat(16) }));
    await runBuild({ repo: repo(), renderHandle: a, sourceHandle: source(["h1"]), provider: provider(0), signal: new AbortController().signal, now: () => 2, inputs: "k1" });
    const broken = { id: "p", params: [], module: { build: async () => Promise.reject(new Error("it breaks")) } };
    await runBuild({ repo: repo(), renderHandle: b, sourceHandle: source(["h1"]), provider: broken, signal: new AbortController().signal, now: () => 3, inputs: "k2" });
    for (const m of [Automerge.merge(Automerge.clone(a.am), b.am), Automerge.merge(Automerge.clone(b.am), a.am)]) {
      expect(JSON.parse(JSON.stringify(m.result))).toEqual(JSON.parse(JSON.stringify(a.am.result)));
      expect(JSON.parse(JSON.stringify(m.failure))).toEqual({ error: "it breaks", inputs: "k2" });
    }
  });
});
