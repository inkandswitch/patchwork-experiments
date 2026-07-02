// The async inlet RACE (plan-2 §4): a url wire resolves through `api.find` — a real
// await — so a resolution launched under an OLD wiring can land after the user
// rewired, cut (null tombstone), unwired, or remounted, and must NOT clobber the
// newer backing. Guarded by per-inlet generation tickets (inletResolutionGate) for
// same-mount races + the mount token for remount/unmount. These tests drive the REAL
// EditorItem (happy-dom + a real in-memory repo + the real Solid projection) with a
// fake `api.find` backed by controllable deferreds — no timers, the tests decide who
// resolves when.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { makeDocumentProjection } from "solid-automerge";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { EditorItem, inletResolutionGate } from "./brush/items/editor-item.jsx";
import { Opstream } from "./opstreams.js";

const flush = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

// ── the gate itself (pure) ────────────────────────────────────────────────────

describe("inletResolutionGate — per-inlet generation tickets", () => {
  it("an unchanged wiring keeps its generation; a changed one bumps it", () => {
    const g = inletResolutionGate();
    const t1 = g.ticket("in", { url: "automerge:a", path: [] });
    // value-equal but RE-CREATED entry (a projection hands out fresh nodes) — no bump,
    // so a still-valid in-flight resolution survives an unrelated effect re-run
    const t2 = g.ticket("in", { url: "automerge:a", path: [] });
    expect(t2.gen).toBe(t1.gen);
    expect(g.shouldApply(t1, { url: "automerge:a", path: [] })).toBe(true);
    // a rewire bumps: the old ticket is dead, the new one lives
    const t3 = g.ticket("in", { url: "automerge:b", path: [] });
    expect(t3.gen).toBe(t1.gen + 1);
    expect(g.shouldApply(t1, { url: "automerge:b", path: [] })).toBe(false);
    expect(g.shouldApply(t3, { url: "automerge:b", path: [] })).toBe(true);
  });

  it("null (explicitly cut) and undefined (never wired) are DISTINCT states", () => {
    const g = inletResolutionGate();
    const t = g.ticket("in", undefined);
    expect(g.shouldApply(t, undefined)).toBe(true);
    expect(g.shouldApply(t, null)).toBe(false); // a tombstone landed since launch
    const tCut = g.ticket("in", null); // the pass that sees the tombstone bumps the gen
    expect(tCut.gen).toBe(t.gen + 1);
    expect(g.shouldApply(t, undefined)).toBe(false); // even a revert can't revive the old launch
    expect(g.shouldApply(tCut, null)).toBe(true);
    expect(g.shouldApply(tCut, undefined)).toBe(false);
  });

  it("a stale ticket loses even when the wiring reverts to its value (A→B→A)", () => {
    const g = inletResolutionGate();
    const wireA = { url: "automerge:a", path: [] };
    const tA1 = g.ticket("in", wireA);
    g.ticket("in", { url: "automerge:b", path: [] });
    const tA2 = g.ticket("in", { url: "automerge:a", path: [] });
    // only the LATEST launch for A may apply — the original is generation-stale
    expect(g.shouldApply(tA1, wireA)).toBe(false);
    expect(g.shouldApply(tA2, wireA)).toBe(true);
  });

  it("generations are per-inlet — bumping one leaves the others' tickets valid", () => {
    const g = inletResolutionGate();
    const tIn = g.ticket("in", { url: "automerge:a", path: [] });
    g.ticket("other", null);
    g.ticket("other", { node: "n1", outlet: "o" });
    expect(g.shouldApply(tIn, { url: "automerge:a", path: [] })).toBe(true);
  });
});

// ── the real component under a controllable api.find ─────────────────────────

// every mount of a race editor pushes its inlet proxies here (cleared per test)
const mountLog = [];
registerPlugins([
  { type: "sketchy:window", id: "race-ed", name: "Race", inlets: [{ name: "in", type: "json" }], outlets: [], load: async () => (args) => { mountLog.push(args.inlets); return () => {}; } },
  { type: "sketchy:window", id: "race-ed-2", name: "Race 2", inlets: [{ name: "in", type: "json" }], outlets: [], load: async () => (args) => { mountLog.push(args.inlets); return () => {}; } },
]);

const mounted = [];
async function mountItem(inlets, editorId = "race-ed") {
  const repo = new Repo({});
  const layout = repo.create({ items: [{ id: "e1", kind: "editor", editorId, x: 0, y: 0, w: 120, h: 80, inlets }] });
  const finds = []; // every api.find call: { url, resolve, reject } — the TEST resolves them
  const api = { find: (url) => { const d = deferred(); finds.push({ url, ...d }); return d.promise; } };
  const ctx = { tool: () => "select", api, isSelected: () => false };
  const element = document.createElement("div");
  document.body.append(element);
  const dispose = render(() => {
    const proj = makeDocumentProjection(layout);
    return EditorItem({ it: () => proj.items[0], ctx, down: () => {}, baseStyle: () => ({}), surface: { handle: layout } });
  }, element);
  mounted.push({ element, dispose });
  await flush();
  return { layout, finds };
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
  mountLog.length = 0;
});

