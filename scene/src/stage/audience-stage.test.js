// The audience and the veil through the mounted stage (STAGE.md, "Audience"
// and "Lenses"): policies merged whatever order they run in, a broken one
// closed, unknown while a listed package is missing whatever the viewer
// answered about it, and a veiled object loading nothing of its own.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { FakeRepo, fakeUrl } from "../test/fake-repo.js";
import { resetPackagesServed, servePackage } from "../test/filesystem-mock.js";
import { resetPackages } from "./packages.js";
import { veilKey } from "./veil.js";
import packagesPart from "../parts/packages.js";

let mounted = [];
const mount = async (o) => {
  const s = await mountStage(o);
  mounted.push(s);
  return s;
};
beforeEach(() => {
  localStorage.clear();
  resetPackages();
  resetPackagesServed();
});
afterEach(() => {
  for (const s of mounted) s.unmount();
  mounted = [];
});

const A = "viewer:a";
const B = "viewer:b";
// a policy as an extension: whatever its trait says for each object, by name
const policy = (id, extra = {}) => ({
  meta: { id, traits: [id], ...extra },
  module: { create: () => ({ audience: (scene) => (oid) => scene.objects[oid]?.traits?.[id] ?? null }) },
});
// something that asks: it records what it was told at every update
const asker = (log) => ({
  meta: { id: "t.asker", always: true },
  module: {
    create: (api) => ({
      update: () => log.push({ audience: api.audience("card"), shown: api.shown("card"), missing: api.local.get().packages.missing }),
    }),
  },
});
const card = (traits) => object({ name: "Card", traits });

describe("api.audience, mounted", () => {
  it("every running policy's answer, merged: shown to all, screened to one", async () => {
    const log = [];
    const s = await mount({ extensions: [policy("t.faceup"), policy("t.screen"), asker(log)], doc: { objects: { card: card({ "t.faceup": { show: "all" }, "t.screen": { only: [A] } }) }, order: ["card"] }, viewerId: A });
    await settle();
    const api = s.api("t.asker");
    expect(api.audience("card")).toEqual([A]);
    expect(api.shown("card")).toBe("all");
    // the screen goes: everyone
    s.change((d) => delete d.objects.card.traits["t.screen"]);
    await settle();
    expect(api.audience("card")).toBe("all");
    expect(log.at(-1)).toMatchObject({ audience: "all", shown: "all", missing: false });
    // nothing shows it: nobody; an object that isn't there: nobody
    s.change((d) => delete d.objects.card.traits["t.faceup"]);
    await settle();
    expect(api.audience("card")).toEqual([]);
    expect(api.audience("gone")).toEqual([]);
  });

  it("is the same whichever order the policies were registered in", async () => {
    const doc = { objects: { card: card({ "t.p": { show: [A, B] }, "t.q": { only: [B] }, "t.r": { show: "all", only: [A, B] } }) }, order: ["card"] };
    const seen = [];
    for (const order of [["t.p", "t.q", "t.r"], ["t.r", "t.q", "t.p"], ["t.q", "t.r", "t.p"]]) {
      const s = await mount({ extensions: [...order.map((id) => policy(id)), asker([])], doc, viewerId: A });
      await settle();
      seen.push([s.api("t.asker").audience("card"), s.api("t.asker").shown("card")]);
    }
    expect(seen).toEqual([[[B], "all"], [[B], "all"], [[B], "all"]]);
  });

  it("a policy that throws is read as nobody: it hides, it never reveals", async () => {
    const broken = { meta: { id: "t.broken", always: true }, module: { create: () => ({ audience: () => () => { throw new Error("boom"); } }) } };
    const worse = { meta: { id: "t.worse", always: true }, module: { create: () => ({ audience: () => { throw new Error("bang"); } }) } };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of [broken, worse]) {
      const s = await mount({ extensions: [policy("t.faceup"), bad, asker([])], doc: { objects: { card: card({ "t.faceup": { show: "all" } }) }, order: ["card"] }, viewerId: A });
      await settle();
      expect(s.api("t.asker").audience("card")).toEqual([]);
      expect(s.api("t.asker").shown("card")).toBe("all");
    }
  });

  it("asks each policy once per snapshot, with the snapshot (pure in the doc)", async () => {
    let calls = 0;
    const counted = { meta: { id: "t.counted", always: true }, module: { create: () => ({ audience: (scene) => (calls++, (oid) => (scene.objects[oid] ? { show: "all" } : null)) }) } };
    const s = await mount({ extensions: [counted, asker([])], doc: { objects: { card: card({}) }, order: ["card"] }, viewerId: A });
    await settle();
    const api = s.api("t.asker");
    const before = calls;
    for (let i = 0; i < 5; i++) api.audience("card");
    expect(calls - before).toBeLessThanOrEqual(1);
    const n = calls;
    s.change((d) => (d.objects.card.name = "Renamed"));
    await settle();
    api.audience("card");
    expect(calls).toBeGreaterThan(n);
  });
});

