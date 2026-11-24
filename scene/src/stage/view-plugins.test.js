// @vitest-environment happy-dom
// View plugins (API.md, "View plugins"): one per view, for the view's whole
// life, whatever the focus. api.focus() is the focus stage's api for it:
// what it acquires through that goes when the focus leaves.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK, linkOpener } from "../test/links.js";
import { keyOf } from "./paths.js";

// a stage's service whose holds are its caller's: a caller whose signal has gone holds nothing
const HOLDS = {
  meta: { id: "t.holds", provides: ["holds"] },
  module: { create: () => ({ provides: { holds: (caller) => ({ hold: () => !caller.signal.aborted, release() {} }) } }) },
};

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

/** A host A (a table, and L: a live link to B) and one view plugin, which counts its starts and stops. */
async function mountHost({ time = null, create = () => ({}) } = {}) {
  const repo = new FakeRepo();
  const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }) }, order: ["card"] }));
  const counts = { creates: 0, disposes: 0 };
  const plugin = {
    meta: { id: "t.view", type: "scene:view" },
    module: {
      create: (api) => (counts.creates++, { commands: [{ id: "c", name: "C", run() {} }], ...create(api), dispose: () => counts.disposes++ }),
    },
  };
  const objects = { table: object({ name: "Table" }), L: object({ name: "B", sourceUrl: b.url, providerId: LINK, renderUrl: null }) };
  s = await mountStage({ repo, time, extensions: [plugin, HOLDS, linkOpener()], doc: { title: "A", objects, order: Object.keys(objects) } });
  const view = s.debug.view;
  await until(() => view.stageAt(["L"]) && s.instance("t.view"), 2000);
  return { view, counts, api: s.api("t.view") };
}