describe("EditorItem url-inlet races (controllable resolutions)", () => {
  it("rewire during resolution: B wins, the late A is dropped", async () => {
    const { layout, finds } = await mountItem({ in: { url: "automerge:aaa", path: [] } });
    expect(mountLog.length).toBe(1);
    const px = mountLog[0].in;
    expect(finds.map((f) => f.url)).toEqual(["automerge:aaa"]);
    expect(px.wired).toBe(false); // still resolving — the proxy is its own buffer

    // switch the wire to B while A's find is still in flight (no remount!)
    layout.change((d) => { d.items[0].inlets.in = { url: "automerge:bbb", path: [] }; });
    await flush();
    expect(mountLog.length).toBe(1);
    expect(finds.map((f) => f.url)).toEqual(["automerge:aaa", "automerge:bbb"]);

    // B resolves FIRST and lands
    finds[1].resolve(new Opstream("B-value"));
    await flush();
    expect(px.wired).toBe(true);
    expect(px.value).toBe("B-value");

    // A resolves LATE — its application is dropped silently
    finds[0].resolve(new Opstream("A-value"));
    await flush();
    expect(px.value).toBe("B-value");
    expect(px.wired).toBe(true);
  });

  it("unwire (null tombstone) during resolution: the resolution is dropped, the inlet stays cut", async () => {
    const { layout, finds } = await mountItem({ in: { url: "automerge:aaa", path: [] } });
    const px = mountLog[0].in;
    layout.change((d) => { d.items[0].inlets.in = null; });
    await flush();
    finds[0].resolve(new Opstream("A-value"));
    await flush();
    expect(px.wired).toBe(false);
    expect(px.value).toBeUndefined();
  });

  it("entry DELETED during resolution (undefined ≠ the launched wire): dropped too", async () => {
    const { layout, finds } = await mountItem({ in: { url: "automerge:aaa", path: [] } });
    const px = mountLog[0].in;
    layout.change((d) => { delete d.items[0].inlets.in; });
    await flush();
    finds[0].resolve(new Opstream("A-value"));
    await flush();
    expect(px.wired).toBe(false);
    expect(px.value).toBeUndefined();
  });

  it("remount during resolution: the stale landing never touches the old proxies; the new mount resolves fresh", async () => {
    const { layout, finds } = await mountItem({ in: { url: "automerge:aaa", path: [] } });
    const first = mountLog[0].in;
    // switching the editor remounts (new token, new proxies)
    layout.change((d) => { d.items[0].editorId = "race-ed-2"; });
    await flush();
    expect(mountLog.length).toBe(2);
    const second = mountLog[1].in;
    expect(finds.length).toBe(2); // the new mount launched its own find for the same wire

    // the OLD mount's resolution lands — dropped by the mount token
    finds[0].resolve(new Opstream("stale"));
    await flush();
    expect(first.wired).toBe(false);
    expect(second.wired).toBe(false);

    // the NEW mount's own resolution still lands normally
    finds[1].resolve(new Opstream("fresh"));
    await flush();
    expect(second.wired).toBe(true);
    expect(second.value).toBe("fresh");
  });

  it("unmount during resolution: dropped (nothing applied, nothing thrown)", async () => {
    const { finds } = await mountItem({ in: { url: "automerge:aaa", path: [] } });
    const px = mountLog[0].in;
    const m = mounted.pop();
    m.dispose(); m.element.remove();
    finds[0].resolve(new Opstream("A-value"));
    await flush();
    expect(px.wired).toBe(false);
  });

  it("a url splat landing reads the wiring persisted at LANDING time: cut inlets are skipped, never-wired ones are fed", async () => {
    const { layout, finds } = await mountItem({ "*": { url: "automerge:splat", path: [] } });
    const px = mountLog[0].in;
    // cut `in` while the splat's find is in flight
    layout.change((d) => { d.items[0].inlets.in = null; });
    await flush();
    // the wiring pass re-ran, relaunching the (unchanged) splat — resolve every launch
    const obj = new Opstream({ in: "from-splat" });
    for (const f of finds) f.resolve(obj);
    await flush();
    expect(px.wired).toBe(false); // the tombstone wins — the splat must not re-feed a cut inlet
    expect(px.value).toBeUndefined();

    // …but a never-wired inlet does get fed once the tombstone is gone… (fresh mount)
    const fresh = await mountItem({ "*": { url: "automerge:splat", path: [] } });
    const px2 = mountLog.at(-1).in;
    fresh.finds[0].resolve(new Opstream({ in: "from-splat" }));
    await flush();
    expect(px2.wired).toBe(true);
    expect(px2.value).toBe("from-splat");
  });

  it("rewiring the splat during resolution drops the old splat's landing", async () => {
    const { layout, finds } = await mountItem({ "*": { url: "automerge:s1", path: [] } });
    const px = mountLog[0].in;
    layout.change((d) => { d.items[0].inlets["*"] = { url: "automerge:s2", path: [] }; });
    await flush();
    expect(finds.map((f) => f.url)).toEqual(["automerge:s1", "automerge:s2"]);

    finds[1].resolve(new Opstream({ in: "s2" }));
    await flush();
    expect(px.value).toBe("s2");

    finds[0].resolve(new Opstream({ in: "s1" }));
    await flush();
    expect(px.value).toBe("s2"); // the stale splat lost
  });
});