describe("unknown while a listed package is missing", () => {
  let repo, SCREEN;
  const screenPackage = () => ({ plugins: [{ type: "scene:extension", id: "t.screen", name: "Screen", traits: ["t.screen"], load: async () => policy("t.screen").module }] });
  const PROMPT = { meta: { id: "scene.packages" }, module: packagesPart };
  const doc = () => ({ objects: { card: card({ "t.faceup": { show: "all" }, "t.screen": { only: [B] } }) }, order: ["card"], packages: [{ url: SCREEN }] });

  beforeEach(() => {
    repo = new FakeRepo();
    // a package folder, as pushwork lays one out
    const pj = repo.add({ "@patchwork": { type: "file" }, name: "package.json", content: JSON.stringify({ name: "@tiny/screen" }) });
    SCREEN = repo.add({ title: "@tiny/screen", docs: [{ name: "package.json", type: "file", url: pj.url }] }, fakeUrl()).url;
    servePackage(SCREEN, screenPackage());
  });

  it("asked about, failed or loading: null either way; known once it has loaded, and everyone is told", async () => {
    const log = [];
    const s = await mount({ extensions: [policy("t.faceup"), asker(log), PROMPT], repo, doc: doc(), viewerId: A });
    await until(() => s.local.get().packages.ask.length === 1);
    const api = s.api("t.asker");
    // without the screen's `only` the card would be everyone's: it must not be answered at all
    expect(api.audience("card")).toBeNull();
    expect(api.shown("card")).toBeNull();
    expect(s.local.get().packages.missing).toBe(true);
    // a load that fails: still unknown
    servePackage(SCREEN, new Error("the chunk was missing"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await s.debug.packages.load([SCREEN]);
    await settle();
    expect(api.audience("card")).toBeNull();
    // it loads: the screen's `only` is in the answer from the first moment there is one
    servePackage(SCREEN, screenPackage());
    const n = log.length;
    await s.debug.packages.load([SCREEN]);
    await until(() => s.local.get().running.some((r) => r.id === "t.screen"));
    await settle();
    expect(api.audience("card")).toEqual([B]);
    expect(s.local.get().packages.missing).toBe(false);
    const after = log.slice(n);
    expect(after.at(-1)).toEqual({ audience: [B], shown: "all", missing: false });
    // never, at any update, the answer the missing screen would have enlarged
    expect(log.every((e) => e.audience === null || JSON.stringify(e.audience) === JSON.stringify([B]))).toBe(true);
  });

  it('"Not now": asked no more in this view, and unknown for as long as it stays that way', async () => {
    const s = await mount({ extensions: [policy("t.faceup"), asker([]), PROMPT], repo, doc: doc(), viewerId: A });
    await until(() => s.local.get().packages.ask.length === 1);
    s.api("t.asker").packages.dismiss();
    await settle();
    expect(s.local.get().packages).toMatchObject({ ask: [], loading: [], failed: [], missing: true });
    expect(s.api("t.asker").audience("card")).toBeNull();
    expect(s.api("t.asker").shown("card")).toBeNull();
  });

  it("before the registry has settled, when nothing is offered yet: unknown already", async () => {
    const s = await mount({ extensions: [policy("t.faceup"), asker([])], repo, doc: doc(), viewerId: A, packageSettleMs: 60_000 });
    await settle();
    expect(s.local.get().packages.ask).toEqual([]);
    expect(s.api("t.asker").audience("card")).toBeNull();
  });

  it("a package listed in the very change that brings its trait is counted at once", async () => {
    const s = await mount({ extensions: [policy("t.faceup"), asker([])], repo, doc: { objects: { card: card({ "t.faceup": { show: "all" } }) }, order: ["card"] }, viewerId: A });
    await settle();
    const api = s.api("t.asker");
    expect(api.audience("card")).toBe("all");
    s.change((d) => {
      d.objects.card.traits["t.screen"] = { only: [B] };
      d.packages.push({ url: SCREEN });
    });
    // no settling: the doc as it is now
    expect(api.audience("card")).toBeNull();
  });
});

describe("the veil", () => {
  const HINT = { bounds: { min: [-0.028, 0, -0.0435], max: [0.028, 0.0012, 0.0435] } };
  const lens = (state) => ({ meta: { id: "t.lens", always: true }, module: { create: (api) => ((state.api = api), { looks: () => state.looks }) } });

  it("a veiled object loads nothing of its own, is drawn from its hint, and loads again when the veil goes", async () => {
    const repo = new FakeRepo();
    const back = repo.add({ "@patchwork": { type: "file" }, name: "back.glb", content: new Uint8Array([1, 2, 3]) });
    const state = { looks: new Map([["card", { veil: true }]]) };
    const s = await mount({ extensions: [lens(state)], repo, doc: { objects: { card: object({ name: "Card", sourceUrl: back.url, hint: HINT }) }, order: ["card"] } });
    await settle();
    expect(s.debug.looks().get("card")).toEqual({ veil: true });
    expect(s.debug.veils().get("card")).toBe(veilKey(HINT.bounds));
    expect(s.debug.queue.has("card")).toBe(false);
    // its name is its own: a veil carries none
    expect(state.api.nameOf("card")).toBe("Card");
    // the doc was never written (no file, no asset)
    expect(Object.keys(s.doc().assets ?? {})).toEqual([]);
    // the veil goes: its own source is asked for
    state.looks = new Map();
    state.api.schedule(() => {});
    await settle();
    expect(s.debug.veils().has("card")).toBe(false);
    expect(s.debug.queue.state("card")?.url).toBe(back.url);
    // and comes back: forgotten again
    state.looks = new Map([["card", { veil: true }]]);
    state.api.schedule(() => {});
    await settle();
    expect(s.debug.queue.has("card")).toBe(false);
    expect(s.debug.veils().has("card")).toBe(true);
  });

  it("a later lens's `veil: false` lifts it; a veil beats a source in the same look", async () => {
    const state = { looks: new Map([["card", { veil: true, sourceUrl: "automerge:2Facexxxxabcdefghijkmnopqr" }]]) };
    const lift = { meta: { id: "t.lift", always: true }, module: { create: () => ({ looks: () => state.lift ?? null }) } };
    const s = await mount({ extensions: [lens(state), lift], doc: { objects: { card: object({ name: "Card", hint: HINT }) }, order: ["card"] } });
    await settle();
    expect(s.debug.veils().has("card")).toBe(true);
    expect(s.debug.queue.has("card")).toBe(false);
    state.lift = new Map([["card", { veil: false }]]);
    state.api.schedule(() => {});
    await settle();
    expect(s.debug.veils().has("card")).toBe(false);
    expect(s.debug.queue.state("card")?.url).toBe("automerge:2Facexxxxabcdefghijkmnopqr");
  });

  it("with no hint to go by, it is still drawn (a default box), never the thing itself", async () => {
    const state = { looks: new Map([["card", { veil: true }]]) };
    const s = await mount({ extensions: [lens(state)], doc: { objects: { card: object({ name: "Card", sourceUrl: "automerge:2Backxxxxabcdefghijkmnopqr" }) }, order: ["card"] } });
    await settle();
    expect(s.debug.veils().has("card")).toBe(true);
    expect(s.debug.queue.has("card")).toBe(false);
  });
});