describe("view plugins", () => {
  // Over every sequence of up to four events (the focus in at A, out to B, a
  // hold taken through A's facet, let go): 341 sequences, on one view. After
  // every event: the plugin started once and never stopped; A's facet lives
  // until the focus leaves A, held or not, and coming back makes a new one;
  // the view offers the plugin's command once, from the focus, and A's
  // reader never does.
  it("over every order of ≤4 of in, out, busy and idle: started once, never stopped; a facet lives until the focus leaves", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const EVENTS = ["in", "out", "busy", "idle"];
    const seqs = [[]];
    for (let n = 1; n <= 4; n++) for (const s0 of seqs.filter((q) => q.length === n - 1)) for (const e of EVENTS) seqs.push([...s0, e]);
    expect(seqs.length).toBe(341);
    const { view, counts, api } = await mountHost();
    const A = view.stage(0);
    for (const seq of seqs) {
      view.focusOn([]);
      let fa = api.focus();
      fa.use("holds")?.release("table");
      let alive = true;
      const where = seq.join(",") || "(none)";
      for (const e of seq) {
        if (e === "in") {
          view.focusOn([]);
          const f = api.focus();
          expect([where, e, f === fa]).toEqual([where, e, alive]);
          fa = f;
          alive = true;
        } else if (e === "out") {
          view.focusOn(["L"]);
          alive = false;
        } else if (e === "busy") {
          // (a facet given back holds nothing)
          expect([where, e, fa.use("holds")?.hold("table") ?? false]).toEqual([where, e, alive]);
        } else fa.use("holds")?.release("table");
        expect([where, e, counts.creates, counts.disposes]).toEqual([where, e, 1, 0]);
        expect([where, e, !fa.signal.aborted, A.debug.facets()]).toEqual([where, e, alive, alive ? ["t.view"] : []]);
        expect([where, e, A.reader.collect("commands").some((x) => x.id === "t.view")]).toEqual([where, e, false]);
        expect([where, e, view.collect("commands").filter((x) => x.id === "t.view").map((x) => x.stage)]).toEqual([where, e, [view.focusStage().n]]);
      }
    }
  }, 120_000);

  it("what it acquired through a facet goes with the focus; its own chrome and its hand stay; uninstalled, everything goes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { view, counts, api } = await mountHost({
      create: (a) => {
        a.overlay().className += " t-overlay";
        a.hand({ kind: "edit", name: "Mine", input: {} });
        return {};
      },
    });
    const layersAt = (st) => view.viewport.layers.get(keyOf(st.n, "t.view"))?.size ?? 0;
    const holding = () => view.atom.get().hands.some((h) => h.name === "Mine");
    const A = view.stage(0);
    api.focus().world();
    expect(layersAt(A)).toBe(1);
    expect(view.focusOn(["L"])).toBe(true);
    const B = view.stageAt(["L"]);
    api.focus().world();
    // A's layer went with the focus; B's is B's
    expect([layersAt(A), layersAt(B)]).toEqual([0, 1]);
    // the view's: its overlay, its hand
    expect(view.root.querySelectorAll(".t-overlay").length).toBe(1);
    expect(holding()).toBe(true);
    expect(view.leave()).toBe(true);
    expect([layersAt(A), layersAt(B), holding()]).toEqual([0, 0, true]);
    expect(counts).toEqual({ creates: 1, disposes: 0 });
    await s.uninstall("t.view");
    expect(counts).toEqual({ creates: 1, disposes: 1 });
    expect(view.root.querySelectorAll(".t-overlay").length).toBe(0);
    expect(holding()).toBe(false);
    expect(A.debug.facets()).toEqual([]);
  });

  // Services by construction (STAGE.md, "Activation"): no stage creates an extension before the
  // view's providers have started or failed. Over both orders the registry lists {a view provider,
  // a doc extension using its service at create}, every order of the provider loading (P), the
  // extension loading (E) and a link's stage opening (L; the outermost opens before all three), the
  // provider starting or failing: 24 cases, each stage's create finding the service (or null).
  it("over both registry orders, every order of P, E and L, and the provider starting or failing: each stage's create finds the view's service", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = (g = {}) => ((g.p = new Promise((r) => (g.open = r))), g);
    const boom = () => {
      throw new Error("no");
    };
    const perms = (xs) => (xs.length ? xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((q) => [x, ...q])) : [[]]);
    let n = 0;
    for (const listed of ["PE", "EP"])
      for (const fails of [false, true])
        for (const seq of perms(["P", "E", "L"])) {
          const where = `${listed} ${fails ? "fails" : "starts"} ${seq.join("")}`;
          const found = [];
          const g = { P: gate(), E: gate() };
          // (a module that is a promise: its load resolves as the gate opens)
          const prov = { meta: { id: "t.prov", type: "scene:view", provides: ["t.svc"] }, module: g.P.p };
          const ext = { meta: { id: "t.ext", traits: ["*"] }, module: g.E.p };
          const repo = new FakeRepo();
          const b = repo.add(emptyScene({ title: "B" }));
          const links = linkOpener("t.links", { provides: true }); // (it opens L's stage; a provider, as the links native is, so it starts with the view's providers)
          s = await mountStage({ repo, extensions: listed === "PE" ? [links, prov, ext] : [links, ext, prov] });
          for (const e of seq) {
            if (e === "P") g.P.open({ create: () => (fails ? boom() : { provides: { "t.svc": (c) => ({ for: c.id }) } }) });
            else if (e === "E") g.E.open({ create: (api) => (found.push(api.use("t.svc")), {}) });
            else {
              s.handle.change((d) => void ((d.objects.L = object({ name: "B", sourceUrl: b.url, providerId: LINK, renderUrl: null })), d.order.push("L")));
              await until(() => s.debug.view.stageAt(["L"]), 2000);
            }
            await settle();
          }
          await until(() => found.length === 2, 2000);
          expect([where, found]).toEqual([where, fails ? [null, null] : [{ for: "t.ext" }, { for: "t.ext" }]]);
          s.unmount();
          s = null;
          n++;
        }
    expect(n).toBe(24);
  }, 60_000);

  // api.open is any view plugin's, so the kernel keeps I3's "one acting occurrence per doc" itself:
  // a doc acts at one stage of a view (the outermost's too), and nothing acts under a stage that doesn't.
  it("open: a doc acting in the view already, or under a drawn stage, opens no acting stage; drawn, it opens", async () => {
    const repo = new FakeRepo();
    const b = repo.add(emptyScene({ title: "B" }));
    const plugin = { meta: { id: "t.view", type: "scene:view" }, module: { create: () => ({}) } };
    const objects = Object.fromEntries(["L1", "L2", "L3"].map((id) => [id, object({ name: id })]));
    s = await mountStage({ repo, extensions: [plugin], doc: { title: "A", objects, order: Object.keys(objects) } });
    await until(() => s.instance("t.view"), 2000);
    const api = s.api("t.view");
    const view = s.debug.view;
    const at = (under, h = b, o = {}) => !!api.open(h, { under, ...o });
    const close = api.open(b, { under: [[], "L1"] });
    expect([!!close, at([[], "L2"]), at([[], "L2"], s.handle), at([[], "L2"], b, { acting: false }), at([["L2"], "x"], s.handle), at([["L2"], "x"], s.handle, { acting: false })]).toEqual([true, false, false, true, false, true]);
    expect([view.stageAt(["L1"])?.url, view.stageAt(["L2"]), view.stageUnder(["L2", "x"])?.acts]).toEqual([b.url, null, false]);
    close();
    expect(at([[], "L3"])).toBe(true);
  });
});
